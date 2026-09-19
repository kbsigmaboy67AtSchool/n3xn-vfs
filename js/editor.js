/**
 * n3xn VFS v2 — Monaco Editor integration
 * Supports all Monaco themes, settings, large files
 */

import * as fs from "./fs.js";

let editor = null;
let openTabs = []; // { path, model, viewState }
let activePath = null;
let monacoReady = false;
let monacoLoading = null;

const MONACO_THEMES = [
  "vs-dark",
  "hc-black",
  "vs",
  "hc-light",
];

// Extra custom dark theme matching n3xn
const N3XN_THEME = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6a6a80", fontStyle: "italic" },
    { token: "keyword", foreground: "ffffff" },
    { token: "string", foreground: "a0a0c0" },
    { token: "number", foreground: "c0c0e0" },
  ],
  colors: {
    "editor.background": "#050508",
    "editor.foreground": "#e8e8f0",
    "editor.lineHighlightBackground": "#0f0f16",
    "editorCursor.foreground": "#ffffff",
    "editor.selectionBackground": "#ffffff22",
    "editorLineNumber.foreground": "#44445a",
    "editorLineNumber.activeForeground": "#8888a0",
    "editorWidget.background": "#0a0a0f",
    "editorWidget.border": "#1a1a28",
  },
};

export function initEditor() {
  // Idempotent — prevents AMD "Duplicate definition of module 'vs/editor/editor.main'"
  if (editor && monacoReady) return Promise.resolve(editor);
  if (monacoLoading) return monacoLoading;

  monacoLoading = new Promise((resolve, reject) => {
    const MONACO_VS = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs";

    self.MonacoEnvironment = {
      getWorkerUrl: function (_moduleId, label) {
        const map = {
          json: "language/json/jsonWorker.js",
          css: "language/css/cssWorker.js",
          scss: "language/css/cssWorker.js",
          less: "language/css/cssWorker.js",
          html: "language/html/htmlWorker.js",
          handlebars: "language/html/htmlWorker.js",
          razor: "language/html/htmlWorker.js",
          typescript: "language/typescript/tsWorker.js",
          javascript: "language/typescript/tsWorker.js",
        };
        const rel = map[label] || "base/worker/workerMain.js";
        const workerFull = MONACO_VS + "/" + rel;
        const code =
          "self.MonacoEnvironment={baseUrl:" +
          JSON.stringify(MONACO_VS + "/") +
          "};importScripts(" +
          JSON.stringify(workerFull) +
          ");";
        return URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
      },
    };

    const create = () => {
      try {
        monaco.editor.defineTheme("n3xn-dark", N3XN_THEME);
        monaco.editor.setTheme("n3xn-dark");
      } catch (_) {}
      import("./monaco-settings.js")
        .then((ms) => ms.defineExtraThemes())
        .catch(() => {});

      if (editor) {
        monacoReady = true;
        resolve(editor);
        return;
      }

      editor = monaco.editor.create(document.getElementById("monaco-container"), {
        value: "",
        language: "plaintext",
        theme: "n3xn-dark",
        fontFamily: "'JetBrains Mono', 'Share Tech Mono', monospace",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: true },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        tabSize: 2,
        renderWhitespace: "selection",
        cursorBlinking: "smooth",
        smoothScrolling: true,
        largeFileOptimizations: true,
      });

      editor.onDidChangeModelContent(() => {
        const tab = openTabs.find((t) => t.path === activePath);
        if (tab) tab.dirty = true;
        updateTabUI();
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveActive();
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        if (window.__n3xnRunActive) window.__n3xnRunActive();
      });

      window.__n3xnEditor = editor;
      monacoReady = true;
      resolve(editor);
    };

    // Already loaded (e.g. second bootApp without full reload)
    if (typeof window.monaco !== "undefined" && window.monaco.editor) {
      create();
      return;
    }

    if (typeof require === "undefined") {
      monacoLoading = null;
      reject(new Error("Monaco loader (require) not found — check loader.js script tag"));
      return;
    }

    require.config({
      paths: { vs: MONACO_VS },
    });
    require(["vs/editor/editor.main"], create, (err) => {
      monacoLoading = null;
      reject(err || new Error("Monaco failed to load"));
    });
  });

  return monacoLoading;
}

