/** Bridge snippet for blob HTML/React previews — limited VFS-ish API (read-only by default) */
export function n3xnStorageBridgeScript() {
  return `<script>
window.n3xn = window.n3xn || {};
window.n3xn.storage = {
  backend: function(){ return "preview-sandbox"; },
  note: "Full IDB/OPFS APIs only inside n3xn shell. Preview has blob assets only.",
  assets: window.n3xn && window.n3xn.assets || []
};
window.n3xn.perf = {
  now: function(){ return performance.now(); },
  memory: function(){
    var m = performance.memory;
    return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize } : null;
  }
};
</script>`;
}

/**
 * n3xn VFS v2 — Runners
 *
 * Every run creates a typed Blob, opens it, and logs the blob: URL in the terminal.
 * HTML / games use unrestricted iframes (no sandbox) with full allow= + allowfullscreen.
 */

import * as fs from "./fs.js";
import { injectIntoHtml } from "./n3xn-devtools.js";

let previewVisible = false;
const blobRegistry = []; // { url, path, mime, created }

const MIME = {
  html: "text/html",
  htm: "text/html",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  css: "text/css",
  json: "application/json",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
};

// Full permissions for games / rich HTML (no sandbox)
const IFRAME_ALLOW =
  "accelerometer; autoplay; bluetooth; camera; display-capture; encrypted-media; " +
  "fullscreen; gamepad; geolocation; gyroscope; hid; idle-detection; magnetometer; " +
  "microphone; midi; payment; picture-in-picture; publickey-credentials-get; " +
  "screen-wake-lock; serial; usb; web-share; xr-spatial-tracking; clipboard-read; clipboard-write";

function extOf(path) {
  return (path || "").split(".").pop()?.toLowerCase() || "";
}

function mimeFor(path, fallback) {
  return MIME[extOf(path)] || fallback || "application/octet-stream";
}

