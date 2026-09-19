/**
 * n3xn VFS v2 — Monaco settings drawer, themes, presets, per-file / global
 */

import * as db from "./db.js";

const GLOBAL_KEY = "monaco_settings_global";
const PRESETS_KEY = "monaco_presets";
const FILE_PREFIX = "monaco_file:";

const THEMES = {
  "n3xn-dark": "n3xn Dark (default)",
  "vs-dark": "VS Dark",
  "hc-black": "High Contrast Black",
  cyberpunk: "Cyberpunk",
  dracula: "Dracula-ish",
  matrix: "Matrix",
  amber: "Amber Terminal",
};

const DEFAULTS = {
  theme: "n3xn-dark",
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Share Tech Mono', monospace",
  wordWrap: "off",
  minimap: true,
  lineNumbers: "on",
  tabSize: 2,
  insertSpaces: true,
  cursorBlinking: "smooth",
  renderWhitespace: "selection",
  smoothScrolling: true,
  mouseWheelZoom: true,
  bracketPairColorization: true,
};

let panel = null;
let scope = "global"; // global | file
let presets = {};

function getEditor() {
  return window.__n3xnEditor;
}

export function defineExtraThemes() {
  if (!window.monaco) return;
  monaco.editor.defineTheme("cyberpunk", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6272a4" },
      { token: "keyword", foreground: "ff79c6" },
      { token: "string", foreground: "f1fa8c" },
      { token: "number", foreground: "bd93f9" },
    ],
    colors: {
      "editor.background": "#0d111e",
      "editor.foreground": "#e2e8f0",
      "editor.lineHighlightBackground": "#1e293b80",
      "editorCursor.foreground": "#00f3ff",
      "editor.selectionBackground": "#00f3ff33",
      "editorLineNumber.foreground": "#334155",
      "editorLineNumber.activeForeground": "#00f3ff",
    },
  });
  monaco.editor.defineTheme("dracula", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6272a4" },
      { token: "keyword", foreground: "ff79c6" },
      { token: "string", foreground: "f1fa8c" },
    ],
    colors: {
      "editor.background": "#282a36",
      "editor.foreground": "#f8f8f2",
      "editorCursor.foreground": "#ff79c6",
    },
  });
  monaco.editor.defineTheme("matrix", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "1a5c1a" },
      { token: "keyword", foreground: "00ff66" },
      { token: "string", foreground: "88ff88" },
    ],
    colors: {
      "editor.background": "#020805",
      "editor.foreground": "#00ff66",
      "editorCursor.foreground": "#00ff66",
      "editor.lineHighlightBackground": "#00330040",
    },
  });
  monaco.editor.defineTheme("amber", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "665522" },
      { token: "keyword", foreground: "ffcc00" },
      { token: "string", foreground: "ffaa00" },
    ],
    colors: {
      "editor.background": "#120e06",
      "editor.foreground": "#ffb000",
      "editorCursor.foreground": "#ffcc00",
    },
  });
}

export async function loadPresets() {
  try {
    const p = await db.getMeta(PRESETS_KEY);
    presets = p || builtInPresets();
  } catch {
    presets = builtInPresets();
  }
  return presets;
}

function builtInPresets() {
  return {
    default: { ...DEFAULTS, name: "Default" },
    cyberpunk: {
      ...DEFAULTS,
      name: "Cyberpunk",
      theme: "cyberpunk",
      fontSize: 14,
      minimap: true,
      wordWrap: "on",
    },
    matrix: {
      ...DEFAULTS,
      name: "Matrix",
      theme: "matrix",
      fontSize: 13,
      minimap: false,
      fontFamily: "'Share Tech Mono', monospace",
    },
    focus: {
      ...DEFAULTS,
      name: "Focus",
      minimap: false,
      lineNumbers: "off",
      fontSize: 15,
      wordWrap: "on",
    },
  };
}

export async function getSettingsForPath(path) {
  if (path) {
    try {
      const fileSet = await db.getMeta(FILE_PREFIX + path);
      if (fileSet) return { ...DEFAULTS, ...fileSet, _scope: "file" };
    } catch {}
  }
  try {
    const g = await db.getMeta(GLOBAL_KEY);
    if (g) return { ...DEFAULTS, ...g, _scope: "global" };
  } catch {}
  return { ...DEFAULTS, _scope: "global" };
}

