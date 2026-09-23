/**
 * n3xn Virtual FileSystem v2 — Main Application
 */

import * as db from "./db.js";
import * as fs from "./fs.js";
import * as term from "./terminal.js";
import * as ed from "./editor.js";
import * as runner from "./runner.js";
import * as media from "./media-editor.js";
import * as htmlVisual from "./html-visual.js";

// Optional modules — dynamic so a missing/CDN MIME failure cannot blank the auth UI
async function loadMonacoSettings() {
  return import("./monaco-settings.js");
}

// ========== AUTH ==========

function showAuth() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
  refreshAccountList();
}

function showApp() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
  document.getElementById("current-user").textContent = db.getCurrentUser();
}

function refreshAccountList() {
  const select = document.getElementById("account-select");
  if (!select) return;
  select.innerHTML = "";
  let accounts = [];
  try {
    accounts = db.listAccounts() || [];
  } catch (e) {
    console.error("listAccounts failed", e);
    accounts = [];
  }
  if (accounts.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No accounts — create one";
    select.appendChild(opt);
  } else {
    accounts.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.username;
      opt.textContent = a.username || "(unnamed)";
      select.appendChild(opt);
    });
  }
}

document.getElementById("btn-show-create").onclick = () => {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("create-view").classList.remove("hidden");
  document.getElementById("auth-error").textContent = "";
};

document.getElementById("btn-show-login").onclick = () => {
  document.getElementById("create-view").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
  document.getElementById("auth-error").textContent = "";
};

document.getElementById("btn-create").onclick = async () => {
  const user = document.getElementById("new-username").value.trim();
  const pass = document.getElementById("new-password").value;
  const pass2 = document.getElementById("new-password2").value;
  const err = document.getElementById("auth-error");
  if (!user || !pass) {
    err.textContent = "Username and password required";
    return;
  }
  if (pass !== pass2) {
    err.textContent = "Passwords do not match";
    return;
  }
  if (pass.length < 6) {
    err.textContent = "Password must be at least 6 characters";
    return;
  }
  try {
    await db.createAccount(user, pass);
    await db.login(user, pass);
    err.textContent = "";
    await bootApp();
  } catch (e) {
    err.textContent = e.message;
  }
};

document.getElementById("btn-login").onclick = async () => {
  const user = document.getElementById("account-select").value;
  const pass = document.getElementById("login-password").value;
  const err = document.getElementById("auth-error");
  if (!user) {
    err.textContent = "Select or create an account";
    return;
  }
  try {
    await db.login(user, pass);
    err.textContent = "";
    await bootApp();
  } catch (e) {
    err.textContent = e.message;
  }
};

document.getElementById("login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-login").click();
});

document.getElementById("btn-logout").onclick = () => {
  db.logout();
  showAuth();
};

// Import accounts / full export
document.getElementById("btn-import-accounts").onclick = () => {
  document.getElementById("json-import").click();
};

document.getElementById("json-import").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("File is not valid JSON");
    }
    const pass = prompt(
      "Password for this export" +
        (db.getCurrentUser()
          ? " (files merge into your current account if export account password differs)"
          : "") +
        ":"
    );
    if (!pass) return;
    setStatus("Importing filesystem…");
    const result = await db.importEverything(json, pass, {
      mergeIntoCurrent: !!db.getCurrentUser(),
    });
    const user = result.username || result;
    const n = result.files != null ? result.files : "?";
    if (db.getCurrentUser()) {
      await fs.loadTree();
      await fs.rebuildTreeFromFiles();
      await refreshTree();
      setStatus(`FS imported: ${n} files → ${user}`);
      alert(`Imported ${n} file(s) into account "${user}". Tree rebuilt.`);
    } else {
      alert(`Imported for ${user}. Sign in with that account + password.`);
      refreshAccountList();
      const sel = document.getElementById("account-select");
      if (sel) sel.value = user;
    }
  } catch (err) {
    console.error(err);
    alert("Import failed: " + (err.message || err));
    setStatus("Import failed");
  }
  e.target.value = "";
};

// ========== BOOT ==========

