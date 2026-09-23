/**
 * n3xn DevTools — injectable debugger UI (Chrome-inspired)
 * Unique prefix: n3xn_devtools_*  (ids/classes) to avoid host collisions.
 *
 * Modes:
 *  - host: full panel inside n3xn shell (IDB, WSS, Monaco, xdebug, perf)
 *  - inject: self-contained script for blob: HTML windows
 */

const NS = "n3xn_devtools";
const BTN_ID = NS + "_fab";
const PANEL_ID = NS + "_panel";
const STYLE_ID = NS + "_style";

let hostMounted = false;
let panelOpen = false;
let fabPos = { x: null, y: null };

const netLog = [];
const consoleLog = [];
const MAX_NET = 200;
const MAX_CONSOLE = 300;

/* ========== CSS ========== */
function styleText() {
  return `
#${BTN_ID}{
  position:fixed;z-index:2147483000;width:44px;height:44px;border-radius:50%;
  background:#0d111e;border:2px solid #00f3ff;color:#00f3ff;font:700 11px/1 system-ui,sans-serif;
  box-shadow:0 0 16px rgba(0,243,255,.45),0 4px 20px rgba(0,0,0,.5);
  cursor:grab;user-select:none;display:flex;align-items:center;justify-content:center;
  right:16px;bottom:16px;touch-action:none;
}
#${BTN_ID}:active{cursor:grabbing}
#${BTN_ID}.${NS}_open{background:#00f3ff;color:#0a0a0f}
#${PANEL_ID}{
  position:fixed;z-index:2147482999;right:12px;bottom:68px;width:min(520px,96vw);height:min(420px,70vh);
  background:#0a0c14;border:1px solid #1e293b;border-radius:10px;
  box-shadow:0 12px 48px rgba(0,0,0,.65),0 0 0 1px #00f3ff22;
  display:none;flex-direction:column;overflow:hidden;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#e2e8f0;
}
#${PANEL_ID}.${NS}_visible{display:flex}
.${NS}_head{
  display:flex;align-items:center;gap:6px;padding:6px 8px;background:#0d111e;border-bottom:1px solid #1e293b;
  cursor:default;flex-shrink:0;
}
.${NS}_head strong{color:#00f3ff;font-size:11px;letter-spacing:.04em}
.${NS}_tabs{display:flex;flex-wrap:wrap;gap:2px;padding:4px 6px;background:#080a10;border-bottom:1px solid #1e293b;flex-shrink:0}
.${NS}_tab{
  background:transparent;border:1px solid transparent;color:#94a3b8;padding:3px 8px;border-radius:4px;
  cursor:pointer;font:11px system-ui,sans-serif;
}
.${NS}_tab:hover{color:#e2e8f0;border-color:#334155}
.${NS}_tab.${NS}_active{color:#0a0a0f;background:#00f3ff;border-color:#00f3ff;font-weight:600}
.${NS}_body{flex:1;overflow:auto;padding:8px;min-height:0}
.${NS}_row{padding:4px 0;border-bottom:1px solid #151a24;word-break:break-all}
.${NS}_muted{color:#64748b}
.${NS}_err{color:#f87171}
.${NS}_warn{color:#fbbf24}
.${NS}_ok{color:#4ade80}
.${NS}_info{color:#60a5fa}
.${NS}_toolbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.${NS}_btn{
  background:#1a1a28;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:3px 8px;
  cursor:pointer;font:11px system-ui,sans-serif;
}
.${NS}_btn:hover{border-color:#00f3ff;color:#00f3ff}
.${NS}_input{
  background:#05070f;border:1px solid #1e293b;color:#e2e8f0;border-radius:4px;padding:4px 8px;
  font:12px ui-monospace,monospace;width:100%;box-sizing:border-box;
}
.${NS}_table{width:100%;border-collapse:collapse;font-size:11px}
.${NS}_table th, .${NS}_table td{text-align:left;padding:3px 6px;border-bottom:1px solid #151a24}
.${NS}_table th{color:#94a3b8;font-weight:600}
.${NS}_kv{display:grid;grid-template-columns:120px 1fr;gap:2px 8px;font-size:11px}
.${NS}_kv b{color:#94a3b8;font-weight:500}
.${NS}_pre{white-space:pre-wrap;word-break:break-word;margin:0;font-size:11px}
.${NS}_close{margin-left:auto;background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px}
.${NS}_badge{background:#1e293b;color:#00f3ff;border-radius:999px;padding:0 6px;font-size:10px}
`;
}

