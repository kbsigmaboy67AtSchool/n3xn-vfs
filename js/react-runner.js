/**
 * n3xn VFS — in-browser React / JSX runner (Vite-style entry, no Node)
 * - Transpile JSX/TSX with Babel standalone (CDN)
 * - Resolve relative imports from VFS
 * - React + ReactDOM from esm.sh
 * - Optional simple CSS import as injected <style>
 */

import * as fs from "./fs.js";
import { createBlobFromText } from "./runner.js";

const BABEL_CDN_REMOTE = "https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.5/babel.min.js";
const REACT_VERSION = "18.3.1";

function babelUrl() {
  try {
    if (navigator.serviceWorker?.controller) {
      return "/__cdn__/jsdelivr/npm/@babel/standalone@7.26.5/babel.min.js";
    }
  } catch (_) {}
  return BABEL_CDN_REMOTE;
}

function esmUrl(spec) {
  try {
    if (navigator.serviceWorker?.controller) {
      return "/__cdn__/esm/" + spec;
    }
  } catch (_) {}
  return "https://esm.sh/" + spec;
}

let babelReady = null;

async function ensureBabel() {
  if (window.Babel) return window.Babel;
  if (babelReady) return babelReady;
  babelReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = babelUrl();
    s.onload = () => resolve(window.Babel);
    s.onerror = () => reject(new Error("Failed to load Babel standalone"));
    document.head.appendChild(s);
  });
  return babelReady;
}

function dirname(p) {
  const n = p.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i <= 0 ? "/" : n.slice(0, i);
}

function normalize(path) {
  let p = String(path || "").replace(/\\/g, "/");
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

function resolveImport(spec, fromFile) {
  if (spec.startsWith("http://") || spec.startsWith("https://") || spec.startsWith("data:")) {
    return { type: "url", path: spec };
  }
  // bare specifier → CDN (react, react-dom, etc.)
  if (!spec.startsWith(".") && !spec.startsWith("/")) {
    return {
      type: "cdn",
      path: esmUrl(spec),
      bare: spec,
    };
  }
  const base = dirname(fromFile);
  let resolved = spec.startsWith("/")
    ? normalize(spec)
    : normalize(base + "/" + spec);
  return { type: "vfs", path: resolved };
}

const EXT_TRY = ["", ".js", ".jsx", ".ts", ".tsx", ".json", "/index.js", "/index.jsx", "/index.ts", "/index.tsx"];

async function readVfsModule(pathHint) {
  for (const ext of EXT_TRY) {
    const p = pathHint.endsWith(ext) && ext === "" ? pathHint : pathHint + (pathHint.endsWith(ext) ? "" : ext);
    // avoid double ext
    let tryPath = pathHint;
    if (ext && !pathHint.endsWith(ext.replace(/\/index\.\w+$/, "")) && !hasKnownExt(pathHint)) {
      tryPath = pathHint + ext;
    } else if (ext === "") {
      tryPath = pathHint;
    } else if (hasKnownExt(pathHint)) {
      tryPath = pathHint;
    } else {
      tryPath = pathHint + ext;
    }
    tryPath = normalize(tryPath);
    const f = await fs.readFile(tryPath);
    if (f) return { path: tryPath, file: f };
    if (hasKnownExt(pathHint)) break;
  }
  return null;
}

function hasKnownExt(p) {
  return /\.(jsx?|tsx?|json|css|mjs)$/i.test(p);
}

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;

async function collectGraph(entryPath, log = () => {}) {
  const Babel = await ensureBabel();
  const modules = new Map(); // path -> { code, css? }
  const queue = [normalize(entryPath)];
  const seen = new Set();

  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);

    const mod = await readVfsModule(path);
    if (!mod) {
      log("missing module: " + path, "err");
      continue;
    }
    const text = mod.file.text();
    const real = mod.path;

    if (/\.css$/i.test(real)) {
      modules.set(real, { type: "css", code: text });
      continue;
    }
    if (/\.json$/i.test(real)) {
      modules.set(real, {
        type: "js",
        code: "export default " + text,
      });
      continue;
    }

    // Find imports before transpile (from source)
    const deps = [];
    let m;
    const re = new RegExp(IMPORT_RE.source, "g");
    while ((m = re.exec(text))) {
      deps.push(m[1]);
    }

    let code = text;
    try {
      const result = Babel.transform(text, {
        filename: real,
        presets: [
          ["react", { runtime: "classic" }],
          ["typescript", { isTSX: /\.tsx?$/i.test(real), allExtensions: true }],
        ],
        plugins: [],
        sourceType: "module",
      });
      code = result.code;
    } catch (e) {
      throw new Error(`Transpile ${real}: ${e.message || e}`);
    }

    modules.set(real, { type: "js", code });

    for (const spec of deps) {
      const r = resolveImport(spec, real);
      if (r.type === "vfs") {
        queue.push(r.path);
      }
    }
  }

  return modules;
}

/**
 * Build a single HTML document that runs the React entry via blob ESM graph.
 */