async function bootApp() {
  showApp();
  await fs.loadTree();
  // Ensure tree matches stored files
  try {
    const t = fs.getTree();
    if (!t?.children || Object.keys(t.children).length === 0) {
      await fs.rebuildTreeFromFiles();
    }
  } catch (e) {
    console.warn(e);
  }
  term.initTerminal();
  await ed.initEditor();
  await refreshTree();
  window.refreshTree = refreshTree;
  window.__n3xnOpenFile = async (path) => {
    try {
      await ed.openFile(path);
      import("./collab.js").then((c) => c.refreshRemoteCursorsForActiveModel?.()).catch(() => {});
    } catch (e) {
      console.warn(e);
    }
  };
  bindToolButtons(); // re-bind after UI is visible
  import("./github.js")
    .then((gh) => gh.loadSavedToken())
    .then((u) => {
      if (u) setStatus("Ready · GitHub @" + u.login);
    })
    .catch(() => {});
  setStatus("Ready — encrypted & local");
}

// ========== FILE TREE ==========

let collabFsMode = false;

function renderCollabFsList(list) {
  const container = document.getElementById("file-tree");
  if (!container || !collabFsMode) return;
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "tree-item";
  header.style.opacity = "0.85";
  header.innerHTML = `<span class="icon">🔗</span><span class="name">Collab FS (${list.length})</span>`;
  container.appendChild(header);
  const back = document.createElement("div");
  back.className = "tree-item";
  back.innerHTML = `<span class="icon">←</span><span class="name">Back to local VFS</span>`;
  back.onclick = () => {
    collabFsMode = false;
    refreshTree();
  };
  container.appendChild(back);
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.innerHTML = `<p>No shared files yet</p><p class="hint">wss share /path · peers' shares appear when streaming completes</p>`;
    container.appendChild(empty);
    return;
  }
  for (const f of list) {
    const item = document.createElement("div");
    item.className = "tree-item";
    const st =
      f.status === "streaming"
        ? "… "
        : f.status === "announced"
          ? "📡 "
          : "";
    item.innerHTML = `<span class="icon">📄</span><span class="name">${st}${escapeTree(f.key)}</span>`;
    item.title = `${f.fromUser || f.from} · ${f.mime || ""} · ${f.size || 0}b · ${f.status}`;
    item.onclick = async () => {
      document.querySelectorAll(".tree-item").forEach((el) => el.classList.remove("active"));
      item.classList.add("active");
      document.getElementById("current-path").textContent = f.key;
      if (f.status === "announced") {
        setStatus("Announced only — request: wss pull " + f.path);
        return;
      }
      if (f.status === "streaming") {
        setStatus("Still receiving chunks…");
        return;
      }
      try {
        const collab = await import("./collab.js");
        const bytes = collab.readSharedContent(f.key);
        if (bytes && window.__n3xnOpenMemoryFile) {
          await window.__n3xnOpenMemoryFile(f.key, bytes, f.mime);
        } else if (bytes) {
          // fallback: write temp not in collab path
          setStatus("Opening shared " + f.key);
          const { openFile } = await import("./editor.js");
          // inject via editor if available
          await ed.openFile(f.path);
        } else {
          await ed.openFile(f.path);
        }
      } catch (e) {
        setStatus("Open failed: " + e.message);
      }
    };
    container.appendChild(item);
  }
}

window.__n3xnRefreshCollabFs = (list) => {
  if (collabFsMode) renderCollabFsList(list || []);
};

window.__n3xnOpenCollabFs = () => {
  collabFsMode = true;
  import("./collab.js").then((c) => {
    renderCollabFsList(c.listSharedFiles());
  }).catch(() => renderCollabFsList([]));
};

async function refreshTree() {
  if (collabFsMode) {
    import("./collab.js")
      .then((c) => renderCollabFsList(c.listSharedFiles()))
      .catch(() => renderCollabFsList([]));
    return;
  }

  const container = document.getElementById("file-tree");
  if (!container) return;
  container.innerHTML = "";
  let root = fs.getTree();
  if (!root || !root.children) {
    root = { type: "dir", children: {} };
  }
  const entries = Object.keys(root.children || {});
  if (entries.length === 0) {
    // Try rebuild from IndexedDB in case meta drifted
    try {
      await fs.rebuildTreeFromFiles();
      root = fs.getTree();
    } catch (e) {
      console.warn(e);
    }
  }
  const stillEmpty = !root.children || Object.keys(root.children).length === 0;
  if (stillEmpty) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.innerHTML = `<p>No files yet</p><p class="hint">New File · Import · Import FS</p>`;
    container.appendChild(empty);
    return;
  }
  renderNode(container, root, "/", 0);
}