function termPrint(msg, cls = "out") {
  const el = document.getElementById("terminal-output");
  if (!el) return;
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function termPrintLink(label, url) {
  const el = document.getElementById("terminal-output");
  if (!el) {
    console.log(label, url);
    return;
  }
  const line = document.createElement("div");
  line.className = "ok";
  line.innerHTML = `${escapeHtml(label)} <a href="${url}" target="_blank" rel="noopener" style="color:#8cf;word-break:break-all">${escapeHtml(url)}</a>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Create typed blob, register, log to terminal, return { blob, url, mime } */
export async function createBlobFromPath(path, overrideMime) {
  const f = await fs.readFile(path);
  if (!f) throw new Error("File not found: " + path);
  const mime = overrideMime || f.mime || mimeFor(path);
  let data = f.content;
  // Inject n3xn DevTools into HTML pages
  if ((mime || "").includes("html") || /\.html?$/i.test(path)) {
    try {
      let text = typeof data === "string" ? data : new TextDecoder().decode(data);
      text = injectIntoHtml(text, { path });
      data = text;
    } catch (_) {}
  }
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  blobRegistry.push({ url, path, mime, created: Date.now(), size: typeof data === "string" ? data.length : data.length });
  termPrintLink(`[blob] ${path} (${mime}, ${blob.size}b) →`, url);
  return { blob, url, mime, size: blob.size };
}

export function createBlobFromText(text, mime, label = "inline") {
  let body = text;
  if ((mime || "text/html").includes("html")) {
    try {
      body = injectIntoHtml(String(text), { path: label });
    } catch (_) {}
  }
  const blob = new Blob([body], { type: mime || "text/html" });
  const url = URL.createObjectURL(blob);
  blobRegistry.push({ url, path: label, mime: mime || "text/html", created: Date.now(), size: body.length });
  termPrintLink(`[blob] ${label} (${mime || "text/html"}, ${body.length}b) →`, url);
  return { blob, url, mime: mime || "text/html" };
}

export function listBlobs() {
  return blobRegistry.slice();
}

export function revokeBlob(url) {
  const i = blobRegistry.findIndex((b) => b.url === url);
  if (i >= 0) blobRegistry.splice(i, 1);
  try { URL.revokeObjectURL(url); } catch {}
}

export function detectRunner(path) {
  const e = extOf(path);
  if (["html", "htm"].includes(e)) return "html-window";
  if (["js", "mjs", "cjs"].includes(e)) return "js";
  if (e === "py") return "python";
  if (e === "n3-site") return "n3-site";
  if (e === "jsx" || e === "tsx") return "react";
  if (e === "nexc") return "nexc";
  if (e === "lua") return "lua";
  if (e === "c" || e === "h") return "c";
  if (e === "cpp" || e === "cc" || e === "cxx" || e === "hpp" || e === "hh") return "cpp";
  if (e === "rs") return "rust";
  if (e === "go") return "go";
  if (e === "sql") return "sql";
  if (e === "scm" || e === "ss") return "scheme";
  if (e === "bf" || e === "b") return "bf";
  if (e === "nmath") return "nmath";
  if (e === "kaboom" || (path || "").toLowerCase().includes("kaboom")) return "kaboom";
  if ((path || "").toLowerCase().includes("phaser")) return "phaser";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(e)) return "image";
  if (["md", "markdown"].includes(e)) return "markdown";
  if (e === "json") return "json";
  if (["css", "scss", "less"].includes(e)) return "css";
  if (["mp4", "webm", "mp3", "wav", "ogg", "pdf"].includes(e)) return "blob-open";
  return "blob-open";
}

async function readText(path) {
  const f = await fs.readFile(path);
  if (!f) throw new Error("File not found: " + path);
  return f.text();
}

/* ========== In-app preview panel (side, fixed layout) ========== */
function showPreview(innerHtml, title, blobUrl) {
  const container = document.getElementById("preview-container");
  const monaco = document.getElementById("monaco-container");
  const split = document.getElementById("editor-split");
  if (!container || !monaco) return;

  container.classList.remove("hidden");
  monaco.classList.add("preview-split");
  if (split) split.classList.add("has-preview");
  previewVisible = true;

  container.innerHTML = `
    <div class="preview-toolbar">
      <span class="preview-title">${escapeHtml(title)}</span>
      <div class="preview-actions">
        ${blobUrl ? `<a class="btn small ghost" href="${blobUrl}" target="_blank" rel="noopener">Open blob</a>` : ""}
        <button class="btn small ghost" id="btn-preview-fullscreen" title="Fullscreen">⛶</button>
        <button class="btn small ghost" id="btn-preview-close" title="Close">✕</button>
      </div>
    </div>
    <div class="preview-body">${innerHtml}</div>
  `;

  document.getElementById("btn-preview-close").onclick = hidePreview;
  document.getElementById("btn-preview-fullscreen").onclick = () => {
    const body = container.querySelector(".preview-body");
    const frame = body?.querySelector("iframe, img, video");
    if (frame?.requestFullscreen) frame.requestFullscreen();
    else if (body?.requestFullscreen) body.requestFullscreen();
  };

  requestAnimationFrame(() => {
    if (window.__n3xnEditor) window.__n3xnEditor.layout();
    // second pass after flex settles
    setTimeout(() => {
      if (window.__n3xnEditor) window.__n3xnEditor.layout();
    }, 50);
  });
}

export function hidePreview() {
  const container = document.getElementById("preview-container");
  const monaco = document.getElementById("monaco-container");
  const split = document.getElementById("editor-split");
  if (container) {
    container.classList.add("hidden");
    container.innerHTML = "";
  }
  if (monaco) monaco.classList.remove("preview-split");
  if (split) split.classList.remove("has-preview");
  previewVisible = false;
  requestAnimationFrame(() => {
    if (window.__n3xnEditor) window.__n3xnEditor.layout();
    setTimeout(() => {
      if (window.__n3xnEditor) window.__n3xnEditor.layout();
    }, 50);
  });
}

export function isPreviewVisible() {
  return previewVisible;
}

function iframeHtml(src) {
  // NO sandbox — full capabilities for games / Unity / WebGL / etc.
  return `<iframe class="preview-iframe"
    src="${src}"
    allowfullscreen
    allow="${IFRAME_ALLOW}"
    referrerpolicy="no-referrer"
  ></iframe>`;
}

/* ========== 1. HTML → new window (raw blob, correct type) ========== */
export async function runHtmlWindow(path) {
  try {
    const gr = await import("./game-runner.js");
    const f = await fs.readFile(path);
    if (f) {
      const rewritten = gr.rewriteCdnImports(f.text());
      if (rewritten !== f.text()) {
        const { url } = createBlobFromText(rewritten, "text/html", "html-offline:" + path);
        window.open(url, "_blank", "noopener");
        termPrint(`Opened HTML window (CDN→offline rewrite): ${path}`, "ok");
        return url;
      }
    }
  } catch (_) {}
  const { url } = await createBlobFromPath(path, "text/html");
  const w = window.open(url, "_blank");
  if (!w) throw new Error("Popup blocked — allow popups for this site");
  termPrint(`Opened HTML window: ${path}`, "ok");
  return url;
}

/* ========== 2. HTML → in-app fullscreen-capable iframe ========== */
export async function runHtml(path) {
  const { url } = await createBlobFromPath(path, "text/html");
  showPreview(iframeHtml(url), `HTML · ${path}`, url);
  termPrint(`HTML preview (in-app): ${path}`, "ok");
  return url;
}


/* ========== JS REPL helpers (terminal logger) ========== */
export function inspectValue(val, depth = 0) {
  if (val === undefined) return "undefined";
  if (val === null) return "null";
  if (typeof val === "string") return JSON.stringify(val);
  if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") return String(val);
  if (typeof val === "symbol") return val.toString();
  if (typeof val === "function") {
    const name = val.name || "anonymous";
    const src = Function.prototype.toString.call(val);
    const short = src.length > 120 ? src.slice(0, 117) + "..." : src;
    return `[Function ${name}] ${short}`;
  }
  if (val instanceof Error) return val.stack || String(val);
  if (val instanceof Date) return val.toISOString();
  if (typeof Element !== "undefined" && val instanceof Element) {
    return `<${val.tagName.toLowerCase()}${val.id ? "#" + val.id : ""}>`;
  }
  try {
    return JSON.stringify(val, (_k, v) => {
      if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
      if (typeof v === "bigint") return v.toString() + "n";
      if (v instanceof Error) return { name: v.name, message: v.message };
      return v;
    }, 2);
  } catch (_) {
    try {
      return Object.prototype.toString.call(val) + " " + String(val);
    } catch {
      return Object.prototype.toString.call(val);
    }
  }
}

function formatConsoleArgs(args) {
  return args.map((a) => {
    if (typeof a === "string") return a;
    return inspectValue(a);
  }).join(" ");
}

/** Intercept console.* → terminal (and optional extra sink) during fn() */
export async function withConsoleCapture(fn, log = termPrint) {
  const methods = ["log", "info", "warn", "error", "dir", "debug", "table"];
  const orig = {};
  for (const m of methods) {
    orig[m] = console[m];
    console[m] = (...args) => {
      const prefix =
        m === "log" ? "" :
        m === "info" ? "[info] " :
        m === "warn" ? "[warn] " :
        m === "error" ? "[error] " :
        m === "dir" ? "[dir] " :
        m === "debug" ? "[debug] " :
        m === "table" ? "[table] " : `[${m}] `;
      const cls =
        m === "error" ? "err" :
        m === "warn" ? "out" :
        m === "info" ? "ok" : "out";
      try {
        if (m === "table" && args[0] != null) {
          log(prefix + inspectValue(args[0]), cls);
        } else if (m === "dir") {
          log(prefix + inspectValue(args[0]), cls);
        } else {
          log(prefix + formatConsoleArgs(args), cls);
        }
      } catch (_) {}
      try {
        orig[m].apply(console, args);
      } catch (_) {}
    };
  }
  try {
    return await fn();
  } finally {
    for (const m of methods) {
      if (orig[m]) console[m] = orig[m];
    }
  }
}

/**
 * Wrap source so the last expression's value is returned (REPL style).
 */
export function wrapJsReplSource(code) {
  const src = String(code || "").replace(/\r\n/g, "\n").trim();
  if (!src) return "return undefined;";
  // Prefer full script as expression
  // Multi-line: return last statement if it looks like an expression
  const lines = src.split("\n");
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && (!lines[lastIdx].trim() || lines[lastIdx].trim().startsWith("//"))) lastIdx--;
  if (lastIdx < 0) return src;
  const last = lines[lastIdx].trim();
  const isBlock =
    /^(return|throw|const|let|var|function|class|if|for|while|do|switch|try|import|export|async\s+function)\b/.test(last) ||
    last.endsWith("{") ||
    last.endsWith(";") && /^(return|throw|const|let|var)\b/.test(last);
  // If single expression-ish line without trailing semicolon assignment-only
  if (!isBlock && !/^(return|throw)\b/.test(last)) {
    const before = lines.slice(0, lastIdx).join("\n");
    const expr = last.replace(/;+\s*$/, "");
    return (before ? before + "\n" : "") + "return (" + expr + ");";
  }
  // Already statements — try append return of last decl name if const/let x = ...
  const decl = last.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
  if (decl) {
    const before = lines.slice(0, lastIdx + 1).join("\n");
    return before + "\nreturn " + decl[1] + ";";
  }
  return src;
}

/** Evaluate JS in n3xn context with implicit last-value + console capture */
export async function evaluateJsRepl(code, log = termPrint) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const wrapped = wrapJsReplSource(code);
  return withConsoleCapture(async () => {
    let result;
    try {
      const fn = new AsyncFunction(wrapped);
      result = await fn();
    } catch (e1) {
      // Fallback: run as plain body without return wrap
      try {
        const fn2 = new AsyncFunction(String(code || ""));
        result = await fn2();
      } catch (e2) {
        log(String(e2 && e2.stack ? e2.stack : e2), "err");
        throw e2;
      }
    }
    if (result !== undefined) {
      log("=> " + inspectValue(result), "ok");
    }
    return result;
  }, log);
}

/* ========== 3. JS → terminal REPL (+ optional blob window) ========== */
export async function runJs(path) {
  const code = await readText(path);
  termPrint(`Running JS (REPL) ${path}…`, "out");
  try {
    await evaluateJsRepl(code, termPrint);
  } catch (_) {
    /* errors already printed */
  }
  termPrint("Done", "ok");

  // Also open a blob runner window with the same pretty console (optional second view)
  const name = path.split("/").pop();
  const page = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>n3xn JS · ${escapeHtml(name)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0a0f;color:#e8e8f0;font-family:ui-monospace,monospace;font-size:13px}
    #bar{padding:10px 14px;background:#111;border-bottom:1px solid #222;display:flex;gap:12px;align-items:center}
    #bar strong{color:#fff;text-shadow:0 0 8px #fff}
    #log{padding:12px 14px;white-space:pre-wrap;word-break:break-all;min-height:50vh}
    .log-log{color:#aaa}.log-info{color:#8af}.log-warn{color:#fa0}
    .log-error{color:#f66}.log-result{color:#4f8;margin-top:8px;border-top:1px solid #222;padding-top:8px}
    .log-dir{color:#c4b5fd}.log-debug{color:#64748b}
  </style>
</head>
<body>
  <div id="bar"><strong>n3xn</strong><span>JS REPL</span><span style="opacity:.5">${escapeHtml(path)}</span></div>
  <div id="log"></div>
  <script>
    const logEl = document.getElementById('log');
    function inspect(val) {
      if (val === undefined) return 'undefined';
      if (val === null) return 'null';
      if (typeof val === 'function') return Function.prototype.toString.call(val).slice(0, 200);
      if (typeof val === 'string') return JSON.stringify(val);
      if (typeof val !== 'object') return String(val);
      try { return JSON.stringify(val, null, 2); } catch { return String(val); }
    }
    function append(cls, args) {
      const line = document.createElement('div');
      line.className = cls;
      line.textContent = args.map(a => typeof a === 'string' ? a : inspect(a)).join(' ');
      logEl.appendChild(line);
    }
    const methods = ['log','info','warn','error','dir','debug'];
    const orig = {};
    methods.forEach(m => {
      orig[m] = console[m];
      console[m] = (...a) => {
        append('log-' + (m === 'log' ? 'log' : m), m === 'log' ? a : ['[' + m + ']', ...a]);
        orig[m].apply(console, a);
      };
    });
    window.onerror = (msg, s, line, col) => append('log-error', [msg + (line ? ' @ ' + line + ':' + col : '')]);
    window.addEventListener('unhandledrejection', e => append('log-error', ['Unhandled: ' + e.reason]));
    (async () => {
      try {
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const src = ${JSON.stringify(code)};
        // same wrap as host REPL (simplified: try return (expr))
        let result;
        try {
          result = await new AsyncFunction('return (async () => {\n' + src + '\n})()')();
        } catch {
          result = await new AsyncFunction(src)();
        }
        if (result !== undefined) append('log-result', ['=>', result]);
      } catch (e) {
        append('log-error', [e && e.stack ? e.stack : String(e)]);
      }
    })();
  <\/script>
</body>
</html>`;
  try {
    const { url } = createBlobFromText(page, "text/html", `js-runner:${path}`);
    window.open(url, "_blank", "noopener");
    termPrintLink("[blob window]", url);
    return url;
  } catch (e) {
    termPrint("Blob window skipped: " + (e.message || e), "out");
    return null;
  }
}

/* ========== 4. Image ========== */
export async function runImage(path) {
  const { url, mime } = await createBlobFromPath(path);
  showPreview(
    `<div class="preview-image-wrap">
      <img src="${url}" alt="${escapeHtml(path)}" class="preview-image" />
      <p class="preview-meta">${escapeHtml(path)} · ${mime}</p>
    </div>`,
    `Image · ${path}`,
    url
  );
  // also open in new tab option via toolbar link
  return url;
}

/* ========== 5. Markdown → HTML blob ========== */
export async function runMarkdown(path) {
  const text = await readText(path);
  const body = simpleMarkdown(text);
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(path)}</title>
<style>
body{margin:0;background:#0a0a0f;color:#e8e8f0;font-family:system-ui,sans-serif;line-height:1.6}
article{max-width:720px;margin:0 auto;padding:24px}
h1,h2,h3{color:#fff;text-shadow:0 0 8px rgba(255,255,255,.2)}
code{background:#1a1a28;padding:1px 5px;border-radius:3px}
pre{background:#050508;border:1px solid #222;padding:12px;overflow:auto;border-radius:4px}
a{color:#8cf}
</style></head><body><article>${body}</article></body></html>`;
  const { url } = createBlobFromText(page, "text/html", `md:${path}`);
  const w = window.open(url, "_blank");
  if (!w) showPreview(iframeHtml(url), `Markdown · ${path}`, url);
  else termPrint(`Markdown opened: ${path}`, "ok");
  return url;
}

function simpleMarkdown(src) {
  let s = escapeHtml(src);
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`
  );
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
  s = s.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
  s = s.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  s = s.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  s = s.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/^---$/gm, "<hr/>");
  s = s.replace(/^\* (.+)$/gm, "<li>$1</li>");
  s = s.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  s = s.replace(/\n\n+/g, "</p><p>");
  s = `<p>${s}</p>`;
  s = s.replace(/<p><\/p>/g, "");
  s = s.replace(/<p>(<h[1-6]>)/g, "$1").replace(/(<\/h[1-6]>)<\/p>/g, "$1");
  s = s.replace(/<p>(<pre)/g, "$1").replace(/(<\/pre>)<\/p>/g, "$1");
  s = s.replace(/<p>(<ul>)/g, "$1").replace(/(<\/ul>)<\/p>/g, "$1");
  s = s.replace(/<p>(<hr\/>)<\/p>/g, "$1");
  return s;
}

/* ========== 6. JSON ========== */
export async function runJson(path) {
  const text = await readText(path);
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {}
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(path)}</title>
<style>body{margin:0;background:#0a0a0f;color:#cde;font-family:ui-monospace,monospace;font-size:13px;padding:16px;white-space:pre-wrap}</style>
</head><body>${escapeHtml(pretty)}</body></html>`;
  const { url } = createBlobFromText(page, "text/html", `json:${path}`);
  window.open(url, "_blank");
  termPrint(`JSON opened: ${path}`, "ok");
  return url;
}

/* ========== 7. CSS live demo ========== */
export async function runCss(path) {
  const css = await readText(path);
  const demo = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>CSS · ${escapeHtml(path)}</title>
<style>${css}</style></head>
<body>
  <div class="demo">
    <h1>CSS Live Preview</h1>
    <p>Your stylesheet is applied to this page.</p>
    <button>Button</button>
    <input type="text" placeholder="Input"/>
    <div class="card">Card</div>
    <ul><li>Item 1</li><li>Item 2</li></ul>
    <a href="#">Link</a>
  </div>
</body></html>`;
  const { url } = createBlobFromText(demo, "text/html", `css:${path}`);
  const w = window.open(url, "_blank");
  if (!w) showPreview(iframeHtml(url), `CSS · ${path}`, url);
  else termPrint(`CSS demo opened: ${path}`, "ok");
  return url;
}

/* ========== 8. Raw blob open (any type) ========== */
export async function runBlobOpen(path) {
  const { url, mime } = await createBlobFromPath(path);
  const w = window.open(url, "_blank");
  if (!w) throw new Error("Popup blocked");
  termPrint(`Opened blob (${mime}): ${path}`, "ok");
  return url;
}

/* ========== 9. Text preview page ========== */
export async function runText(path) {
  const text = await readText(path);
  const truncated = text.length > 500000 ? text.slice(0, 500000) + "\n\n… [truncated]" : text;
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(path)}</title>
<style>body{margin:0;background:#0a0a0f;color:#ccc;font-family:ui-monospace,monospace;font-size:12px;padding:16px;white-space:pre-wrap;word-break:break-word}</style>
</head><body>${escapeHtml(truncated)}</body></html>`;
  const { url } = createBlobFromText(page, "text/html", `text:${path}`);
  window.open(url, "_blank");
  return url;
}




export async function runLangFile(path, lang) {
  const lr = await import("./lang-runner.js");
  termPrint("Lang project: " + path + (lang ? " (" + lang + ")" : ""), "out");
  const result = await lr.runLanguageFile(path, {
    log: (m, c) => termPrint(m, c || "out"),
    lang,
  });
  if (result?.url) termPrint(result.url, "ok");
  return result;
}

/* ========== React / JSX (browser Babel) ========== */
export async function runReactFile(path) {
  const rr = await import("./react-runner.js");
  const entry = await rr.detectReactEntry(path);
  termPrint("React entry: " + entry, "out");
  const result = await rr.runReact(entry, {
    log: (m, c) => termPrint(m, c || "out"),
  });
  termPrint(`React modules: ${result.moduleCount}, css: ${result.cssCount}`, "ok");
  termPrint(result.url, "out");
  try {
    showPreview(
      `<iframe src="${result.url}" style="width:100%;height:100%;border:0;background:#0a0a0f" allow="fullscreen" allowfullscreen></iframe>`,
      path,
      result.url
    );
  } catch (_) {}
  return result.url;
}

/* ========== .n3-site multi-file HTML ========== */
export async function runN3SiteFile(path) {
  const site = await import("./n3-site.js");
  const { url, assets, errors } = await site.runN3Site(path);
  termPrint(`n3-site expanded ${assets.length} asset(s)`, "ok");
  assets.forEach((a) => {
    if (a.error) termPrint(`  ! ${a.path}: ${a.error}`, "err");
    else termPrint(`  ${a.method} ${a.path} → ${a.url}`, "out");
  });
  window.open(url, "_blank");
  try {
    showPreview(
      `<iframe src="${url}" style="width:100%;height:100%;border:0;background:#fff" allow="fullscreen" allowfullscreen></iframe>`,
      path,
      url
    );
  } catch (_) {}
  return url;
}

/* ========== Python (Pyodide) ========== */
export async function runPython(path) {
  const py = await import("./python.js");
  py.setPythonLogger((msg, cls) => {
    const el = document.getElementById("terminal-output");
    if (el) {
      const line = document.createElement("div");
      line.className = cls || "out";
      line.textContent = msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
  });
  await py.runPythonFile(path, (p) => import("./fs.js").then((fs) => fs.readFile(p)));
  termPrint(`Python finished: ${path}`, "ok");
}

/* ========== Dispatcher ========== */
export async function run(path, mode) {
  if (!path) throw new Error("No file path");
  const m = mode || detectRunner(path);

  switch (m) {
    case "html":
      return runHtml(path);
    case "html-window":
      return runHtmlWindow(path);
    case "js":
      return runJs(path);
    case "python":
    case "py":
      return runPython(path);
    case "n3-site":
    case "n3site":
      return runN3SiteFile(path);
    case "react":
    case "jsx":
    case "tsx":
      return runReactFile(path);
    case "lua":
    case "c":
    case "cpp":
    case "rust":
    case "go":
    case "sql":
    case "scheme":
    case "bf":
    case "brainfuck":
      return runLangFile(path, m === "brainfuck" ? "bf" : m);
    case "kaboom":
    case "phaser":
    case "pixi":
    case "three":
    case "matter":
    case "p5":
    case "game":
      return (async () => {
        const gr = await import("./game-runner.js");
        if (m === "game") return gr.runGameAuto(path);
        return gr.runGamePack(path, m);
      })();
    case "nmath":
    case "ecalc":
      return (async () => {
        const nm = await import("./nmath.js");
        const res = await nm.runNmathFile(path, {
          log: (m, c) => termPrint(m, c || "ok"),
        });
        termPrint("nmath done", "ok");
        return res;
      })();
    case "nexc":
      return (async () => {
        const { print } = await import("./terminal.js").catch(() => ({ print: console.log }));
        termPrint("Use: nexc run " + path, "out");
        return path;
      })();
    case "image":
      return runImage(path);
    case "markdown":
    case "md":
      return runMarkdown(path);
    case "json":
      return runJson(path);
    case "css":
      return runCss(path);
    case "text":
      return runText(path);
    case "dataurl":
    case "blob-open":
      return runBlobOpen(path);
    default:
      return runBlobOpen(path);
  }
}

export async function runActive(mode) {
  const path = window.__n3xnActivePath;
  if (!path) throw new Error("No file open");
  return run(path, mode);
}


/** Run source string of a given type without writing a VFS file (-c-) */
export async function runCodeInPlace(type, code, opts = {}) {
  const t = (type || "js").toLowerCase();
  const log = opts.log || termPrint;
  if (t === "nmath" || t === "ecalc") {
    const nm = await import("./nmath.js");
    return nm.runNmath(code, { log });
  }
  if (t === "js" || t === "javascript") {
    return evaluateJsRepl(code, log);
  }
  if (t === "python" || t === "py") {
    const { runPythonCode } = await import("./python.js").catch(() => ({}));
    if (typeof runPythonCode === "function") return runPythonCode(code);
    // fallback: temp not used — call pyodide if global
    if (window.__n3xnPyodide) {
      const r = await window.__n3xnPyodide.runPythonAsync(code);
      log(String(r ?? "ok"), "ok");
      return r;
    }
    throw new Error("Python runtime not ready");
  }
  if (t === "lua") {
    const lr = await import("./lang-runner.js");
    // write ephemeral only in memory via wasmoon
    const LuaFactory = await lr.ensureLua();
    const factory = new LuaFactory();
    const lua = await factory.createEngine();
    await lua.doString(code);
    return true;
  }
  if (t === "sql") {
    const lr = await import("./lang-runner.js");
    // fake path-less: exec directly
    const SQL = await lr.ensureSqlJs();
    const db = new SQL.Database();
    try {
      const result = db.exec(code);
      for (const row of result) {
        log((row.columns || []).join("\t"), "ok");
        for (const v of row.values || []) log(v.join("\t"), "out");
      }
    } finally {
      db.close();
    }
    return true;
  }
  if (t === "bf" || t === "brainfuck") {
    const lr = await import("./lang-runner.js");
    return lr.runBrainfuck(code, { log });
  }
  if (t === "scheme") {
    const lr = await import("./lang-runner.js");
    // scheme needs path - use inline evaluate
    const Biwa = await lr.ensureBiwa();
    const interpreter = new Biwa.Interpreter((ar) => log(String(ar), "out"));
    await new Promise((resolve, reject) => {
      try {
        interpreter.evaluate(code, resolve);
      } catch (e) {
        reject(e);
      }
    });
    return true;
  }
  // default: treat as nmath if looks English math else js
  if (/\b(plus|minus|times|divided|square root|sum)\b/i.test(code)) {
    const nm = await import("./nmath.js");
    return nm.runNmath(code, { log });
  }
  throw new Error("run -c- unsupported type: " + t + " (try nmath|js|python|lua|sql|bf)");
}