export async function buildReactApp(entryPath, opts = {}) {
  const log = opts.log || (() => {});
  const entry = normalize(entryPath);
  log("React build entry " + entry, "out");
  await ensureBabel();
  const modules = await collectGraph(entry, log);

  if (!modules.has(entry) && ![...modules.keys()].some((k) => k.startsWith(entry))) {
    // entry might have resolved with extension
    const found = await readVfsModule(entry);
    if (!found || !modules.has(found.path)) {
      throw new Error("Entry not in graph: " + entry);
    }
  }

  // Map path -> blob URL for JS modules; CSS concatenated
  const cssChunks = [];
  const pathToBlob = {};

  for (const [path, mod] of modules) {
    if (mod.type === "css") {
      cssChunks.push(`/* ${path} */\n${mod.code}`);
      continue;
    }
  }

  // Rewrite imports in each JS module to blob URLs or CDN
  // Two-pass: first create placeholder blobs, second rewrite — need deterministic blob per path
  // Simpler approach: one inline module map + custom import shim

  const moduleTable = {};
  for (const [path, mod] of modules) {
    if (mod.type !== "js") continue;
    moduleTable[path] = mod.code;
  }

  // Resolve entry real path
  let entryReal = entry;
  if (!moduleTable[entryReal]) {
    const hit = await readVfsModule(entry);
    if (hit) entryReal = hit.path;
  }
  if (!moduleTable[entryReal]) {
    throw new Error("No JS module for entry " + entry);
  }

  const appCss = cssChunks.join("\n");
  const tableJson = JSON.stringify(moduleTable);
  const entryJson = JSON.stringify(entryReal);

  const reactCdnAbs = new URL(esmUrl(`react@${REACT_VERSION}`), location.origin).href;
  const rdomCdnAbs = new URL(esmUrl(`react-dom@${REACT_VERSION}/client`), location.origin).href;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>n3xn React · ${entryReal}</title>
  <style>
    html, body, #root { margin: 0; min-height: 100%; }
    body { font-family: system-ui, sans-serif; background: #0a0a0f; color: #e2e8f0; }
    #n3xn-error { color: #f87171; padding: 12px; white-space: pre-wrap; font-family: monospace; }
    ${appCss}
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="n3xn-error"></div>
  <script type="module">
    const MODULES = ${tableJson};
    const ENTRY = ${entryJson};
    const REACT_CDN = ${JSON.stringify(reactCdnAbs)};
    const RDOM_CDN = ${JSON.stringify(rdomCdnAbs)};

    function dirname(p) {
      const i = p.lastIndexOf("/");
      return i <= 0 ? "/" : p.slice(0, i);
    }
    function normalize(path) {
      let p = path.replace(/\\\\/g, "/");
      if (!p.startsWith("/")) p = "/" + p;
      const parts = [];
      for (const seg of p.split("/")) {
        if (!seg || seg === ".") continue;
        if (seg === "..") { if (parts.length) parts.pop(); continue; }
        parts.push(seg);
      }
      return "/" + parts.join("/");
    }
    function resolve(spec, from) {
      if (spec === "react") return REACT_CDN;
      if (spec === "react-dom") return RDOM_CDN;
      if (spec === "react-dom/client") return RDOM_CDN;
      if (spec.startsWith("https://") || spec.startsWith("http://")) return spec;
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        return "https://esm.sh/" + spec;
      }
      const base = dirname(from);
      return normalize(spec.startsWith("/") ? spec : base + "/" + spec);
    }
    function tryKeys(path) {
      const exts = ["", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx"];
      if (/\\.(jsx?|tsx?|json)$/.test(path)) return [path];
      return exts.map((e) => path + e);
    }
    const blobCache = {};
    function codeToBlobUrl(path, code) {
      if (blobCache[path]) return blobCache[path];
      // Rewrite static import/export-from strings
      let out = code.replace(
        /(import\\s+(?:[\\s\\S]*?\\s+from\\s+)?|export\\s+[\\s\\S]*?\\s+from\\s+|import\\s*\\()\\s*['"]([^'"]+)['"]/g,
        (all, prefix, spec) => {
          const abs = resolve(spec, path);
          if (abs.startsWith("https://") || abs.startsWith("http://")) {
            return prefix + JSON.stringify(abs);
          }
          const keys = tryKeys(abs);
          let hit = keys.find((k) => MODULES[k]);
          if (!hit) {
            console.warn("unresolved", spec, "from", path, "tried", keys);
            return prefix + JSON.stringify(abs);
          }
          const depCode = MODULES[hit];
          const url = codeToBlobUrl(hit, depCode);
          return prefix + JSON.stringify(url);
        }
      );
      const blob = new Blob([out], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      blobCache[path] = url;
      return url;
    }

    try {
      const entryUrl = codeToBlobUrl(ENTRY, MODULES[ENTRY]);
      await import(entryUrl);
    } catch (e) {
      console.error(e);
      document.getElementById("n3xn-error").textContent =
        "React run error:\\n" + (e && e.stack ? e.stack : e);
    }
  </script>
</body>
</html>`;

  const { url } = createBlobFromText(html, "text/html", "react:" + entryReal);
  return {
    url,
    entry: entryReal,
    moduleCount: Object.keys(moduleTable).length,
    cssCount: cssChunks.length,
  };
}

export async function runReact(entryPath, opts = {}) {
  const result = await buildReactApp(entryPath, opts);
  if (opts.open !== false) {
    window.open(result.url, "_blank");
  }
  return result;
}

/** Detect entry: path itself or nearby main.jsx / index.jsx / App.jsx */
export async function detectReactEntry(path) {
  const p = normalize(path);
  if (/\.(jsx|tsx)$/i.test(p)) return p;
  if (/\.(js|ts)$/i.test(p)) {
    const f = await fs.readFile(p);
    if (f && /from\s+['"]react['"]|require\(['"]react['"]\)/.test(f.text())) return p;
  }
  const dir = dirname(p);
  for (const name of ["main.jsx", "main.tsx", "index.jsx", "index.tsx", "App.jsx", "App.tsx", "src/main.jsx", "src/index.jsx"]) {
    const cand = normalize(dir + "/" + name);
    if (await fs.readFile(cand)) return cand;
  }
  return p;
}

export function isReactPath(path) {
  return /\.(jsx|tsx)$/i.test(path || "");
}