function renderNode(container, node, path, depth) {
  if (!node || node.type !== "dir") return;
  const children = node.children || {};
  const entries = Object.entries(children).sort((a, b) => {
    const ta = a[1]?.type || "file";
    const tb = b[1]?.type || "file";
    if (ta !== tb) return ta === "dir" ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });

  for (const [name, child] of entries) {
    if (!child) continue;
    if (name === "collab" && path === "/") continue; // Collab FS only, not VFS
    if (name === ".n3xn-collab" && path === "/") continue; // internal IDB collab cache
    const full = path === "/" ? "/" + name : path + "/" + name;
    const item = document.createElement("div");
    item.className = "tree-item";
    item.style.paddingLeft = 10 + depth * 12 + "px";
    const isDir = child.type === "dir";
    item.innerHTML = `<span class="icon">${isDir ? "📁" : "📄"}</span><span class="name">${escapeTree(name)}</span>`;
    item.onclick = async () => {
      document.querySelectorAll(".tree-item").forEach((el) => el.classList.remove("active"));
      item.classList.add("active");
      document.getElementById("current-path").textContent = full;
      if (!isDir) {
        try {
          await ed.openFile(full);
        } catch (e) {
          setStatus("Error: " + e.message);
        }
      }
    };
    item.oncontextmenu = (e) => {
      e.preventDefault();
      const action = prompt(`Actions for ${full}:\n1 = Rename\n2 = Delete\n3 = Download`, "2");
      if (action === "2") {
        if (confirm(`Delete ${full}?`)) {
          fs.removeRecursive(full).then(() => refreshTree());
        }
      } else if (action === "3") {
        downloadPath(full);
      } else if (action === "1") {
        const newName = prompt("New name:", name);
        if (newName && newName !== name) {
          const parent = full.split("/").slice(0, -1).join("/") || "/";
          const dest = parent === "/" ? "/" + newName : parent + "/" + newName;
          (async () => {
            if (!isDir) {
              const f = await fs.readFile(full);
              await fs.writeFile(dest, f.content, { mime: f.mime });
              await fs.remove(full);
            }
            await refreshTree();
          })();
        }
      }
    };
    container.appendChild(item);
    if (isDir) {
      renderNode(container, child, full, depth + 1);
    }
  }
}

function escapeTree(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ========== SIDEBAR ACTIONS ==========

document.getElementById("btn-collab-fs")?.addEventListener("click", async () => {
  try {
    const collab = await import("./collab.js");
    if (!collab.isConnected()) {
      setStatus("Connect WSS first: wss connect <url> <password>");
      return;
    }
    collab.openCollabFs();
  } catch (e) {
    setStatus(String(e.message || e));
  }
});

document.getElementById("btn-new-file").onclick = async () => {
  const name = prompt("File name (relative to current path):");
  if (!name) return;
  const base = document.getElementById("current-path").textContent || "/";
  const path = base === "/" ? "/" + name : base.replace(/\/$/, "") + "/" + name;
  // Ensure parents
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    if (!fs.exists(cur)) await fs.mkdir(cur);
  }
  await fs.writeFile(path, "");
  refreshTree();
  await ed.openFile(path);
};

document.getElementById("btn-new-folder").onclick = async () => {
  const name = prompt("Folder name:");
  if (!name) return;
  const base = document.getElementById("current-path").textContent || "/";
  const path = base === "/" ? "/" + name : base.replace(/\/$/, "") + "/" + name;
  await fs.mkdir(path);
  refreshTree();
};

document.getElementById("btn-import").onclick = () => {
  const choice = prompt("Import type:\n1 = Files\n2 = Folder\n3 = ZIP", "1");
  if (choice === "1") document.getElementById("file-input").click();
  else if (choice === "2") document.getElementById("folder-input").click();
  else if (choice === "3") document.getElementById("zip-input").click();
};

document.getElementById("btn-import-fs").onclick = () => {
  document.getElementById("json-import").click();
};

