/**
 * n3xn VFS v2 — Runners
 *
 * Every run creates a typed Blob, opens it, and logs the blob: URL in the terminal.
 * HTML / games use unrestricted iframes (no sandbox) with full allow= + allowfullscreen.
 */

import * as fs from "./fs.js";

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
  const blob = new Blob([f.content], { type: mime });
  const url = URL.createObjectURL(blob);
  blobRegistry.push({ url, path, mime, created: Date.now(), size: f.content.length });
  termPrintLink(`[blob] ${path} (${mime}, ${f.content.length}b) →`, url);
  return { blob, url, mime, size: f.content.length };
}

export function createBlobFromText(text, mime, label = "inline") {
  const blob = new Blob([text], { type: mime || "text/html" });
  const url = URL.createObjectURL(blob);
  blobRegistry.push({ url, path: label, mime: mime || "text/html", created: Date.now(), size: text.length });
  termPrintLink(`[blob] ${label} (${mime || "text/html"}, ${text.length}b) →`, url);
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

/* ========== 3. JS → wrapped runner page as blob ========== */
export async function runJs(path) {
  const code = await readText(path);
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
  </style>
</head>
<body>
  <div id="bar"><strong>n3xn</strong><span>JS Runner</span><span style="opacity:.5">${escapeHtml(path)}</span></div>
  <div id="log"></div>
  <script>
    const logEl = document.getElementById('log');
    function append(cls, args) {
      const line = document.createElement('div');
      line.className = cls;
      line.textContent = args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
        catch { return String(a); }
      }).join(' ');
      logEl.appendChild(line);
    }
    const _l = console.log, _w = console.warn, _e = console.error, _i = console.info;
    console.log = (...a) => { append('log-log', a); _l.apply(console, a); };
    console.info = (...a) => { append('log-info', a); _i.apply(console, a); };
    console.warn = (...a) => { append('log-warn', a); _w.apply(console, a); };
    console.error = (...a) => { append('log-error', a); _e.apply(console, a); };
    window.onerror = (msg, s, line, col) => append('log-error', [msg + (line ? ' @ ' + line + ':' + col : '')]);
    window.addEventListener('unhandledrejection', e => append('log-error', ['Unhandled: ' + e.reason]));
    try {
      const __r = (function() {
${code}
      })();
      if (__r !== undefined) append('log-result', ['→', __r]);
    } catch (e) {
      append('log-error', [e && e.stack ? e.stack : String(e)]);
    }
  </script>
</body>
</html>`;
  const { url } = createBlobFromText(page, "text/html", `js-runner:${path}`);
  const w = window.open(url, "_blank");
  if (!w) throw new Error("Popup blocked — allow popups");
  termPrint(`JS runner opened: ${path}`, "ok");
  return url;
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