function ensureStyle(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement("style");
  s.id = STYLE_ID;
  s.textContent = styleText();
  doc.head.appendChild(s);
}

/* ========== Network + console hooks (host) ========== */
function installHostHooks() {
  if (window.__n3xn_devtools_hooks) return;
  window.__n3xn_devtools_hooks = true;

  const origFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const start = performance.now();
    const input = args[0];
    const url = typeof input === "string" ? input : input?.url || String(input);
    const method = (args[1]?.method || "GET").toUpperCase();
    let status = 0;
    let ok = false;
    let err = null;
    try {
      const res = await origFetch(...args);
      status = res.status;
      ok = res.ok;
      pushNet({ url, method, status, ok, ms: Math.round(performance.now() - start), type: "fetch" });
      return res;
    } catch (e) {
      err = e.message;
      pushNet({ url, method, status: 0, ok: false, ms: Math.round(performance.now() - start), type: "fetch", error: err });
      throw e;
    }
  };

  const OrigXHR = window.XMLHttpRequest;
  function WrappedXHR() {
    const xhr = new OrigXHR();
    let method = "GET";
    let url = "";
    const start = { t: 0 };
    const open = xhr.open;
    xhr.open = function (m, u, ...rest) {
      method = m;
      url = u;
      return open.call(xhr, m, u, ...rest);
    };
    xhr.addEventListener("loadend", () => {
      if (!start.t) return;
      pushNet({
        url,
        method,
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 400,
        ms: Math.round(performance.now() - start.t),
        type: "xhr",
      });
    });
    const send = xhr.send;
    xhr.send = function (...a) {
      start.t = performance.now();
      return send.apply(xhr, a);
    };
    return xhr;
  }
  window.XMLHttpRequest = WrappedXHR;

  ["log", "info", "warn", "error", "debug"].forEach((level) => {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      pushConsole(level, args);
      orig(...args);
    };
  });

  window.addEventListener("error", (e) => {
    pushConsole("error", [e.message, e.filename + ":" + e.lineno]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    pushConsole("error", ["Unhandled rejection", String(e.reason)]);
  });
}

function pushNet(entry) {
  netLog.unshift({ ...entry, ts: Date.now() });
  if (netLog.length > MAX_NET) netLog.pop();
  refreshIfOpen("network");
}

