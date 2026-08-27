/**
 * n3xn VFS v2 — Multi-mode file runners / previews
 *
 * 1. HTML  → iframe preview or new about:blank window
 * 2. JS    → run in new about:blank (with console capture)
 * 3. Image → in-app preview pane
 * 4. Markdown → rendered HTML preview
 * 5. JSON  → pretty formatted viewer
 * 6. CSS   → live demo page with sample HTML
 * Bonus: raw text, data-URL open, split editor+preview
 */

import * as fs from "./fs.js";

let previewVisible = false;

export function getActivePath() {
  // set by editor via window
  return window.__n3xnActivePath || null;
}

function extOf(path) {
  return (path || "").split(".").pop()?.toLowerCase() || "";
}

function isImage(path) {
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(extOf(path));
}

function isHtml(path) {
  return ["html", "htm"].includes(extOf(path));
}

function isJs(path) {
  return ["js", "mjs", "cjs"].includes(extOf(path));
}

function isMd(path) {
  return ["md", "markdown"].includes(extOf(path));
}

function isJson(path) {
  return extOf(path) === "json";
}

function isCss(path) {
  return ["css", "scss", "less"].includes(extOf(path));
}

/** Detect best default runner for a path */
export function detectRunner(path) {
  if (isHtml(path)) return "html";
  if (isJs(path)) return "js";
  if (isImage(path)) return "image";
  if (isMd(path)) return "markdown";
  if (isJson(path)) return "json";
  if (isCss(path)) return "css";
  return "text";
}

export function availableRunners(path) {
  const all = [
    { id: "html", label: "HTML Preview", icon: "🌐" },
    { id: "html-window", label: "HTML → New Window", icon: "🗔" },
    { id: "js", label: "Run JS (new window)", icon: "⚡" },
    { id: "image", label: "Image Preview", icon: "🖼" },
    { id: "markdown", label: "Markdown Render", icon: "📝" },
    { id: "json", label: "JSON Viewer", icon: "{}" },
    { id: "css", label: "CSS Live Demo", icon: "🎨" },
    { id: "text", label: "Raw Text Preview", icon: "📄" },
    { id: "dataurl", label: "Open as Data URL", icon: "🔗" },
  ];
  // Prioritize relevant ones but allow all
  const best = detectRunner(path);
  return all.sort((a, b) => (a.id === best || a.id.startsWith(best) ? -1 : 1));
}

async function readText(path) {
  const f = await fs.readFile(path);
  if (!f) throw new Error("File not found: " + path);
  return f.text();
}

async function readBytes(path) {
  const f = await fs.readFile(path);
  if (!f) throw new Error("File not found: " + path);
  return { content: f.content, mime: f.mime || "application/octet-stream" };
}

