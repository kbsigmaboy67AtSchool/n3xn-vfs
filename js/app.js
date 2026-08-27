/**
 * n3xn Virtual FileSystem v2 — Main Application
 */

import * as db from "./db.js";
import * as fs from "./fs.js";
import * as term from "./terminal.js";
import * as ed from "./editor.js";
import * as runner from "./runner.js";

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
  const accounts = db.listAccounts();
  select.innerHTML = "";
  if (accounts.length === 0) {
    select.innerHTML = '<option value="">No accounts — create one</option>';
  } else {
    accounts.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.username;
      opt.textContent = a.username;
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
    const json = JSON.parse(text);
    const pass = prompt("Password for this export:");
    if (!pass) return;
    const user = await db.importEverything(json, pass);
    alert(`Imported as ${user}. You can now sign in.`);
    refreshAccountList();
    document.getElementById("account-select").value = user;
  } catch (err) {
    alert("Import failed: " + err.message);
  }
  e.target.value = "";
};

// ========== BOOT ==========

async function bootApp() {
  showApp();
  await fs.loadTree();
  term.initTerminal();
  await ed.initEditor();
  refreshTree();
  window.refreshTree = refreshTree;
  setStatus("Ready — encrypted & local");
}

// ========== FILE TREE ==========

function refreshTree() {
  const container = document.getElementById("file-tree");
  container.innerHTML = "";
  renderNode(container, fs.getTree(), "/", 0);
}

function renderNode(container, node, path, depth) {
  if (node.type !== "dir") return;
  const entries = Object.entries(node.children).sort((a, b) => {
    if (a[1].type !== b[1].type) return a[1].type === "dir" ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });

  for (const [name, child] of entries) {
    const full = path === "/" ? "/" + name : path + "/" + name;
    const item = document.createElement("div");
    item.className = "tree-item";
    item.style.paddingLeft = 10 + depth * 12 + "px";
    item.innerHTML = `<span class="icon">${child.type === "dir" ? "📁" : "📄"}</span><span class="name">${name}</span>`;
    item.onclick = async () => {
      document.querySelectorAll(".tree-item").forEach((el) => el.classList.remove("active"));
      item.classList.add("active");
      document.getElementById("current-path").textContent = full;
      if (child.type === "file") {
        try {
          await ed.openFile(full);
        } catch (e) {
          setStatus("Error: " + e.message);
        }
      }
    };
    item.oncontextmenu = (e) => {
      e.preventDefault();
      // Simple context actions via prompt
      const action = prompt(`Actions for ${full}:\n1 = Rename\n2 = Delete\n3 = Download`, "2");
      if (action === "2") {
        if (confirm(`Delete ${full}?`)) {
          fs.removeRecursive(full).then(refreshTree);
        }
      } else if (action === "3") {
        downloadPath(full);
      } else if (action === "1") {
        const newName = prompt("New name:", name);
        if (newName && newName !== name) {
          // simplistic rename via cp + rm
          const parent = full.split("/").slice(0, -1).join("/") || "/";
          const dest = parent === "/" ? "/" + newName : parent + "/" + newName;
          (async () => {
            if (child.type === "file") {
              const f = await fs.readFile(full);
              await fs.writeFile(dest, f.content, { mime: f.mime });
              await fs.remove(full);
            }
            refreshTree();
          })();
        }
      }
    };
    container.appendChild(item);
    if (child.type === "dir") {
      renderNode(container, child, full, depth + 1);
    }
  }
}

// ========== SIDEBAR ACTIONS ==========

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

document.getElementById("btn-run").onclick = () => runActiveFile();
document.getElementById("btn-preview-close-bar").onclick = () => {
  window.__n3xnHidePreview();
};

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