function pushConsole(level, args) {
  const text = args
    .map((a) => {
      try {
        return typeof a === "object" ? JSON.stringify(a) : String(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  consoleLog.unshift({ level, text, ts: Date.now() });
  if (consoleLog.length > MAX_CONSOLE) consoleLog.pop();
  refreshIfOpen("console");
}

function refreshIfOpen(tab) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel || !panel.classList.contains(NS + "_visible")) return;
  const active = panel.querySelector("." + NS + "_tab." + NS + "_active");
  if (active?.dataset.tab === tab) renderTab(tab);
}

/* ========== UI mount ========== */
export function mountHostDevtools() {
  if (hostMounted) return;
  hostMounted = true;
  ensureStyle();
  installHostHooks();

  let fab = document.getElementById(BTN_ID);
  if (!fab) {
    fab = document.createElement("button");
    fab.id = BTN_ID;
    fab.type = "button";
    fab.title = "n3xn DevTools";
    fab.textContent = "n3";
    document.body.appendChild(fab);
    makeDraggable(fab);
    fab.addEventListener("click", (e) => {
      if (fab.dataset.dragged === "1") {
        fab.dataset.dragged = "0";
        return;
      }
      togglePanel();
    });
  }

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="${NS}_head">
        <strong>n3xn DevTools</strong>
        <span class="${NS}_badge" id="${NS}_badge">host</span>
        <button type="button" class="${NS}_close" id="${NS}_close" title="Close">✕</button>
      </div>
      <div class="${NS}_tabs" id="${NS}_tabs"></div>
      <div class="${NS}_body" id="${NS}_body"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById(NS + "_close").onclick = () => setPanel(false);
    buildTabs();
  }
}

function buildTabs() {
  const tabs = [
    ["console", "Console"],
    ["network", "Network"],
    ["elements", "Elements"],
    ["application", "Application"],
    ["sources", "Sources"],
    ["performance", "Perf"],
    ["wss", "WSS"],
    ["monaco", "Monaco"],
    ["xdebug", "xdebug"],
    ["info", "Info"],
  ];
  const el = document.getElementById(NS + "_tabs");
  el.innerHTML = tabs
    .map(
      ([id, label], i) =>
        `<button type="button" class="${NS}_tab${i === 0 ? " " + NS + "_active" : ""}" data-tab="${id}">${label}</button>`
    )
    .join("");
  el.querySelectorAll("." + NS + "_tab").forEach((btn) => {
    btn.onclick = () => {
      el.querySelectorAll("." + NS + "_tab").forEach((b) => b.classList.remove(NS + "_active"));
      btn.classList.add(NS + "_active");
      renderTab(btn.dataset.tab);
    };
  });
  renderTab("console");
}

function togglePanel() {
  setPanel(!panelOpen);
}

function setPanel(open) {
  panelOpen = open;
  const panel = document.getElementById(PANEL_ID);
  const fab = document.getElementById(BTN_ID);
  if (panel) panel.classList.toggle(NS + "_visible", open);
  if (fab) fab.classList.toggle(NS + "_open", open);
  if (open) {
    const active = panel?.querySelector("." + NS + "_tab." + NS + "_active");
    renderTab(active?.dataset.tab || "console");
  }
}

export function openDevtools() {
  mountHostDevtools();
  setPanel(true);
}

export function closeDevtools() {
  setPanel(false);
}

function makeDraggable(el) {
  let ox = 0,
    oy = 0,
    dragging = false,
    moved = false;
  const onDown = (e) => {
    dragging = true;
    moved = false;
    const p = e.touches ? e.touches[0] : e;
    const r = el.getBoundingClientRect();
    ox = p.clientX - r.left;
    oy = p.clientY - r.top;
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    moved = true;
    el.style.left = Math.max(0, p.clientX - ox) + "px";
    el.style.top = Math.max(0, p.clientY - oy) + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  };
  const onUp = () => {
    if (dragging && moved) el.dataset.dragged = "1";
    dragging = false;
  };
  el.addEventListener("mousedown", onDown);
  el.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("mouseup", onUp);
  window.addEventListener("touchend", onUp);
}

/* ========== Tab renderers ========== */
async function renderTab(tab) {
  const body = document.getElementById(NS + "_body");
  if (!body) return;
  body.innerHTML = "";
  try {
    switch (tab) {
      case "console":
        renderConsole(body);
        break;
      case "network":
        renderNetwork(body);
        break;
      case "elements":
        renderElements(body);
        break;
      case "application":
        await renderApplication(body);
        break;
      case "sources":
        renderSources(body);
        break;
      case "performance":
        await renderPerf(body);
        break;
      case "wss":
        await renderWss(body);
        break;
      case "monaco":
        renderMonaco(body);
        break;
      case "xdebug":
        await renderXdebug(body);
        break;
      default:
        renderInfo(body);
    }
  } catch (e) {
    body.innerHTML = `<div class="${NS}_err">${escape(e.message)}</div>`;
  }
}

function renderConsole(body) {
  body.innerHTML = `
    <div class="${NS}_toolbar">
      <button type="button" class="${NS}_btn" id="${NS}_con_clear">Clear</button>
      <button type="button" class="${NS}_btn" id="${NS}_con_eval">Run</button>
    </div>
    <input class="${NS}_input" id="${NS}_con_input" placeholder="expression — Enter to eval" />
    <div id="${NS}_con_list"></div>
  `;
  const list = body.querySelector("#" + NS + "_con_list");
  const paint = () => {
    list.innerHTML = consoleLog
      .map((e) => {
        const cls =
          e.level === "error" ? NS + "_err" : e.level === "warn" ? NS + "_warn" : e.level === "info" ? NS + "_info" : NS + "_muted";
        return `<div class="${NS}_row ${cls}">[${e.level}] ${escape(e.text)}</div>`;
      })
      .join("");
  };
  paint();
  body.querySelector("#" + NS + "_con_clear").onclick = () => {
    consoleLog.length = 0;
    paint();
  };
  const run = () => {
    const input = body.querySelector("#" + NS + "_con_input");
    const expr = input.value;
    if (!expr) return;
    try {
      // eslint-disable-next-line no-eval
      const r = (0, eval)(expr);
      pushConsole("log", ["←", r]);
    } catch (e) {
      pushConsole("error", [e.message]);
    }
    paint();
  };
  body.querySelector("#" + NS + "_con_eval").onclick = run;
  body.querySelector("#" + NS + "_con_input").onkeydown = (e) => {
    if (e.key === "Enter") run();
  };
}

function renderNetwork(body) {
  body.innerHTML = `
    <div class="${NS}_toolbar">
      <button type="button" class="${NS}_btn" id="${NS}_net_clear">Clear</button>
      <span class="${NS}_muted">${netLog.length} request(s)</span>
    </div>
    <table class="${NS}_table">
      <thead><tr><th>Method</th><th>Status</th><th>Time</th><th>URL</th></tr></thead>
      <tbody>
        ${netLog
          .map(
            (n) =>
              `<tr class="${n.ok ? "" : NS + "_err"}"><td>${escape(n.method)}</td><td>${n.status || "—"}</td><td>${n.ms}ms</td><td>${escape(String(n.url).slice(0, 120))}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
  body.querySelector("#" + NS + "_net_clear").onclick = () => {
    netLog.length = 0;
    renderNetwork(body);
  };
}

function renderElements(body) {
  const html = document.documentElement.outerHTML.slice(0, 80000);
  body.innerHTML = `
    <div class="${NS}_muted">documentElement snapshot (truncated)</div>
    <pre class="${NS}_pre">${escape(html)}</pre>
  `;
}

async function renderApplication(body) {
  const ls = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      ls.push([k, String(localStorage.getItem(k)).slice(0, 80)]);
    }
  } catch {}
  const ss = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      ss.push([k, String(sessionStorage.getItem(k)).slice(0, 80)]);
    }
  } catch {}

  let idbNames = [];
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      idbNames = dbs.map((d) => `${d.name || "?"} (v${d.version || "?"})`);
    }
  } catch {
    idbNames = ["(indexedDB.databases unavailable)"];
  }

  let cookies = "";
  try {
    cookies = document.cookie || "(empty)";
  } catch {
    cookies = "(blocked)";
  }

  body.innerHTML = `
    <div class="${NS}_toolbar"><span class="${NS}_muted">Storage · IDB · Cookies</span></div>
    <div class="${NS}_kv">
      <b>IndexedDB</b><span>${idbNames.length ? escape(idbNames.join(", ")) : "(none listed)"}</span>
      <b>localStorage</b><span>${ls.length} key(s)</span>
      <b>sessionStorage</b><span>${ss.length} key(s)</span>
      <b>cookies</b><span>${escape(cookies.slice(0, 200))}</span>
    </div>
    <h4 class="${NS}_muted" style="margin:10px 0 4px">localStorage</h4>
    <table class="${NS}_table"><thead><tr><th>Key</th><th>Value</th></tr></thead>
    <tbody>${ls.map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join("")}</tbody></table>
    <h4 class="${NS}_muted" style="margin:10px 0 4px">sessionStorage</h4>
    <table class="${NS}_table"><thead><tr><th>Key</th><th>Value</th></tr></thead>
    <tbody>${ss.map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join("")}</tbody></table>
  `;
}