function mediaKind(path, mime) {
  const ext = (path || "").split(".").pop()?.toLowerCase() || "";
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"].includes(ext))
    return "image";
  if (m.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext))
    return "audio";
  if (m.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(ext))
    return "video";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  return null;
}

function showMediaView(html) {
  const mv = document.getElementById("media-view");
  const mc = document.getElementById("monaco-container");
  if (mc) mc.classList.add("hidden");
  if (mv) {
    mv.classList.remove("hidden");
    mv.innerHTML = html;
  }
  document.getElementById("empty-editor")?.classList.add("hidden");
}

function showMonacoView() {
  const mv = document.getElementById("media-view");
  const mc = document.getElementById("monaco-container");
  if (mv) {
    mv.querySelectorAll("[data-blob-url]").forEach((el) => {
      try {
        URL.revokeObjectURL(el.getAttribute("data-blob-url"));
      } catch {}
    });
    mv.classList.add("hidden");
    mv.innerHTML = "";
  }
  if (mc) mc.classList.remove("hidden");
}

function revokeTabBlob(tab) {
  if (tab?.blobUrl) {
    try {
      URL.revokeObjectURL(tab.blobUrl);
    } catch {}
    tab.blobUrl = null;
  }
}

export async function openFile(path) {
  if (!monacoReady) return;

  // Already open?
  let tab = openTabs.find((t) => t.path === path);
  if (tab) {
    switchTo(path);
    setEditingMode(true);
    return;
  }

  const file = await fs.readFile(path);
  if (!file) throw new Error("Cannot open file");

  const kind = mediaKind(path, file.mime);
  const mime = file.mime || "application/octet-stream";

  if (kind) {
    // Binary media — never decode as text / never put in Monaco
    const blob = new Blob([file.content], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    tab = {
      path,
      model: null,
      media: true,
      kind,
      mime,
      size: file.size || file.content.length,
      blobUrl,
      dirty: false,
      viewState: null,
    };
    openTabs.push(tab);
    switchTo(path);
    updateTabUI();
    setEditingMode(true);
    return;
  }

  // Text files → Monaco
  const text = file.text();
  const lang = detectLanguage(path);
  const model = monaco.editor.createModel(text, lang);
  tab = { path, model, media: false, dirty: false, viewState: null };
  openTabs.push(tab);
  switchTo(path);
  updateTabUI();
  document.getElementById("empty-editor").classList.add("hidden");
  showMonacoView();
  setEditingMode(true);

  requestAnimationFrame(() => {
    if (editor) editor.layout();
  });
}

function setEditingMode(on) {
  const layout = document.getElementById("main-layout");
  if (!layout) return;
  if (on) {
    layout.classList.remove("explorer-mode");
    layout.classList.add("editing-mode");
  } else {
    layout.classList.remove("editing-mode");
    layout.classList.add("explorer-mode");
  }
  // Let Monaco resize after layout change
  requestAnimationFrame(() => {
    if (editor) editor.layout();
  });
}

function renderMediaTab(tab) {
  const name = tab.path.split("/").pop();
  const size = tab.size ? `${(tab.size / 1024).toFixed(1)} KB` : "";
  const url = tab.blobUrl;
  let body = "";
  if (tab.kind === "image") {
    body = `<img src="${url}" data-blob-url="${url}" alt="${name}" class="mv-image" />`;
  } else if (tab.kind === "audio") {
    body = `<audio src="${url}" data-blob-url="${url}" controls class="mv-audio"></audio>`;
  } else if (tab.kind === "video") {
    body = `<video src="${url}" data-blob-url="${url}" controls class="mv-video"></video>`;
  } else if (tab.kind === "pdf") {
    body = `<iframe src="${url}" data-blob-url="${url}" class="mv-pdf" title="${name}"></iframe>`;
  }
  showMediaView(`
    <div class="mv-wrap">
      <div class="mv-meta">
        <strong>${name}</strong>
        <span>${tab.mime || tab.kind} · ${size}</span>
        <a class="btn small" href="${url}" target="_blank" rel="noopener">Open blob</a>
        <button type="button" class="btn small" id="mv-open-media-ed">Media editor</button>
      </div>
      <div class="mv-body">${body}</div>
    </div>
  `);
  const btn = document.getElementById("mv-open-media-ed");
  if (btn) {
    btn.onclick = () => {
      if (window.openMediaEditor) window.openMediaEditor(tab.path);
    };
  }
}

function switchTo(path) {
  if (activePath && editor) {
    const prev = openTabs.find((t) => t.path === activePath);
    if (prev && prev.model) prev.viewState = editor.saveViewState();
  }
  activePath = path;
  window.__n3xnActivePath = path;
  const tab = openTabs.find((t) => t.path === path);
  if (tab) {
    if (tab.media) {
      if (editor) editor.setModel(null);
      renderMediaTab(tab);
    } else {
      showMonacoView();
      if (tab.model) {
        editor.setModel(tab.model);
        if (tab.viewState) editor.restoreViewState(tab.viewState);
        editor.focus();
      }
      requestAnimationFrame(() => {
        if (editor) editor.layout();
      });
    }
  }
  updateTabUI();
  // Suggest run mode based on extension
  const sel = document.getElementById("run-mode");
  if (sel && path) {
    const ext = path.split(".").pop()?.toLowerCase();
    const map = {
      html: "html-window", htm: "html-window",
      js: "js", mjs: "js", cjs: "js",
      py: "python",
      "n3-site": "n3-site",
      png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image",
      mp3: "blob-open", wav: "blob-open", ogg: "blob-open",
      mp4: "blob-open", webm: "blob-open", mov: "blob-open",
      md: "markdown", markdown: "markdown",
      json: "json",
      css: "css", scss: "css", less: "css",
    };
    if (map[ext]) sel.value = map[ext];
    else sel.value = "auto";
  }
  // Per-file / global Monaco settings
  if (!tab?.media && path) {
    import("./monaco-settings.js")
      .then((ms) => ms.applyForOpenFile(path))
      .catch(() => {});
  }
}

export async function saveActive() {
  if (!activePath) return;
  const tab = openTabs.find((t) => t.path === activePath);
  if (!tab) return;
  // Media tabs are binary — do not save Monaco text over them
  if (tab.media || !tab.model) {
    setStatus("Media file — use Media editor / export to modify");
    return;
  }
  const content = tab.model.getValue();
  await fs.writeFile(activePath, content);
  tab.dirty = false;
  updateTabUI();
  setStatus(`Saved ${activePath}`);
}

export function closeTab(path) {
  const idx = openTabs.findIndex((t) => t.path === path);
  if (idx === -1) return;
  const tab = openTabs[idx];
  if (tab.dirty && !confirm(`${path} has unsaved changes. Close anyway?`)) return;
  if (tab.model) tab.model.dispose();
  revokeTabBlob(tab);
  openTabs.splice(idx, 1);
  if (activePath === path) {
    activePath = openTabs.length ? openTabs[Math.max(0, idx - 1)].path : null;
    if (activePath) {
      switchTo(activePath);
    } else {
      if (editor) editor.setModel(null);
      window.__n3xnActivePath = null;
      showMonacoView();
      document.getElementById("empty-editor")?.classList.remove("hidden");
      setEditingMode(false);
      if (window.__n3xnHidePreview) window.__n3xnHidePreview();
    }
  }
  updateTabUI();
}

export function hasOpenTabs() {
  return openTabs.length > 0;
}

function updateTabUI() {
  const container = document.getElementById("editor-tabs");
  container.innerHTML = "";
  openTabs.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (t.path === activePath ? " active" : "");
    el.innerHTML = `<span>${t.path.split("/").pop()}${t.dirty ? " •" : ""}</span><span class="close">×</span>`;
    el.querySelector("span").onclick = () => switchTo(t.path);
    el.querySelector(".close").onclick = (e) => {
      e.stopPropagation();
      closeTab(t.path);
    };
    container.appendChild(el);
  });
}

function detectLanguage(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  const map = {
    js: "javascript",
    mjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    jsx: "javascript",
    json: "json",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    less: "less",
    md: "markdown",
    py: "python",
    "n3-site": "html",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    c: "c",
    cpp: "cpp",
    h: "c",
    java: "java",
    go: "go",
    rs: "rust",
    rb: "ruby",
    php: "php",
    sql: "sql",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    ini: "ini",
    txt: "plaintext",
  };
  return map[ext] || "plaintext";
}

export function getEditor() {
  return editor;
}

export function setEditorOption(key, value) {
  if (editor) editor.updateOptions({ [key]: value });
}

export function setTheme(themeName) {
  if (monacoReady) monaco.editor.setTheme(themeName);
}

function setStatus(msg) {
  const el = document.getElementById("status-msg");
  if (el) el.textContent = msg;
}
