/**
 * n3xn VFS v2 — Monaco Editor integration
 * Supports all Monaco themes, settings, large files
 */

import * as fs from "./fs.js";

let editor = null;
let openTabs = []; // { path, model, viewState }
let activePath = null;
let monacoReady = false;

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
  return new Promise((resolve) => {
    require.config({
      paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs" },
    });
    require(["vs/editor/editor.main"], () => {
      monaco.editor.defineTheme("n3xn-dark", N3XN_THEME);
      monaco.editor.setTheme("n3xn-dark");

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
        // Large file friendly
        largeFileOptimizations: true,
      });

      editor.onDidChangeModelContent(() => {
        // Mark dirty
        const tab = openTabs.find((t) => t.path === activePath);
        if (tab) tab.dirty = true;
        updateTabUI();
      });

      // Ctrl+S save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveActive();
      });

      monacoReady = true;
      resolve(editor);
    });
  });
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

  // For very large files (>2MB) warn and load as binary/text carefully
  const text = file.text();
  const lang = detectLanguage(path);

  const model = monaco.editor.createModel(text, lang);
  tab = { path, model, dirty: false, viewState: null };
  openTabs.push(tab);
  switchTo(path);
  updateTabUI();
  document.getElementById("empty-editor").classList.add("hidden");
  document.getElementById("monaco-container").classList.remove("hidden");
  setEditingMode(true);

  // Force Monaco to recalculate layout after becoming visible
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

function switchTo(path) {
  if (activePath && editor) {
    const prev = openTabs.find((t) => t.path === activePath);
    if (prev) prev.viewState = editor.saveViewState();
  }
  activePath = path;
  const tab = openTabs.find((t) => t.path === path);
  if (tab) {
    editor.setModel(tab.model);
    if (tab.viewState) editor.restoreViewState(tab.viewState);
    editor.focus();
  }
  updateTabUI();
}

export async function saveActive() {
  if (!activePath) return;
  const tab = openTabs.find((t) => t.path === activePath);
  if (!tab) return;
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
  tab.model.dispose();
  openTabs.splice(idx, 1);
  if (activePath === path) {
    activePath = openTabs.length ? openTabs[Math.max(0, idx - 1)].path : null;
    if (activePath) {
      switchTo(activePath);
    } else {
      editor.setModel(null);
      document.getElementById("empty-editor").classList.remove("hidden");
      setEditingMode(false);
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