function renderSources(body) {
  const scripts = [...document.scripts].map((s) => s.src || "(inline)");
  const path = window.__n3xnActivePath || "(none)";
  body.innerHTML = `
    <div class="${NS}_kv">
      <b>Active file</b><span>${escape(path)}</span>
      <b>Scripts</b><span>${scripts.length}</span>
    </div>
    <div class="${NS}_toolbar" style="margin-top:8px">
      <button type="button" class="${NS}_btn" id="${NS}_src_open">Open active in Monaco</button>
    </div>
    <pre class="${NS}_pre">${scripts.map((s) => escape(s)).join("\n")}</pre>
  `;
  body.querySelector("#" + NS + "_src_open").onclick = () => {
    if (path && path !== "(none)" && window.__n3xnOpenFile) window.__n3xnOpenFile(path);
  };
}

async function renderPerf(body) {
  const mem = performance.memory
    ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB",
        total: Math.round(performance.memory.totalJSHeapSize / 1048576) + " MB",
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576) + " MB",
      }
    : null;
  let extra = "";
  try {
    const perf = await import("./performance.js");
    if (perf.getReport) extra = JSON.stringify(await perf.getReport(), null, 2);
    else if (perf.default) extra = JSON.stringify(perf.default, null, 2);
  } catch {
    extra = "";
  }
  const nav = performance.getEntriesByType?.("navigation")?.[0];
  body.innerHTML = `
    <div class="${NS}_kv">
      <b>timeOrigin</b><span>${performance.timeOrigin}</span>
      <b>now</b><span>${Math.round(performance.now())} ms</span>
      ${mem ? `<b>heap used</b><span>${mem.used}</span><b>heap total</b><span>${mem.total}</span>` : `<b>heap</b><span class="${NS}_muted">n/a</span>`}
      ${nav ? `<b>DOMContentLoaded</b><span>${Math.round(nav.domContentLoadedEventEnd)} ms</span>` : ""}
    </div>
    ${extra ? `<pre class="${NS}_pre">${escape(extra)}</pre>` : ""}
  `;
}