document.getElementById("btn-rebuild-tree").onclick = async () => {
  setStatus("Rebuilding file tree…");
  try {
    await fs.rebuildTreeFromFiles();
    await refreshTree();
    setStatus("Tree rebuilt from storage");
  } catch (e) {
    setStatus("Rebuild failed: " + e.message);
  }
};

document.getElementById("file-input").onchange = async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const target = document.getElementById("current-path").textContent || "/";
  setStatus(`Importing ${files.length} file(s)...`);
  try {
    await fs.importFiles(files, fs.isDir(target) ? target : "/");
    refreshTree();
    setStatus(`Imported ${files.length} file(s)`);
  } catch (err) {
    setStatus("Import error: " + err.message);
  }
  e.target.value = "";
};

document.getElementById("folder-input").onchange = async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const target = document.getElementById("current-path").textContent || "/";
  setStatus(`Importing folder (${files.length} items)...`);
  try {
    await fs.importFiles(files, fs.isDir(target) ? target : "/");
    refreshTree();
    setStatus("Folder imported");
  } catch (err) {
    setStatus("Import error: " + err.message);
  }
  e.target.value = "";
};

document.getElementById("zip-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const target = document.getElementById("current-path").textContent || "/";
  setStatus("Importing ZIP...");
  try {
    await fs.importZip(file, fs.isDir(target) ? target : "/");
    refreshTree();
    setStatus("ZIP imported");
  } catch (err) {
    setStatus("ZIP error: " + err.message);
  }
  e.target.value = "";
};

// Chromebook / Downloads folder import via File System Access API
document.getElementById("btn-import-downloads").onclick = async () => {
  if (!window.showDirectoryPicker) {
    alert("File System Access API not supported in this browser.\nUse the regular Folder import instead (works on Chromebook too).");
    document.getElementById("folder-input").click();
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker({
      id: "n3xn-downloads",
      mode: "read",
      startIn: "downloads",
    });
    setStatus("Scanning Downloads...");
    const files = [];
    async function walk(handle, path = "") {
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === "file") {
          const file = await entry.getFile();
          // Fake webkitRelativePath
          Object.defineProperty(file, "webkitRelativePath", {
            value: path ? path + "/" + name : name,
          });
          files.push(file);
        } else if (entry.kind === "directory") {
          await walk(entry, path ? path + "/" + name : name);
        }
      }
    }
    await walk(dirHandle);
    if (files.length === 0) {
      setStatus("No files found");
      return;
    }
    const target = prompt(`Found ${files.length} files. Import into which VFS path?`, "/downloads");
    if (!target) return;
    if (!fs.exists(target)) await fs.mkdir(target);
    await fs.importFiles(files, target);
    refreshTree();
    setStatus(`Imported ${files.length} files from Downloads`);
  } catch (err) {
    if (err.name !== "AbortError") {
      setStatus("Downloads import failed: " + err.message);
      // Fallback
      document.getElementById("folder-input").click();
    }
  }
};

