/**
 * n3xn VFS v2 — Pyodide Python runtime + game canvas host
 * AMD-safe load (won't break Monaco require.js)
 */

let pyodide = null;
let loading = null;
let logFn = (msg, cls) => console.log(msg);

export function setPythonLogger(fn) {
  logFn = fn || logFn;
}

function log(msg, cls = "out") {
  logFn(String(msg), cls);
}

/** Temporarily hide AMD define/require so Pyodide's loader doesn't conflict with Monaco */
async function withAmdGuard(fn) {
  const d = window.define;
  const r = window.require;
  try {
    if (window.define) window.define = undefined;
    // keep require for monaco but pyodide uses its own
    return await fn();
  } finally {
    if (d) window.define = d;
    if (r) window.require = r;
  }
}

function ensureCanvas() {
  let host = document.getElementById("py-game-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "py-game-host";
    host.style.cssText =
      "position:fixed;right:16px;bottom:48px;width:420px;height:280px;z-index:5000;" +
      "background:#05070f;border:1px solid #1e293b;border-radius:8px;overflow:hidden;" +
      "box-shadow:0 0 24px rgba(0,243,255,0.12);display:none;flex-direction:column";
    host.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#0d111e;border-bottom:1px solid #1e293b;font-size:11px;color:#8cf">
        <span>Python Game Canvas</span>
        <div>
          <button type="button" id="py-game-fs" style="background:transparent;border:none;color:#aaa;cursor:pointer">⛶</button>
          <button type="button" id="py-game-close" style="background:transparent;border:none;color:#aaa;cursor:pointer">✕</button>
        </div>
      </div>
      <div id="py-game-stage" style="flex:1;position:relative;background:#000"></div>
    `;
    document.body.appendChild(host);
    host.querySelector("#py-game-close").onclick = () => {
      host.style.display = "none";
    };
    host.querySelector("#py-game-fs").onclick = () => {
      if (!document.fullscreenElement) host.requestFullscreen?.();
      else document.exitFullscreen?.();
    };
  }
  const stage = host.querySelector("#py-game-stage");
  let canvas = stage.querySelector("#arcade-canvas") || stage.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "arcade-canvas";
    canvas.width = 400;
    canvas.height = 240;
    canvas.style.cssText = "width:100%;height:100%;display:block;object-fit:contain";
    stage.appendChild(canvas);
  }
  host.style.display = "flex";
  return canvas;
}

export function showGameCanvas() {
  ensureCanvas();
}

export function hideGameCanvas() {
  const host = document.getElementById("py-game-host");
  if (host) host.style.display = "none";
}

export async function ensurePyodide() {
  if (pyodide) return pyodide;
  if (loading) return loading;

  loading = (async () => {
    log("Loading Pyodide WASM…", "ok");
    if (!window.loadPyodide) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Failed to load pyodide.js CDN"));
        document.head.appendChild(s);
      });
    }

    pyodide = await withAmdGuard(async () =>
      loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
        stdout: (t) => log(t, "out"),
        stderr: (t) => log(t, "err"),
      })
    );

    // Expose canvas helper into Python via js module
    try {
      await pyodide.runPythonAsync(`
import js
def _n3xn_ensure_canvas(w=400, h=240):
    c = js.document.getElementById('arcade-canvas')
    if c is None:
        host = js.document.getElementById('py-game-host')
        if host is None:
            js.eval("window.__n3xnShowPyCanvas && window.__n3xnShowPyCanvas()")
            host = js.document.getElementById('py-game-host')
        stage = host.querySelector('#py-game-stage') if host else js.document.body
        c = js.document.createElement('canvas')
        c.id = 'arcade-canvas'
        c.width = w
        c.height = h
        c.style.width = '100%'
        c.style.height = '100%'
        c.style.display = 'block'
        if stage is not None:
            stage.appendChild(c)
        else:
            js.document.body.appendChild(c)
    return c
`);
    } catch (e) {
      log("Canvas helper setup: " + e.message, "err");
    }

    log("Pyodide ready", "ok");
    return pyodide;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export async function runPython(code, { showCanvas = false } = {}) {
  if (showCanvas || /arcade-canvas|getContext\s*\(\s*['\"]2d['\"]\s*\)/.test(code)) {
    ensureCanvas();
    window.__n3xnShowPyCanvas = showGameCanvas;
  }
  const py = await ensurePyodide();
  log("Running Python…", "ok");
  try {
    const result = await withAmdGuard(() => py.runPythonAsync(code));
    if (result !== undefined && result !== null) {
      log("→ " + String(result), "ok");
    }
    return result;
  } catch (e) {
    log("Python error: " + (e.message || e), "err");
    throw e;
  }
}

export async function runPythonFile(path, readFileFn) {
  const f = await readFileFn(path);
  if (!f) throw new Error("File not found: " + path);
  const code = f.text();
  const isGame =
    path.toLowerCase().includes("game") ||
    /arcade-canvas|canvas\.getContext|requestAnimationFrame/.test(code);
  return runPython(code, { showCanvas: isGame });
}

export function isReady() {
  return !!pyodide;
}