async function renderWss(body) {
  let status = { connected: false };
  try {
    const collab = await import("./collab.js");
    status = collab.getStatus?.() || status;
  } catch {}
  let chat = {};
  try {
    const c = await import("./chat.js");
    chat = c.getChatStatus?.() || {};
  } catch {}
  body.innerHTML = `
    <div class="${NS}_kv">
      <b>Collab WSS</b><span class="${status.connected ? NS + "_ok" : NS + "_muted"}">${status.connected ? "connected" : "offline"}</span>
      <b>room</b><span>${escape(String(status.room || "—"))}</span>
      <b>id</b><span>${escape(String(status.id || "—"))}</span>
      <b>peers</b><span>${escape(JSON.stringify(status.peers || []))}</span>
      <b>collab file</b><span>${escape(String(status.collab || "—"))}</span>
      <b>Chat engine</b><span class="${chat.connected ? NS + "_ok" : NS + "_muted"}">${chat.connected ? "connected" : "offline"}</span>
      <b>chat room</b><span>${escape(String(chat.room || "—"))}</span>
      <b>mic</b><span>${chat.mic ? "on" : "off"}</span>
      <b>video</b><span>${chat.video ? "on" : "off"}</span>
    </div>
  `;
}

function renderMonaco(body) {
  const ed = window.__n3xnEditor;
  if (!ed) {
    body.innerHTML = `<div class="${NS}_muted">Monaco not mounted</div>`;
    return;
  }
  const model = ed.getModel?.();
  const pos = ed.getPosition?.();
  body.innerHTML = `
    <div class="${NS}_kv">
      <b>path</b><span>${escape(window.__n3xnActivePath || "—")}</span>
      <b>language</b><span>${escape(model?.getLanguageId?.() || "—")}</span>
      <b>lines</b><span>${model?.getLineCount?.() ?? "—"}</span>
      <b>cursor</b><span>${pos ? pos.lineNumber + ":" + pos.column : "—"}</span>
      <b>EOL</b><span>${model?.getEOL?.() === "\r\n" ? "CRLF" : "LF"}</span>
    </div>
    <div class="${NS}_toolbar" style="margin-top:8px">
      <button type="button" class="${NS}_btn" id="${NS}_mon_settings">Open Monaco settings</button>
      <button type="button" class="${NS}_btn" id="${NS}_mon_format">Format document</button>
    </div>
  `;
  body.querySelector("#" + NS + "_mon_settings").onclick = () => {
    document.getElementById("btn-monaco-settings")?.click();
  };
  body.querySelector("#" + NS + "_mon_format").onclick = () => {
    ed.getAction?.("editor.action.formatDocument")?.run();
  };
}

