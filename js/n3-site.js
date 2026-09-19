/**
 * n3xn VFS v2 — .n3-site multi-file HTML builder
 *
 * Directives (usually in <head>), one per line or inline:
 *   _;:(content-type)[kind]{vfs-path}method
 *
 * kind: script | script-module | css | stylesheet | link | style | any (→ link)
 * method: blob | data   (default blob)
 *
 * Example (absolute or relative to this .n3-site file):
 *   _;:(text/css)[stylesheet]{/css/app.css}blob
 *   _;:(text/css)[stylesheet]{./styles.css}blob
 *   _;:(text/javascript)[script]{../shared/app.js}data
 *   _;:(application/javascript)[script-module]{js/main.js}blob
 *
 * Runtime helpers (injected when running):
 *   n3xn.link(path, { mime, method, headers })
 *   n3xn.list(prefix?)
 *   n3xn.read(path)
 */

import * as fs from "./fs.js";
import * as db from "./db.js";
import { createBlobFromText } from "./runner.js";

const DIR_RE =
  /_;:\(([^)]*)\)\[([^\]]*)\]\{([^}]*)\}(blob|data)?/gi;

const KIND_MAP = {
  script: "script",
  "script-module": "script-module",
  module: "script-module",
  css: "stylesheet",
  stylesheet: "stylesheet",
  style: "stylesheet",
  link: "link",
  any: "link",
};

/** Directory of a VFS file path, always absolute, no trailing slash except root */
export function dirname(filePath) {
  const p = normalizeAbs(filePath);
  const i = p.lastIndexOf("/");
  if (i <= 0) return "/";
  return p.slice(0, i) || "/";
}

/** Normalize to absolute VFS path with single leading slash, no trailing slash (except root) */
export function normalizeAbs(path) {
  let p = String(path || "").replace(/\\/g, "/").trim();
  if (!p) return "/";
  // strip file:// or leading ./ clutter
  p = p.replace(/^file:\/\//, "");
  if (!p.startsWith("/")) p = "/" + p;
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return "/" + parts.join("/");
}

/**
 * Resolve a directive path against the current .n3-site file location.
 * - Absolute (/foo/bar) → as-is (normalized)
 * - Relative (./x, ../x, x) → relative to baseDir (site file's folder)
 */
export function resolveSitePath(ref, baseDir = "/") {
  const r = String(ref || "").trim();
  if (!r) throw new Error("empty path");
  if (r.startsWith("/")) return normalizeAbs(r);
  const base = baseDir === "/" ? "/" : normalizeAbs(baseDir);
  // join base + relative
  const joined = (base === "/" ? "" : base) + "/" + r;
  return normalizeAbs(joined);
}


function mimeOf(path, override) {
  if (override && override.trim()) return override.trim();
  const ext = path.split(".").pop()?.toLowerCase();
  const map = {
    css: "text/css",
    js: "text/javascript",
    mjs: "text/javascript",
    json: "application/json",
    html: "text/html",
    htm: "text/html",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    wasm: "application/wasm",
    txt: "text/plain",
    md: "text/markdown",
  };
  return map[ext] || "application/octet-stream";
}

async function readPath(path) {
  const p = normalizeAbs(path);
  const f = await fs.readFile(p);
  if (!f) throw new Error("n3-site: file not found: " + p);
  return f;
}

/** Build blob: or data: URL from VFS file */
export async function makeLink(path, opts = {}) {
  const resolved = resolveSitePath(path, opts.baseDir || "/");
  const f = await readPath(resolved);
  const mime = opts.mime || f.mime || mimeOf(resolved);
  const method = (opts.method || "blob").toLowerCase();
  if (method === "data") {
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < f.content.length; i += chunk) {
      s += String.fromCharCode.apply(null, f.content.subarray(i, i + chunk));
    }
    return {
      url: `data:${mime};base64,${btoa(s)}`,
      mime,
      method: "data",
      path: resolved,
      size: f.content.length,
    };
  }
  const blob = new Blob([f.content], { type: mime });
  const url = URL.createObjectURL(blob);
  return {
    url,
    mime,
    method: "blob",
    path: resolved,
    size: f.content.length,
    blob,
  };
}

