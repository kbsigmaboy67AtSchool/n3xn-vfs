/**
 * n3xn VFS file/folder picker + glass create/import modal (API-ready)
 */
import * as fs from "./fs.js";

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function ensureStyles() {
  if (document.getElementById("n3xn-glass-modal-css")) return;
  const s = document.createElement("style");
  s.id = "n3xn-glass-modal-css";
  s.textContent = `
  .n3xn-glass-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
  .n3xn-glass-modal{width:min(440px,92vw);max-height:88vh;overflow:auto;padding:1.25rem 1.35rem;border-radius:16px;
    background:linear-gradient(145deg,rgba(18,20,32,.92),rgba(8,10,18,.88));border:1px solid rgba(0,243,255,.22);
    box-shadow:0 0 0 1px rgba(255,255,255,.04),0 24px 64px rgba(0,0,0,.55),0 0 40px rgba(0,243,255,.08);color:#e2e8f0;
    font-family:system-ui,sans-serif}
  .n3xn-glass-modal h3{margin:0 0 .35rem;font-size:1.05rem;color:#00f3ff;letter-spacing:.02em}
  .n3xn-glass-modal p.hint{margin:0 0 1rem;font-size:.8rem;color:#94a3b8}
  .n3xn-glass-opt{display:block;width:100%;text-align:left;margin:0 0 .5rem;padding:.75rem .9rem;border-radius:10px;
    border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.55);color:#e2e8f0;cursor:pointer;font:inherit}
  .n3xn-glass-opt:hover,.n3xn-glass-opt:focus{border-color:rgba(0,243,255,.45);background:rgba(0,243,255,.08);outline:none}
  .n3xn-glass-opt strong{display:block;color:#f1f5f9;margin-bottom:.15rem}
  .n3xn-glass-opt span{font-size:.75rem;color:#94a3b8}
  .n3xn-glass-actions{display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem}
  .n3xn-glass-actions button{padding:.45rem .9rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer}
  .n3xn-glass-actions .primary{background:#00f3ff;color:#000;border-color:transparent;font-weight:600}
  .n3xn-picker-tree{max-height:240px;overflow:auto;font-family:ui-monospace,monospace;font-size:12px;border:1px solid #1e293b;border-radius:8px;padding:.4rem;background:#05070f}
  .n3xn-picker-tree div{padding:3px 6px;cursor:pointer;border-radius:4px}
  .n3xn-picker-tree div:hover{background:#1e293b}
  .n3xn-picker-tree .sel{background:rgba(0,243,255,.15);color:#00f3ff}
  .n3xn-picker-tree .dir{color:#7dd3fc}
  `;
  document.head.appendChild(s);
}

/**
 * @param {{ title: string, hint?: string, options: { id: string, title: string, desc?: string }[] }} opts
 * @returns {Promise<string|null>} option id or null if cancelled
 */