async function renderXdebug(body) {
  let findings = [];
  try {
    const xd = await import("./xdebug.js");
    findings = xd.getLastFindings?.() || xd.getLastErrors?.() || [];
  } catch {}
  body.innerHTML = `
    <div class="${NS}_toolbar">
      <button type="button" class="${NS}_btn" id="${NS}_xd_run">xdebug active file</button>
      <span class="${NS}_muted">${findings.length} cached finding(s)</span>
    </div>
    <div id="${NS}_xd_list">
      ${
        findings
          .map(
            (f) =>
              `<div class="${NS}_row ${f.severity === "error" ? NS + "_err" : f.severity === "warn" ? NS + "_warn" : NS + "_muted"}">[${f.severity || "info"}] ${escape(f.path || "")}${f.line ? ":" + f.line : ""} — ${escape(f.message || "")}</div>`
          )
          .join("") || `<div class="${NS}_muted">No findings yet. Run xdebug from terminal or button.</div>`
      }
    </div>
  `;
  body.querySelector("#" + NS + "_xd_run").onclick = async () => {
    const path = window.__n3xnActivePath;
    if (!path) return;
    try {
      const xd = await import("./xdebug.js");
      const r = await xd.xdebugPath(path, { live: false });
      const lines = xd.formatReport?.(r, path) || [JSON.stringify(r)];
      pushConsole("info", ["xdebug", path]);
      lines.forEach((l) => pushConsole("log", [l]));
      renderXdebug(body);
    } catch (e) {
      pushConsole("error", [e.message]);
    }
  };
}

function renderInfo(body) {
  body.innerHTML = `
    <div class="${NS}_kv">
      <b>UA</b><span>${escape(navigator.userAgent)}</span>
      <b>href</b><span>${escape(location.href)}</span>
      <b>online</b><span>${navigator.onLine}</span>
      <b>language</b><span>${navigator.language}</span>
      <b>cores</b><span>${navigator.hardwareConcurrency || "—"}</span>
      <b>deviceMemory</b><span>${navigator.deviceMemory || "—"} GB</span>
      <b>viewport</b><span>${window.innerWidth}×${window.innerHeight}</span>
      <b>DPR</b><span>${devicePixelRatio}</span>
    </div>
  `;
}

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ========== Injectable snippet for blob HTML windows ========== */

/**
 * Returns a self-contained <script> string to inject into blob HTML pages.
 * Provides floating n3 button + mini DevTools (console, network, elements, storage).
 */