// Export entire FS
document.getElementById("btn-export-fs").onclick = async () => {
  setStatus("Encrypting & exporting...");
  try {
    const data = await db.exportEverything(true);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `n3xn-vfs-${db.getCurrentUser()}-${Date.now()}.n3xn.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Encrypted export downloaded");
  } catch (err) {
    setStatus("Export failed: " + err.message);
  }
};

async function downloadPath(path) {
  try {
    if (fs.isDir(path)) {
      const blob = await fs.exportZip(path);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (path.split("/").pop() || "export") + ".zip";
      a.click();
    } else {
      const f = await fs.readFile(path);
      const blob = new Blob([f.content], { type: f.mime || "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = path.split("/").pop();
      a.click();
    }
  } catch (e) {
    setStatus("Download error: " + e.message);
  }
}

document.getElementById("btn-clear-term").onclick = (e) => {
  e.stopPropagation();
  term.clearTerminal();
};

// ========== RUN / PREVIEW ==========
async function runActiveFile() {
  const path = window.__n3xnActivePath;
  if (!path) {
    setStatus("No file open");
    return;
  }
  const modeSel = document.getElementById("run-mode");
  const mode = modeSel && modeSel.value !== "auto" ? modeSel.value : undefined;
  setStatus(`Running ${path}…`);
  try {
    // Save first so preview uses latest content
    await ed.saveActive();
    await runner.run(path, mode);
    const closeBtn = document.getElementById("btn-preview-close-bar");
    if (closeBtn && runner.isPreviewVisible()) closeBtn.classList.remove("hidden");
    setStatus(`Ran ${path}`);
  } catch (err) {
    setStatus("Run error: " + err.message);
    console.error(err);
  }
}

window.__n3xnRunActive = runActiveFile;
window.__n3xnHidePreview = () => {
  runner.hidePreview();
  const closeBtn = document.getElementById("btn-preview-close-bar");
  if (closeBtn) closeBtn.classList.add("hidden");
};

document.getElementById("btn-save").onclick = async () => {
  try {
    await ed.saveActive();
  } catch (e) {
    alert("Save failed: " + e.message);
  }
};
document.getElementById("btn-run").onclick = () => runActiveFile();
document.getElementById("btn-preview-close-bar").onclick = () => {
  window.__n3xnHidePreview();
};

// Fullscreen helpers
function toggleFs(el) {
  if (!el) return;
  if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
}

document.getElementById("btn-fs-app").onclick = () => {
  toggleFs(document.getElementById("app-screen"));
};
document.getElementById("btn-fs-editor").onclick = () => {
  toggleFs(document.getElementById("editor-area"));
};

const msBtn = document.getElementById("btn-monaco-settings");
if (msBtn) {
  msBtn.onclick = async () => {
    try {
      const monacoSettings = await loadMonacoSettings();
      monacoSettings.defineExtraThemes();
      monacoSettings.openSettingsDrawer();
    } catch (e) {
      alert("Settings: " + e.message);
    }
  };
}

// Surface load errors instead of a silent blank UI
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled rejection", e.reason);
});
window.addEventListener("error", (e) => {
  console.error("Script error", e.message, e.filename);
});

// Media / HTML visual editors — bind safely
function bindToolButtons() {
  const mediaBtn = document.getElementById("btn-media");
  const htmlBtn = document.getElementById("btn-html-visual");

  if (mediaBtn) {
    mediaBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const p = window.__n3xnActivePath || null;
        const ext = (p || "").split(".").pop()?.toLowerCase() || "";
        setStatus("Opening Media editor…");
        if (["mp4", "webm", "mov"].includes(ext)) media.openAVEditor(p, "video");
        else if (["mp3", "wav", "ogg", "m4a"].includes(ext)) media.openAVEditor(p, "audio");
        else media.openMediaEditor(p);
        setStatus("Media editor open");
      } catch (err) {
        console.error(err);
        alert("Media button error: " + err.message);
        setStatus("Media editor failed");
      }
    };
  }

  if (htmlBtn) {
    htmlBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        let p = window.__n3xnActivePath;
        if (!p || !/\.html?$/i.test(p)) {
          p = prompt("HTML file path in VFS:", p || "/index.html");
        }
        if (!p) return;
        setStatus("Opening HTML visual editor…");
        htmlVisual.openHtmlVisual(p);
        setStatus("HTML visual editor open");
      } catch (err) {
        console.error(err);
        alert("HTML+ button error: " + err.message);
        setStatus("HTML visual failed");
      }
    };
  }
}

bindToolButtons();

// Console helpers: openMediaEditor() / openHtmlVisual('/page.html')
window.openMediaEditor = (p) => media.openMediaEditor(p || window.__n3xnActivePath || null);
window.openHtmlVisual = (p) =>
  htmlVisual.openHtmlVisual(p || window.__n3xnActivePath || "/index.html");

document.addEventListener("fullscreenchange", () => {
  requestAnimationFrame(() => {
    const inst = ed.getEditor && ed.getEditor();
    if (inst) inst.layout();
  });
});

// Collapsible terminal
const termPanel = document.getElementById("terminal-panel");
const termToggleBtn = document.getElementById("btn-toggle-term");

function toggleTerminal() {
  termPanel.classList.toggle("collapsed");
  const collapsed = termPanel.classList.contains("collapsed");
  termToggleBtn.textContent = collapsed ? "▲" : "▼";
  // Resize Monaco after terminal height change
  requestAnimationFrame(() => {
    const edInstance = ed.getEditor && ed.getEditor();
    if (edInstance) edInstance.layout();
  });
}

document.getElementById("terminal-toggle").onclick = (e) => {
  // Don't toggle when clicking clear button
  if (e.target.closest("#btn-clear-term")) return;
  toggleTerminal();
};

document.getElementById("btn-toggle-term").onclick = (e) => {
  e.stopPropagation();
  toggleTerminal();
};

function setStatus(msg) {
  document.getElementById("status-msg").textContent = msg;
}

// Start
showAuth();


/* ========== PWA / Service Worker (ChromeOS install) ========== */
let deferredInstallPrompt = null;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const swUrl = new URL("../sw.js", import.meta.url);
  // Prefer root-relative so scope covers the app
  const path = "./sw.js";
  navigator.serviceWorker
    .register(path, { scope: "./" })
    .then((reg) => {
      console.log("[n3xn] SW registered", reg.scope);
      reg.update().catch(() => {});
    })
    .catch((err) => console.warn("[n3xn] SW register failed (ignored)", err && err.message ? err.message : err));
}

function setupInstallPrompt() {
  const btn = document.getElementById("btn-install-pwa");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btn) {
      btn.classList.remove("hidden");
      btn.style.display = "inline-block";
    }
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (btn) {
      btn.style.display = "none";
      btn.classList.add("hidden");
    }
    setStatus?.("App installed");
  });
  if (btn) {
    btn.onclick = async () => {
      if (!deferredInstallPrompt) {
        alert(
          "Install not available yet.\n\nOn ChromeOS: open the browser menu (⋮) → Install page / Save and share → Install n3xn VFS.\n\nNeeds HTTPS + this site opened in Chrome."
        );
        return;
      }
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (btn) btn.style.display = "none";
      console.log("[n3xn] install choice", choice);
    };
  }
}

registerServiceWorker();
setupInstallPrompt();


/* ========== GitHub panel ========== */
(function setupGithubUi() {
  const btn = document.getElementById("btn-github");
  if (!btn) return;
  btn.onclick = async () => {
    try {
      const gh = await import("./github.js");
      const storage = await import("./storage-backends.js");
      gh.setLogger((msg) => {
        try {
          const el = document.getElementById("terminal-output");
          if (el) {
            const d = document.createElement("div");
            d.className = "out";
            d.textContent = msg;
            el.appendChild(d);
          }
        } catch (_) {}
      });
      // try restore token
      if (!gh.isAuthed() && db.getPassword()) {
        await gh.loadSavedToken().catch(() => {});
      }
      openGithubPanel(gh, storage);
    } catch (e) {
      alert("GitHub module: " + e.message);
    }
  };

  function openGithubPanel(gh, storage) {
    let panel = document.getElementById("github-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "github-panel";
      panel.style.cssText =
        "position:fixed;inset:24px;z-index:99998;background:#0a0a0f;border:1px solid #333;" +
        "border-radius:8px;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(255,255,255,0.1);overflow:hidden";
      panel.innerHTML = `
        <div style="padding:10px 14px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center">
          <strong style="color:#8cf">GitHub VFS</strong>
          <button type="button" id="gh-close" class="btn small ghost">✕</button>
        </div>
        <div style="padding:12px 14px;overflow:auto;flex:1;font-size:12px;color:#ccc" id="gh-body"></div>
      `;
      document.body.appendChild(panel);
      panel.querySelector("#gh-close").onclick = () => {
        panel.style.display = "none";
      };
    }
    panel.style.display = "flex";
    const body = panel.querySelector("#gh-body");
    const u = gh.getUser();
    const cr = gh.getCurrentRepo();
    body.innerHTML = `
      <p style="color:#888;margin:0 0 10px">Separate from local VFS. Cache under <code>/gh/owner/repo/</code>. Token encrypted with account password.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <button type="button" class="btn small primary" id="gh-auth">Set classic PAT</button>
        <button type="button" class="btn small" id="gh-repos">List repos</button>
        <button type="button" class="btn small" id="gh-pull">Pull tree</button>
        <button type="button" class="btn small" id="gh-help">Token help</button>
        <button type="button" class="btn small ghost" id="gh-logout">Clear token</button>
      </div>
      <p><b>User:</b> ${u ? u.login : "(not signed in)"}</p>
      <p><b>Repo:</b> ${cr ? cr.owner + "/" + cr.repo + "@" + cr.branch : "(none — gh use owner/repo)"}</p>
      <p><b>Cache storage:</b> ${storage.getBackendId()} —
        <select id="gh-storage">
          ${storage.listBackends().map((b) => `<option value="${b.id}" ${b.id === storage.getBackendId() ? "selected" : ""}>${b.label}</option>`).join("")}
        </select>
      </p>
      <label>owner/repo</label>
      <input id="gh-repo-input" placeholder="owner/repo" value="${cr ? cr.owner + "/" + cr.repo : ""}"
        style="width:100%;margin:4px 0 8px;padding:6px;background:#111;border:1px solid #333;color:#eee" />
      <button type="button" class="btn small" id="gh-use">Use repo</button>
      <pre id="gh-out" style="margin-top:12px;background:#05070f;padding:8px;max-height:40vh;overflow:auto;white-space:pre-wrap"></pre>
    `;
    const out = (s) => {
      body.querySelector("#gh-out").textContent = typeof s === "string" ? s : JSON.stringify(s, null, 2);
    };
    body.querySelector("#gh-auth").onclick = async () => {
      const tok = prompt("GitHub classic token (ghp_…):");
      if (!tok) return;
      try {
        const user = await gh.setToken(tok);
        out("Signed in as " + user.login);
        openGithubPanel(gh, storage);
      } catch (e) {
        out("Error: " + e.message);
      }
    };
    body.querySelector("#gh-logout").onclick = async () => {
      await gh.clearToken();
      openGithubPanel(gh, storage);
    };
    body.querySelector("#gh-help").onclick = () => out(gh.tokenHelp());
    body.querySelector("#gh-repos").onclick = async () => {
      try {
        const repos = await gh.listRepos();
        out(repos.map((r) => `${r.private ? "[private]" : "[public]"} ${r.full_name}`).join("\n"));
      } catch (e) {
        out(e.message);
      }
    };
    body.querySelector("#gh-use").onclick = async () => {
      const spec = body.querySelector("#gh-repo-input").value.trim();
      if (!spec.includes("/")) return out("owner/repo required");
      const [o, r] = spec.split("/");
      try {
        await gh.setRepo(o, r);
        openGithubPanel(gh, storage);
      } catch (e) {
        out(e.message);
      }
    };
    body.querySelector("#gh-pull").onclick = async () => {
      const cr2 = gh.getCurrentRepo();
      if (!cr2) return out("Select a repo first");
      try {
        const n = await gh.pullTree(cr2.owner, cr2.repo, cr2.branch);
        out("Pulled " + n + " files");
        if (window.refreshTree) window.refreshTree();
      } catch (e) {
        out(e.message);
      }
    };
    body.querySelector("#gh-storage").onchange = (e) => {
      storage.setBackend(e.target.value);
      out("Storage: " + storage.getBackendId());
    };
  }
})();

// Restore GitHub token after login
const _bootApp = typeof bootApp === "function" ? bootApp : null;


/* ========== Chat sidebar (public rooms) ========== */
(function initChatSidebar() {
  const side = document.getElementById("chat-sidebar");
  if (!side) {
    console.warn("[n3xn] chat-sidebar element missing from DOM");
    return;
  }
  document.querySelectorAll(".open-chat-btn, #btn-chat-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (btn.id === "btn-chat-toggle") {
        side.classList.toggle("collapsed");
      } else {
        side.classList.remove("collapsed");
      }
      side.style.display = "flex";
      const collapsed = side.classList.contains("collapsed");
      import("./chat.js").then((c) => c.setSidebarCollapsed?.(collapsed)).catch(() => {});
    });
  });

  const msgs = document.getElementById("chat-messages");
  const peersEl = document.getElementById("chat-peers");
  const micBtn = document.getElementById("btn-mic");
  let videoOn = false;

  function appendMsg(m) {
    if (!msgs) return;
    import("./collab.js").then(async (collab) => {
      // reuse markdown renderer from collab if exported
      let body;
      try {
        const { renderMarkdownSafe } = await import("./collab.js");
        body = renderMarkdownSafe(m.text);
      } catch {
        body = document.createElement("div");
        body.textContent = m.text;
      }
      const wrap = document.createElement("div");
      wrap.className = "chat-msg";
      const meta = document.createElement("div");
      meta.className = "chat-msg-meta";
      meta.textContent = `${m.user || m.from} · ${new Date(m.ts || Date.now()).toLocaleTimeString()}`;
      const content = document.createElement("div");
      content.className = "chat-msg-body";
      content.appendChild(body);
      wrap.appendChild(meta);
      wrap.appendChild(content);
      msgs.appendChild(wrap);
      msgs.scrollTop = msgs.scrollHeight;
    });
  }

  function renderPeers(st) {
    if (!peersEl) return;
    peersEl.innerHTML = "";
    (st.peers || []).forEach((p) => {
      const el = document.createElement("span");
      el.className = "chat-peer" + (p.mic ? " mic-on" : "") + (p.level > 0.12 ? " talking" : "");
      el.id = "chat-peer-" + p.id;
      el.textContent = (p.user || p.id).slice(0, 16) + (p.mic ? " 🎤" : "");
      el.style.boxShadow = p.level > 0.05 ? `0 0 ${8 + p.level * 20}px rgba(0,243,255,${0.3 + p.level * 0.5})` : "";
      peersEl.appendChild(el);
    });
    if (micBtn) {
      micBtn.classList.toggle("mic-on", st.mic);
      micBtn.classList.toggle("mic-off", !st.mic);
    }
  }

  // toggle handled via .open-chat-btn / #btn-chat-toggle above

  // offer file-bound room when a collab path is active
  const roomSel = document.getElementById("chat-room-select");
  setInterval(() => {
    if (!roomSel) return;
    const path = window.__n3xnActivePath;
    let opt = roomSel.querySelector('option[data-file-room]');
    if (path && path.startsWith("/collab/")) {
      if (!opt) {
        opt = document.createElement("option");
        opt.dataset.fileRoom = "1";
        roomSel.appendChild(opt);
      }
      const rid = "file-" + path.replace(/\W+/g, "-").slice(0, 40);
      opt.value = rid;
      opt.textContent = "File: " + path.slice(0, 28);
    } else if (opt) {
      opt.remove();
    }
  }, 1000);

  document.getElementById("btn-chat-join")?.addEventListener("click", async () => {
    const chat = await import("./chat.js");
    const relay = document.getElementById("chat-relay-url")?.value?.trim();
    const room = document.getElementById("chat-room-select")?.value || "global-text";
    if (!relay) {
      setStatus("Enter WSS relay base URL");
      return;
    }
    chat.setChatHandlers({
      log: (m, c) => setStatus(m),
      message: appendMsg,
      presence: renderPeers,
      vcLevel: (id, level) => {
        const el = document.getElementById("chat-peer-" + id);
        if (el) {
          el.classList.toggle("talking", level > 0.12);
          el.style.boxShadow =
            level > 0.05 ? `0 0 ${8 + level * 20}px rgba(0,243,255,${0.3 + level * 0.5})` : "";
        }
      },
    });
    await chat.chatConnect(relay, room);
    setStatus("Joined chat room " + room);
  });

  document.getElementById("btn-chat-leave")?.addEventListener("click", async () => {
    const chat = await import("./chat.js");
    await chat.chatDisconnect();
  });

  document.getElementById("btn-chat-send")?.addEventListener("click", async () => {
    const chat = await import("./chat.js");
    const input = document.getElementById("chat-input");
    const text = input?.value || "";
    await chat.sendChat(text);
    if (input) input.value = "";
  });

  document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("btn-chat-send")?.click();
    }
  });

  micBtn?.addEventListener("click", async () => {
    const chat = await import("./chat.js");
    if (!chat.isChatConnected()) {
      // fall back: collab room mic if available
      setStatus("Join a chat room first (or use wss VC)");
    }
    const on = await chat.toggleMic();
    setStatus(on ? "Mic on" : "Mic off");
  });

  document.getElementById("btn-vc-join")?.addEventListener("click", async () => {
    const chat = await import("./chat.js");
    await chat.joinVcMesh();
  });

  document.getElementById("btn-vc-video")?.addEventListener("click", async () => {
    const chat = await import("./chat.js");
    videoOn = !videoOn;
    await chat.setVideo(videoOn);
    setStatus(videoOn ? "Video on" : "Video off");
  });
})();


import("./n3xn-devtools.js")
  .then((dt) => dt.mountHostDevtools())
  .catch((e) => console.warn("[n3xn] devtools", e));