export function applySettings(settings) {
  const ed = getEditor();
  if (!ed || !window.monaco) return;
  defineExtraThemes();
  const s = { ...DEFAULTS, ...settings };
  try {
    monaco.editor.setTheme(s.theme || "n3xn-dark");
  } catch {
    monaco.editor.setTheme("vs-dark");
  }
  ed.updateOptions({
    fontSize: Number(s.fontSize) || 13,
    fontFamily: s.fontFamily,
    wordWrap: s.wordWrap || "off",
    minimap: { enabled: !!s.minimap },
    lineNumbers: s.lineNumbers || "on",
    tabSize: Number(s.tabSize) || 2,
    insertSpaces: s.insertSpaces !== false,
    cursorBlinking: s.cursorBlinking || "smooth",
    renderWhitespace: s.renderWhitespace || "selection",
    smoothScrolling: !!s.smoothScrolling,
    mouseWheelZoom: !!s.mouseWheelZoom,
    "bracketPairColorization.enabled": s.bracketPairColorization !== false,
  });
}

export async function saveSettings(settings, { path = null, asGlobal = true } = {}) {
  const clean = { ...settings };
  delete clean._scope;
  delete clean.name;
  if (asGlobal || !path) {
    await db.setMeta(GLOBAL_KEY, clean);
  } else {
    await db.setMeta(FILE_PREFIX + path, clean);
  }
}

export async function savePreset(name, settings) {
  await loadPresets();
  presets[name] = { ...settings, name };
  delete presets[name]._scope;
  await db.setMeta(PRESETS_KEY, presets);
}

export function getPresets() {
  return presets;
}

export function openSettingsDrawer() {
  ensurePanel();
  panel.style.display = "flex";
  fillForm();
}

export function closeSettingsDrawer() {
  if (panel) panel.style.display = "none";
}