export function getInjectableSnippet(meta = {}) {
  const label = JSON.stringify(meta.path || meta.label || "blob");
  // Self-contained — no imports; all IDs prefixed n3xn_devtools_
  return `<script data-n3xn-devtools="1">(function(){
if(window.__n3xn_devtools_injected)return;window.__n3xn_devtools_injected=1;
var NS="n3xn_devtools",BTN=NS+"_fab",PANEL=NS+"_panel",STYLE=NS+"_style";
var net=[],con=[];
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function css(){return "#"+BTN+"{position:fixed;z-index:2147483000;width:44px;height:44px;border-radius:50%;background:#0d111e;border:2px solid #00f3ff;color:#00f3ff;font:700 11px system-ui;box-shadow:0 0 16px rgba(0,243,255,.45);cursor:grab;right:16px;bottom:16px;display:flex;align-items:center;justify-content:center}#"+PANEL+"{position:fixed;z-index:2147482999;right:12px;bottom:68px;width:min(420px,96vw);height:min(360px,65vh);background:#0a0c14;border:1px solid #1e293b;border-radius:10px;display:none;flex-direction:column;font:12px ui-monospace,monospace;color:#e2e8f0;overflow:hidden;box-shadow:0 12px 40px #000a}#"+PANEL+".on{display:flex}."+NS+"-h{padding:6px 8px;background:#0d111e;border-bottom:1px solid #1e293b;display:flex;align-items:center}."+NS+"-h b{color:#00f3ff}."+NS+"-t{display:flex;gap:2px;padding:4px;background:#080a10;flex-wrap:wrap}."+NS+"-t button{background:0;border:1px solid transparent;color:#94a3b8;padding:3px 8px;border-radius:4px;cursor:pointer;font:11px system-ui}."+NS+"-t button.on{background:#00f3ff;color:#0a0a0f}."+NS+"-b{flex:1;overflow:auto;padding:8px}."+NS+"-row{border-bottom:1px solid #151a24;padding:3px 0;word-break:break-all}."+NS+"-err{color:#f87171}."+NS+"-warn{color:#fbbf24}."+NS+"-x{margin-left:auto;background:0;border:0;color:#94a3b8;cursor:pointer}";}
function ensure(){
  if(!document.getElementById(STYLE)){var s=document.createElement("style");s.id=STYLE;s.textContent=css();document.documentElement.appendChild(s);}
  if(!document.getElementById(BTN)){
    var fab=document.createElement("button");fab.id=BTN;fab.type="button";fab.textContent="n3";fab.title="n3xn DevTools · "+${label};
    document.documentElement.appendChild(fab);
    var drag=false,moved=false,ox,oy;
    fab.onmousedown=function(e){drag=true;moved=false;ox=e.clientX-fab.getBoundingClientRect().left;oy=e.clientY-fab.getBoundingClientRect().top;e.preventDefault();};
    window.addEventListener("mousemove",function(e){if(!drag)return;moved=true;fab.style.left=(e.clientX-ox)+"px";fab.style.top=(e.clientY-oy)+"px";fab.style.right="auto";fab.style.bottom="auto";});
    window.addEventListener("mouseup",function(){if(drag&&moved)fab.dataset.d="1";drag=false;});
    fab.onclick=function(){if(fab.dataset.d==="1"){fab.dataset.d="0";return;}toggle();};
  }
  if(!document.getElementById(PANEL)){
    var p=document.createElement("div");p.id=PANEL;
    p.innerHTML='<div class="'+NS+'-h"><b>n3xn DevTools</b> <span style="color:#64748b;margin-left:6px;font-size:10px">blob</span><button class="'+NS+'-x" type="button">✕</button></div><div class="'+NS+'-t"></div><div class="'+NS+'-b"></div>';
    document.documentElement.appendChild(p);
    p.querySelector("."+NS+"-x").onclick=function(){p.classList.remove("on");};
    var tabs=[["console","Console"],["network","Network"],["elements","Elements"],["storage","Storage"],["info","Info"]];
    var tEl=p.querySelector("."+NS+"-t");
    tabs.forEach(function(t,i){var b=document.createElement("button");b.type="button";b.textContent=t[1];b.dataset.tab=t[0];if(!i)b.className="on";b.onclick=function(){tEl.querySelectorAll("button").forEach(function(x){x.className="";});b.className="on";show(t[0]);};tEl.appendChild(b);});
  }
}
function toggle(){ensure();var p=document.getElementById(PANEL);p.classList.toggle("on");if(p.classList.contains("on"))show((p.querySelector("."+NS+"-t button.on")||{}).dataset.tab||"console");}
function show(tab){
  var body=document.querySelector("#"+PANEL+" ."+NS+"-b");if(!body)return;
  if(tab==="console"){
    body.innerHTML=con.map(function(e){return '<div class="'+NS+'-row '+(e.l==="error"?NS+"-err":e.l==="warn"?NS+"-warn":"")+'">['+esc(e.l)+'] '+esc(e.t)+'</div>';}).join("")||'<div style="color:#64748b">No logs</div>';
  } else if(tab==="network"){
    body.innerHTML='<table style="width:100%;font-size:11px;border-collapse:collapse"><tr style="color:#94a3b8"><th>M</th><th>S</th><th>ms</th><th>URL</th></tr>'+net.map(function(n){return '<tr><td>'+esc(n.m)+'</td><td>'+n.s+'</td><td>'+n.ms+'</td><td>'+esc(String(n.u).slice(0,100))+'</td></tr>';}).join("")+"</table>";
  } else if(tab==="elements"){
    body.innerHTML='<pre style="white-space:pre-wrap;font-size:10px">'+esc(document.documentElement.outerHTML.slice(0,60000))+"</pre>";
  } else if(tab==="storage"){
    var rows="";try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);rows+="<div class='"+NS+"-row'>"+esc(k)+" = "+esc(String(localStorage.getItem(k)).slice(0,60))+"</div>";}}catch(e){}
    body.innerHTML=rows||'<div style="color:#64748b">Empty localStorage</div>';
  } else {
    body.innerHTML='<div class="'+NS+'-row">'+esc(location.href)+'</div><div class="'+NS+'-row">'+esc(navigator.userAgent)+'</div>';
  }
}
// hooks
var of=window.fetch;window.fetch=function(){var a=arguments,u=typeof a[0]==="string"?a[0]:(a[0]&&a[0].url)||"",m=(a[1]&&a[1].method)||"GET",t0=performance.now();return of.apply(this,a).then(function(r){net.unshift({m:m,u:u,s:r.status,ms:Math.round(performance.now()-t0)});if(net.length>100)net.pop();return r;},function(e){net.unshift({m:m,u:u,s:0,ms:Math.round(performance.now()-t0)});throw e;});};
["log","info","warn","error"].forEach(function(l){var o=console[l].bind(console);console[l]=function(){con.unshift({l:l,t:[].slice.call(arguments).map(String).join(" ")});if(con.length>200)con.pop();o.apply(console,arguments);};});
window.addEventListener("error",function(e){con.unshift({l:"error",t:e.message});});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ensure);else ensure();
})();<\/script>`;
}

/** Inject snippet into HTML string before </body> or at end */
export function injectIntoHtml(html, meta = {}) {
  const snip = getInjectableSnippet(meta);
  const s = String(html || "");
  if (/data-n3xn-devtools=/.test(s)) return s;
  if (/<\/body>/i.test(s)) return s.replace(/<\/body>/i, snip + "</body>");
  return s + snip;
}

/** Mount host fab early */
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      try {
        mountHostDevtools();
      } catch (_) {}
    });
  } else {
    setTimeout(() => {
      try {
        mountHostDevtools();
      } catch (_) {}
    }, 0);
  }
  window.__n3xnOpenDevtools = openDevtools;
}