function tagFor(kind, url, mime) {
  const k = KIND_MAP[kind.toLowerCase()] || "link";
  if (k === "script") {
    return `<script src="${url}" data-n3xn-injected="1"><\/script>`;
  }
  if (k === "script-module") {
    return `<script type="module" src="${url}" data-n3xn-injected="1"><\/script>`;
  }
  if (k === "stylesheet") {
    return `<link rel="stylesheet" href="${url}" type="${mime || "text/css"}" data-n3xn-injected="1" />`;
  }
  // generic link
  return `<link href="${url}" type="${mime || ""}" data-n3xn-injected="1" />`;
}

/**
 * Expand all _;:(...)[...]{...} directives in source HTML.
 * Returns { html, assets: [{path,url,method,mime}] }
 */
export async function expandN3Site(source, baseDir = "/") {
  const assets = [];
  let html = source;
  // baseDir may be the .n3-site file path or a directory
  const rawBase = String(baseDir || "/");
  const siteBase =
    rawBase.endsWith("/") || rawBase === "/"
      ? normalizeAbs(rawBase === "/" ? "/" : rawBase.replace(/\/$/, "") || "/")
      : dirname(rawBase);

  const matches = [...source.matchAll(DIR_RE)];
  // replace from end to keep indices stable
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const full = m[0];
    const ctype = m[1] || "";
    const kind = m[2] || "script";
    const path = m[3].trim();
    const method = (m[4] || "blob").toLowerCase();
    try {
      const link = await makeLink(path, { mime: ctype || undefined, method, baseDir: siteBase });
      assets.push(link);
      const inject = tagFor(kind, link.url, link.mime);
      html = html.slice(0, m.index) + inject + html.slice(m.index + full.length);
    } catch (e) {
      const err = `<!-- n3-site error ${path} (base ${siteBase}): ${e.message} -->`;
      html = html.slice(0, m.index) + err + html.slice(m.index + full.length);
      assets.push({ path, error: e.message, base: siteBase });
    }
  }

  // Inject runtime bridge for dynamic n3xn.link / list / read (same-origin about:blank won't see it —
  // for blob pages we embed a small bootstrap with pre-resolved map optional)
  const bridge = `
<script data-n3xn-bridge="1">
window.n3xn = window.n3xn || {
  assets: ${JSON.stringify(assets.filter((a) => a.url).map((a) => ({ path: a.path, url: a.url, mime: a.mime })))},
  link: function(path) {
    var a = (this.assets || []).find(function(x){ return x.path === path || x.path === '/' + path.replace(/^\\//,''); });
    if (a) return a.url;
    console.warn('[n3xn] asset not prelinked:', path);
    return null;
  },
  list: function() { return (this.assets || []).map(function(a){ return a.path; }); }
};
</script>`;

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, bridge + "\n</head>");
  } else if (/<html/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (h) => h + "\n<head>" + bridge + "</head>");
  } else {
    html = bridge + html;
  }

  return { html, assets };
}

/** Run expanded site in new window or in-app preview */
export async function runN3Site(path, { target = "window" } = {}) {
  const abs = normalizeAbs(path);
  const f = await fs.readFile(abs);
  if (!f) throw new Error("File not found: " + abs);
  const source = f.text();
  const { html, assets } = await expandN3Site(source, abs);
  const { url } = createBlobFromText(html, "text/html", `n3-site:${abs}`);
  const errs = assets.filter((a) => a.error);
  return { url, assets, errors: errs, html };
}

export async function listVfs(prefix = "/") {
  if (!db.getCurrentUser()) throw new Error("Sign in required to list VFS");
  const files = await db.listAllFiles();
  const p = prefix.endsWith("/") ? prefix : prefix + "/";
  return files
    .map((f) => f.path)
    .filter((x) => x === prefix || x.startsWith(p) || prefix === "/")
    .sort();
}

export function isN3SitePath(path) {
  return /\.n3-site$/i.test(path || "");
}