function showPreview(html, title = "Preview") {
  const container = document.getElementById("preview-container");
  const monaco = document.getElementById("monaco-container");
  if (!container) return;

  container.classList.remove("hidden");
  monaco.classList.add("preview-split");
  previewVisible = true;

  container.innerHTML = `
    <div class="preview-toolbar">
      <span class="preview-title">${escapeHtml(title)}</span>
      <div class="preview-actions">
        <button class="btn small ghost" id="btn-preview-popout" title="Open in new window">Pop out</button>
        <button class="btn small ghost" id="btn-preview-close" title="Close preview">✕</button>
      </div>
    </div>
    <div class="preview-body">${html}</div>
  `;

  document.getElementById("btn-preview-close").onclick = hidePreview;
  document.getElementById("btn-preview-popout").onclick = () => {
    const body = container.querySelector(".preview-body");
    const w = window.open("about:blank", "_blank");
    if (w) {
      w.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>
        <style>body{margin:0;background:#111;color:#eee;font-family:system-ui}</style>
        </head><body>${body.innerHTML}</body></html>`);
      w.document.close();
    }
  };

  // Resize monaco
  requestAnimationFrame(() => {
    if (window.__n3xnEditor) window.__n3xnEditor.layout();
  });
}

export function hidePreview() {
  const container = document.getElementById("preview-container");
  const monaco = document.getElementById("monaco-container");
  if (container) {
    container.classList.add("hidden");
    container.innerHTML = "";
  }
  if (monaco) monaco.classList.remove("preview-split");
  previewVisible = false;
  requestAnimationFrame(() => {
    if (window.__n3xnEditor) window.__n3xnEditor.layout();
  });
}

export function isPreviewVisible() {
  return previewVisible;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ========== 1. HTML Preview (in-app iframe) ========== */
export async function runHtml(path) {
  const text = await readText(path);
  // Rewrite relative asset refs is hard without full server; inject base note
  const srcdoc = text;
  showPreview(
    `<iframe class="preview-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-modals" srcdoc="${escapeAttr(srcdoc)}"></iframe>`,
    `HTML · ${path}`
  );
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/* ========== 2. HTML → New about:blank window ========== */
export async function runHtmlWindow(path) {
  const text = await readText(path);
  const w = window.open("about:blank", "_blank");
  if (!w) throw new Error("Popup blocked — allow popups for this site");
  w.document.open();
  w.document.write(text);
  w.document.close();
  w.document.title = path.split("/").pop() || "n3xn preview";
}

/* ========== 3. JavaScript → new about:blank with console capture ========== */
export async function runJs(path) {
  const code = await readText(path);
  const w = window.open("about:blank", "_blank");
  if (!w) throw new Error("Popup blocked — allow popups for this site");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>n3xn JS · ${escapeHtml(path.split("/").pop())}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0f; color: #e8e8f0; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; }
    #bar { padding: 10px 14px; background: #111; border-bottom: 1px solid #222; display: flex; gap: 12px; align-items: center; }
    #bar strong { color: #fff; text-shadow: 0 0 8px #fff; }
    #log { padding: 12px 14px; white-space: pre-wrap; word-break: break-all; min-height: 40vh; }
    .log-log { color: #aaa; }
    .log-info { color: #8af; }
    .log-warn { color: #fa0; }
    .log-error { color: #f66; }
    .log-result { color: #4f8; margin-top: 8px; border-top: 1px solid #222; padding-top: 8px; }
    #out { padding: 12px; border-top: 1px solid #222; }
  </style>
</head>
<body>
  <div id="bar"><strong>n3xn</strong> <span>JS Runner</span> <span style="opacity:.5">${escapeHtml(path)}</span></div>
  <div id="log"></div>
  <div id="out"></div>
  <script>
    const logEl = document.getElementById('log');
    function append(cls, args) {
      const line = document.createElement('div');
      line.className = cls;
      line.textContent = args.map(a => {
        try {
          if (typeof a === 'object') return JSON.stringify(a, null, 2);
          return String(a);
        } catch { return String(a); }
      }).join(' ');
      logEl.appendChild(line);
    }
    const _log = console.log, _warn = console.warn, _err = console.error, _info = console.info;
    console.log = (...a) => { append('log-log', a); _log.apply(console, a); };
    console.info = (...a) => { append('log-info', a); _info.apply(console, a); };
    console.warn = (...a) => { append('log-warn', a); _warn.apply(console, a); };
    console.error = (...a) => { append('log-error', a); _err.apply(console, a); };
    window.onerror = (msg, src, line, col, err) => {
      append('log-error', [msg + (line ? ' @ ' + line + ':' + col : '')]);
    };
    try {
      const __result = (function() {
${code}
      })();
      if (__result !== undefined) {
        append('log-result', ['→', __result]);
      }
    } catch (e) {
      append('log-error', [e && e.stack ? e.stack : String(e)]);
    }
  </script>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* ========== 4. Image Preview ========== */
export async function runImage(path) {
  const { content, mime } = await readBytes(path);
  const blob = new Blob([content], { type: mime || "image/png" });
  const url = URL.createObjectURL(blob);
  const isSvg = extOf(path) === "svg";
  showPreview(
    `<div class="preview-image-wrap">
      <img src="${url}" alt="${escapeHtml(path)}" class="preview-image" />
      <p class="preview-meta">${escapeHtml(path)} · ${mime || "image"} · ${content.length} bytes</p>
    </div>`,
    `Image · ${path}`
  );
  // Revoke later — keep for session
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

/* ========== 5. Markdown Render ========== */
export async function runMarkdown(path) {
  const text = await readText(path);
  const html = simpleMarkdown(text);
  showPreview(
    `<article class="md-preview">${html}</article>`,
    `Markdown · ${path}`
  );
}

/** Lightweight markdown → HTML (no external dep) */
function simpleMarkdown(src) {
  let s = escapeHtml(src);
  // code blocks
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="md-code"><code class="lang-${lang}">${code.trim()}</code></pre>`
  );
  // inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // headers
  s = s.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
  s = s.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
  s = s.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  s = s.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  s = s.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // bold / italic
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // hr
  s = s.replace(/^---$/gm, "<hr/>");
  // lists
  s = s.replace(/^\* (.+)$/gm, "<li>$1</li>");
  s = s.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // paragraphs
  s = s.replace(/\n\n+/g, "</p><p>");
  s = `<p>${s}</p>`;
  s = s.replace(/<p><\/p>/g, "");
  s = s.replace(/<p>(<h[1-6]>)/g, "$1");
  s = s.replace(/(<\/h[1-6]>)<\/p>/g, "$1");
  s = s.replace(/<p>(<pre)/g, "$1");
  s = s.replace(/(<\/pre>)<\/p>/g, "$1");
  s = s.replace(/<p>(<ul>)/g, "$1");
  s = s.replace(/(<\/ul>)<\/p>/g, "$1");
  s = s.replace(/<p>(<hr\/>)<\/p>/g, "$1");
  return s;
}

/* ========== 6. JSON Viewer ========== */
export async function runJson(path) {
  const text = await readText(path);
  let pretty;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch (e) {
    pretty = text;
    showPreview(
      `<pre class="json-preview error">Invalid JSON:\n${escapeHtml(e.message)}\n\n${escapeHtml(text)}</pre>`,
      `JSON · ${path}`
    );
    return;
  }
  showPreview(
    `<pre class="json-preview">${syntaxHighlightJson(pretty)}</pre>`,
    `JSON · ${path}`
  );
}

function syntaxHighlightJson(json) {
  return escapeHtml(json).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "json-key" : "json-string";
      } else if (/true|false/.test(match)) cls = "json-bool";
      else if (/null/.test(match)) cls = "json-null";
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

/* ========== 7. CSS Live Demo ========== */
export async function runCss(path) {
  const css = await readText(path);
  const demo = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>
${css}
</style></head>
<body>
  <div class="demo">
    <h1>CSS Live Preview</h1>
    <p>This page loads your stylesheet. Edit classes below or in the source file.</p>
    <button>Button</button>
    <input type="text" placeholder="Input" />
    <div class="card">Card / box</div>
    <ul><li>List item 1</li><li>List item 2</li></ul>
    <a href="#">Link</a>
  </div>
</body></html>`;

  showPreview(
    `<iframe class="preview-iframe" sandbox="allow-same-origin" srcdoc="${escapeAttr(demo)}"></iframe>`,
    `CSS · ${path}`
  );
}

/* ========== 8. Raw text / fallback ========== */
export async function runText(path) {
  const text = await readText(path);
  const truncated = text.length > 200000 ? text.slice(0, 200000) + "\n\n… [truncated]" : text;
  showPreview(
    `<pre class="text-preview">${escapeHtml(truncated)}</pre>`,
    `Text · ${path}`
  );
}

/* ========== 9. Open as data URL in new tab ========== */
export async function runDataUrl(path) {
  const { content, mime } = await readBytes(path);
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    URL.revokeObjectURL(url);
    throw new Error("Popup blocked");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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
      return runDataUrl(path);
    default:
      // smart fallback
      if (isHtml(path)) return runHtml(path);
      if (isJs(path)) return runJs(path);
      if (isImage(path)) return runImage(path);
      if (isMd(path)) return runMarkdown(path);
      if (isJson(path)) return runJson(path);
      if (isCss(path)) return runCss(path);
      return runText(path);
  }
}

export async function runActive(mode) {
  const path = getActivePath();
  if (!path) throw new Error("No file open");
  return run(path, mode);
}