export function glassConfirm(opts) {
  ensureStyles();
  return new Promise((resolve) => {
    const overlay = el(`<div class="n3xn-glass-overlay" role="dialog" aria-modal="true"></div>`);
    const modal = el(`<div class="n3xn-glass-modal"></div>`);
    modal.innerHTML = `<h3></h3><p class="hint"></p><div class="opts"></div><div class="n3xn-glass-actions"><button type="button" class="cancel">Cancel</button></div>`;
    modal.querySelector("h3").textContent = opts.title || "Choose";
    modal.querySelector(".hint").textContent = opts.hint || "";
    const box = modal.querySelector(".opts");
    for (const o of opts.options || []) {
      const b = el(`<button type="button" class="n3xn-glass-opt"><strong></strong><span></span></button>`);
      b.querySelector("strong").textContent = o.title;
      b.querySelector("span").textContent = o.desc || "";
      b.onclick = () => {
        overlay.remove();
        resolve(o.id);
      };
      box.appendChild(b);
    }
    modal.querySelector(".cancel").onclick = () => {
      overlay.remove();
      resolve(null);
    };
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}

/**
 * Pick a directory (or file) from VFS tree.
 * @param {{ mode?: 'dir'|'file'|'any', title?: string }} opts
 * @returns {Promise<string|null>} path
 */
export function pickVfsPath(opts = {}) {
  ensureStyles();
  const mode = opts.mode || "dir";
  return new Promise((resolve) => {
    const overlay = el(`<div class="n3xn-glass-overlay"></div>`);
    const modal = el(`<div class="n3xn-glass-modal"><h3></h3><p class="hint">Click a path, then OK</p>
      <div class="n3xn-picker-tree"></div>
      <div class="n3xn-glass-actions"><button type="button" class="cancel">Cancel</button><button type="button" class="primary ok">OK</button></div></div>`);
    modal.querySelector("h3").textContent = opts.title || "Select location";
    const tree = modal.querySelector(".n3xn-picker-tree");
    let selected = "/";

    function list(dir, depth) {
      let entries = [];
      try {
        entries = fs.ls(dir) || [];
      } catch {
        entries = [];
      }
      for (const e of entries) {
        const p = dir === "/" ? "/" + e.name : dir.replace(/\/$/, "") + "/" + e.name;
        const isDir = e.type === "dir" || (typeof fs.isDir === "function" && fs.isDir(p));
        if (mode === "dir" && !isDir) continue;
        if (mode === "file" && isDir) continue;
        const row = document.createElement("div");
        row.className = isDir ? "dir" : "file";
        row.style.paddingLeft = 6 + depth * 12 + "px";
        row.textContent = (isDir ? "📁 " : "📄 ") + p;
        row.onclick = () => {
          tree.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
          row.classList.add("sel");
          selected = p;
        };
        tree.appendChild(row);
        if (isDir && depth < 6) {
          try {
            list(p, depth + 1);
          } catch (_) {}
        }
      }
    }
    const root = document.createElement("div");
    root.className = "dir sel";
    root.textContent = "📁 /";
    root.onclick = () => {
      tree.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
      root.classList.add("sel");
      selected = "/";
    };
    tree.appendChild(root);
    list("/", 0);

    modal.querySelector(".cancel").onclick = () => {
      overlay.remove();
      resolve(null);
    };
    modal.querySelector(".ok").onclick = () => {
      overlay.remove();
      resolve(selected);
    };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}

/** Resolve a sensible "current directory" from UI path (file → parent) */
export function resolveWorkDir(rawPath) {
  let p = String(rawPath || "/").replace(/\\/g, "/") || "/";
  if (!p.startsWith("/")) p = "/" + p;
  try {
    if (typeof fs.isDir === "function" && fs.isDir(p)) return p === "" ? "/" : p;
  } catch (_) {}
  // treat as file path → parent
  const i = p.lastIndexOf("/");
  if (i <= 0) return "/";
  return p.slice(0, i) || "/";
}

/**
 * Create-new-file / folder / import destination flow
 * @param {'file'|'folder'|'import'|'import-zip'} kind
 */
export async function chooseDestination(kind, { defaultName = "" } = {}) {
  const isZip = kind === "import-zip";
  const options = [
    { id: "current", title: "Current directory", desc: "Use the folder you’re browsing (or parent of open file)" },
    { id: "pick", title: "Choose folder in VFS", desc: "Open the n3xn file picker" },
  ];
  if (kind === "import" || isZip) {
    options.push({
      id: "replace",
      title: "Replace existing file",
      desc: "Pick a file in the VFS to overwrite",
    });
  }
  if (isZip) {
    options.push({
      id: "extract",
      title: "Extract ZIP into a folder",
      desc: "Unpack all assets under a chosen directory",
    });
  }
  options.push({
    id: "url",
    title: "Fetch from URL",
    desc: "http(s), data:, blob: — any size into the VFS",
  });

  const choice = await glassConfirm({
    title:
      kind === "file"
        ? "New file"
        : kind === "folder"
          ? "New folder"
          : isZip
            ? "Import ZIP"
            : "Import files",
    hint: "Where should this go?",
    options,
  });
  if (!choice) return null;

  const pathEl = document.getElementById("current-path");
  const work = resolveWorkDir(pathEl?.textContent || "/");

  if (choice === "current") return { mode: "dir", path: work };
  if (choice === "pick") {
    const p = await pickVfsPath({ mode: "dir", title: "Select folder" });
    return p ? { mode: "dir", path: p } : null;
  }
  if (choice === "replace") {
    const p = await pickVfsPath({ mode: "file", title: "Select file to replace" });
    return p ? { mode: "replace", path: p } : null;
  }
  if (choice === "extract") {
    const p = await pickVfsPath({ mode: "dir", title: "Extract ZIP into…" });
    return p ? { mode: "extract", path: p } : null;
  }
  if (choice === "url") {
    const url = prompt("URL (https://…, data:…, blob:…, or host/path):");
    if (!url) return null;
    return { mode: "url", url: normalizeFetchUrl(url), dir: work };
  }
  return null;
}

export function normalizeFetchUrl(u) {
  const s = String(u || "").trim();
  if (!s) return s;
  if (/^(https?|data|blob):/i.test(s)) return s;
  if (s.startsWith("//")) return "https:" + s;
  return "https://" + s.replace(/^\/+/, "");
}

/** Fetch any URL into ArrayBuffer + suggested name */
export async function fetchUrlToBytes(url) {
  const res = await fetch(url, { credentials: "omit", redirect: "follow" });
  if (!res.ok) throw new Error("Fetch failed " + res.status);
  const buf = await res.arrayBuffer();
  let name = "download.bin";
  try {
    const u = new URL(url, location.href);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) name = decodeURIComponent(last);
  } catch (_) {}
  const ct = res.headers.get("Content-Type") || "application/octet-stream";
  return { buf, name, mime: ct };
}

// Public API on window for scripts / nexc
export function installApi() {
  window.__n3xnVfsPicker = {
    glassConfirm,
    pickVfsPath,
    chooseDestination,
    resolveWorkDir,
    fetchUrlToBytes,
    normalizeFetchUrl,
  };
}