function ensurePanel() {
  if (panel && document.body.contains(panel)) return;
  panel = document.createElement("div");
  panel.id = "monaco-settings-drawer";
  panel.style.cssText =
    "display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.55);" +
    "justify-content:flex-end";
  panel.innerHTML = `
    <div style="width:320px;max-width:100%;height:100%;background:#0d111e;border-left:1px solid #1e293b;
      display:flex;flex-direction:column;font-size:12px;color:#e2e8f0;overflow:hidden">
      <div style="padding:12px 14px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center">
        <strong style="color:#00f3ff">Monaco Settings</strong>
        <button type="button" id="ms-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer">×</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:12px 14px">
        <label style="display:block;color:#888;margin-bottom:4px">Apply to</label>
        <select id="ms-scope" style="width:100%;margin-bottom:12px;background:#05070f;border:1px solid #1e293b;color:#eee;padding:6px">
          <option value="global">All files (global)</option>
          <option value="file">This file only</option>
        </select>
        <label style="display:block;color:#888;margin-bottom:4px">Theme</label>
        <select id="ms-theme" style="width:100%;margin-bottom:12px;background:#05070f;border:1px solid #1e293b;color:#eee;padding:6px"></select>
        <label style="display:block;color:#888;margin-bottom:4px">Font size</label>
        <input id="ms-fontsize" type="number" min="10" max="28" style="width:100%;margin-bottom:12px;background:#05070f;border:1px solid #1e293b;color:#eee;padding:6px" />
        <label style="display:block;color:#888;margin-bottom:4px">Word wrap</label>
        <select id="ms-wordwrap" style="width:100%;margin-bottom:12px;background:#05070f;border:1px solid #1e293b;color:#eee;padding:6px">
          <option value="off">Off</option>
          <option value="on">On</option>
        </select>
        <label style="display:block;color:#888;margin-bottom:4px">Minimap</label>
        <select id="ms-minimap" style="width:100%;margin-bottom:12px;background:#05070f;border:1px solid #1e293b;color:#eee;padding:6px">
          <option value="true">On</option>
          <option value="false">Off</option>
        </select>
        <label style="display:block;color:#888;margin-bottom:4px">Line numbers</label>
        <select id="ms-linenumbers" style="width:100%;margin-bottom:12px;background:#05070f;border:1px solid #1e293b;color:#eee;padding:6px">
          <option value="on">On</option>
          <option value="off">Off</option>
          <option value="relative">Relative</option>
        </select>
        <label style="display:block;color:#888;margin-bottom:4px">Tab size</label>
        <input id="ms-tabsize" type="number" min="1" max="8" style="width:100%;margin-bottom:12px;background:#05070f;border:1px solid #1e293b;color:#eee;padding:6px" />
        <label style="display:block;color:#888;margin-bottom:4px">Preset</label>
        <select id="ms-preset" style="width:100%;margin-bottom:8px;background:#05070f;border:1px solid #1e293b;color:#eee;padding:6px"></select>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <button type="button" class="btn small" id="ms-load-preset">Load preset</button>
          <button type="button" class="btn small" id="ms-save-preset">Save as preset</button>
          <button type="button" class="btn small" id="ms-share-preset">Share WSS</button>
        </div>
      </div>
      <div style="padding:12px;border-top:1px solid #1e293b;display:flex;gap:8px">
        <button type="button" class="btn primary" id="ms-apply" style="flex:1">Apply & Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  panel.addEventListener("click", (e) => {
    if (e.target === panel) closeSettingsDrawer();
  });
  panel.querySelector("#ms-close").onclick = closeSettingsDrawer;
  panel.querySelector("#ms-apply").onclick = () => applyFromForm(true);
  panel.querySelector("#ms-load-preset").onclick = loadPresetFromSelect;
  panel.querySelector("#ms-save-preset").onclick = savePresetFromForm;
  panel.querySelector("#ms-share-preset").onclick = sharePresetWss;

  const themeSel = panel.querySelector("#ms-theme");
  themeSel.innerHTML = Object.entries(THEMES)
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join("");
}

async function fillForm() {
  await loadPresets();
  const path = window.__n3xnActivePath;
  const s = await getSettingsForPath(path);
  panel.querySelector("#ms-scope").value = s._scope === "file" ? "file" : "global";
  panel.querySelector("#ms-theme").value = s.theme || "n3xn-dark";
  panel.querySelector("#ms-fontsize").value = s.fontSize || 13;
  panel.querySelector("#ms-wordwrap").value = s.wordWrap || "off";
  panel.querySelector("#ms-minimap").value = s.minimap ? "true" : "false";
  panel.querySelector("#ms-linenumbers").value = s.lineNumbers || "on";
  panel.querySelector("#ms-tabsize").value = s.tabSize || 2;
  const ps = panel.querySelector("#ms-preset");
  ps.innerHTML = Object.keys(presets)
    .map((k) => `<option value="${k}">${presets[k].name || k}</option>`)
    .join("");
}

function readForm() {
  return {
    theme: panel.querySelector("#ms-theme").value,
    fontSize: +panel.querySelector("#ms-fontsize").value || 13,
    wordWrap: panel.querySelector("#ms-wordwrap").value,
    minimap: panel.querySelector("#ms-minimap").value === "true",
    lineNumbers: panel.querySelector("#ms-linenumbers").value,
    tabSize: +panel.querySelector("#ms-tabsize").value || 2,
  };
}

async function applyFromForm(persist) {
  const s = readForm();
  applySettings(s);
  if (persist) {
    const asGlobal = panel.querySelector("#ms-scope").value !== "file";
    await saveSettings(s, {
      path: window.__n3xnActivePath,
      asGlobal,
    });
  }
}

function loadPresetFromSelect() {
  const name = panel.querySelector("#ms-preset").value;
  const p = presets[name];
  if (!p) return;
  panel.querySelector("#ms-theme").value = p.theme || "n3xn-dark";
  panel.querySelector("#ms-fontsize").value = p.fontSize || 13;
  panel.querySelector("#ms-wordwrap").value = p.wordWrap || "off";
  panel.querySelector("#ms-minimap").value = p.minimap ? "true" : "false";
  panel.querySelector("#ms-linenumbers").value = p.lineNumbers || "on";
  panel.querySelector("#ms-tabsize").value = p.tabSize || 2;
  applySettings(p);
}

async function savePresetFromForm() {
  const name = prompt("Preset name:", "my-preset");
  if (!name) return;
  const s = readForm();
  await savePreset(name, s);
  await fillForm();
  alert("Preset saved: " + name);
}

async function sharePresetWss() {
  const name = panel.querySelector("#ms-preset").value || "shared";
  const s = { ...(presets[name] || readForm()), name };
  try {
    const collab = await import("./collab.js");
    if (!collab.isConnected()) {
      alert("Connect WSS first: wss connect <url> <password>");
      return;
    }
    // reuse chat channel with structured payload via collab internal sendEnc - use chat as fallback
    await collab.chat(`[monaco-preset]${JSON.stringify(s)}`);
    alert("Preset shared to room (as chat payload). Peers can import manually for now.");
  } catch (e) {
    alert("Share failed: " + e.message);
  }
}

/** Apply stored settings when opening a file */
export async function applyForOpenFile(path) {
  const s = await getSettingsForPath(path);
  applySettings(s);
}
