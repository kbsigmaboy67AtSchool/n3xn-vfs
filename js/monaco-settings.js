/**
 * n3xn VFS v2 — Monaco + UI cursor/caret settings
 * Themes, presets, custom mouse cursors, text carets, multi-frame caret animation,
 * experimental transitions (selection/highlight boxes), IndexedDB persistence.
 */

import * as db from "./db.js";

const GLOBAL_KEY = "monaco_settings_global";
const PRESETS_KEY = "monaco_presets";
const FILE_PREFIX = "monaco_file:";
const STYLE_ID = "n3xn-cursor-caret-css";

const THEMES = {
  "n3xn-dark": "n3xn Dark (default)",
  "vs-dark": "VS Dark",
  "hc-black": "High Contrast Black",
  cyberpunk: "Cyberpunk",
  dracula: "Dracula-ish",
  matrix: "Matrix",
  amber: "Amber Terminal",
};

const CURSOR_PRESETS = {
  default: "default",
  crosshair: "crosshair",
  cell: "cell",
  text: "text",
  pointer: "pointer",
  grab: "grab",
  grabbing: "grabbing",
  "not-allowed": "not-allowed",
  help: "help",
  move: "move",
  "zoom-in": "zoom-in",
  neon: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M4 2 L4 18 L9 13 L12 20 L14 19 L11 12 L18 12 Z' fill='%2300f3ff' stroke='%23fff' stroke-width='0.5'/%3E%3C/svg%3E\") 4 2, crosshair",
  matrix: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect x='8' y='2' width='4' height='16' fill='%2300ff66'/%3E%3C/svg%3E\") 10 10, crosshair",
  beam: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='24'%3E%3Crect x='7' y='2' width='2' height='20' fill='%23ff79c6'/%3E%3C/svg%3E\") 8 12, text",
  custom: "custom",
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
  cursorBlinking: "smooth", // Monaco: blink | smooth | phase | expand | solid
  cursorStyle: "line", // line | block | underline | line-thin | block-outline | underline-thin
  cursorWidth: 2,
  renderWhitespace: "selection",
  smoothScrolling: true,
  mouseWheelZoom: true,
  bracketPairColorization: true,

  // Mouse cursor (CSS) — separate targets
  mouseCursorMonaco: "text",
  mouseCursorTerminal: "text",
  mouseCursorUi: "default",
  mouseCursorCustomUrl: "", // when preset is custom

  // Text caret (insertion caret) colors / glow
  caretColorMonaco: "#00f3ff",
  caretColorTerminal: "#00f3ff",
  caretColorInputs: "#c084fc",
  caretGlow: true,
  caretGlowColor: "#00f3ff",
  caretGlowBlur: 8,

  // Multi-frame caret animation (CSS keyframes)
  caretAnimEnabled: false,
  caretAnimDurationMs: 600,
  caretAnimFrames: [
    { color: "#00f3ff", scaleY: 1, opacity: 1 },
    { color: "#c084fc", scaleY: 1.15, opacity: 0.85 },
    { color: "#4ade80", scaleY: 1, opacity: 1 },
    { color: "#00f3ff", scaleY: 0.9, opacity: 0.7 },
  ],

  // Experimental: CSS transitions on Monaco surfaces
  experimentalTransitions: false,
  transitionMs: 180,
  transitionEasing: "cubic-bezier(0.22, 1, 0.36, 1)",
  transitionTargets: "caret,selection,line-highlight", // comma list

  // Pixel look
  pixelatedCursor: false,
  pixelatedCaret: false,
  caretBlockPixelSize: 2,

  // Full UI / selection chrome (free-form CSS values)
  uiSelection: "rgba(0, 243, 255, 0.35)",
  uiSelectionColor: "#ffffff",
  uiBg: "#0a0a0f",
  uiBgPanel: "rgba(13, 17, 30, 0.92)",
  uiBgInput: "#05070f",
  uiBgButton: "linear-gradient(180deg, #1a1a28 0%, #0d0d14 100%)",
  uiBgButtonHover: "linear-gradient(180deg, #2a2a40 0%, #1a1a28 100%)",
  uiBgButtonActive: "linear-gradient(180deg, #0d0d14 0%, #1a1a28 100%)",
  uiColor: "#e2e8f0",
  uiColorMuted: "#94a3b8",
  uiColorAccent: "#00f3ff",
  uiBorderColor: "#1e293b",
  uiBorderColorHover: "#00f3ff88",
  uiBorderColorFocus: "#00f3ff",
  uiBorderWidth: "1px",
  uiBorderStyle: "solid",
  uiBorderRadius: "6px",
  uiBackgroundClip: "border-box",
  uiBoxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.45)",
  uiBoxShadowHover: "0 0 12px rgba(0, 243, 255, 0.25), 0 8px 24px rgba(0,0,0,0.5)",
  uiBoxShadowActive: "0 0 4px rgba(0, 243, 255, 0.4) inset",
  uiTextShadow: "none",
  uiTextShadowHover: "0 0 8px rgba(0, 243, 255, 0.5)",
  uiMonacoSelection: "rgba(0, 243, 255, 0.28)",
  uiMonacoSelectionHighlight: "rgba(192, 132, 252, 0.22)",
  uiMonacoLineHighlight: "rgba(255, 255, 255, 0.04)",
  uiCustomCss: "",
};

let panel = null;
let presets = {};
let lastApplied = { ...DEFAULTS };

function getEditor() {
  return window.__n3xnEditor;
}

export function defineExtraThemes() {
  if (!window.monaco) return;
  const defs = [
    [
      "cyberpunk",
      {
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
      },
    ],
    [
      "dracula",
      {
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
      },
    ],
    [
      "matrix",
      {
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
      },
    ],
    [
      "amber",
      {
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
      },
    ],
  ];
  defs.forEach(([name, theme]) => {
    try {
      monaco.editor.defineTheme(name, theme);
    } catch (_) {}
  });
}

function builtInPresets() {
  return {
    default: { ...DEFAULTS, name: "Default" },
    cyberpunk: {
      ...DEFAULTS,
      name: "Cyberpunk",
      theme: "cyberpunk",
      fontSize: 14,
      mouseCursorMonaco: "neon",
      caretColorMonaco: "#00f3ff",
      caretAnimEnabled: true,
      experimentalTransitions: true,
    },
    matrix: {
      ...DEFAULTS,
      name: "Matrix",
      theme: "matrix",
      minimap: false,
      mouseCursorMonaco: "matrix",
      caretColorMonaco: "#00ff66",
      caretGlowColor: "#00ff66",
    },
    focus: {
      ...DEFAULTS,
      name: "Focus",
      minimap: false,
      lineNumbers: "off",
      fontSize: 15,
      wordWrap: "on",
      mouseCursorMonaco: "beam",
    },
  };
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

function resolveCursor(preset, customUrl) {
  if (preset === "custom" && customUrl) {
    return `url("${customUrl}") 0 0, auto`;
  }
  return CURSOR_PRESETS[preset] || preset || "default";
}

function framesToKeyframes(frames) {
  const list = Array.isArray(frames) && frames.length ? frames : DEFAULTS.caretAnimFrames;
  const n = list.length;
  return list
    .map((f, i) => {
      const pct = Math.round((i / Math.max(n - 1, 1)) * 100);
      const color = f.color || "#00f3ff";
      const op = f.opacity != null ? f.opacity : 1;
      const sy = f.scaleY != null ? f.scaleY : 1;
      return `${pct}% { caret-color: ${color}; background-color: ${color}; opacity: ${op}; transform: scaleY(${sy}); }`;
    })
    .join("\n");
}

/** Inject CSS for cursors, carets, multi-frame anim, experimental transitions */
export function applyCursorCaretCss(settings) {
  const s = { ...DEFAULTS, ...settings };
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }

  const curM = resolveCursor(s.mouseCursorMonaco, s.mouseCursorCustomUrl);
  const curT = resolveCursor(s.mouseCursorTerminal, s.mouseCursorCustomUrl);
  const curU = resolveCursor(s.mouseCursorUi, s.mouseCursorCustomUrl);

  const glowM = s.caretGlow
    ? `box-shadow: 0 0 ${s.caretGlowBlur || 8}px ${s.caretGlowColor || s.caretColorMonaco};`
    : "";
  const glowT = s.caretGlow
    ? `text-shadow: 0 0 ${s.caretGlowBlur || 8}px ${s.caretGlowColor || s.caretColorTerminal};`
    : "";

  const animDur = Math.max(100, Number(s.caretAnimDurationMs) || 600);
  const kf = framesToKeyframes(s.caretAnimFrames);
  const animRule = s.caretAnimEnabled
    ? `animation: n3xn-caret-frames ${animDur}ms ease-in-out infinite;`
    : "";

  const tMs = Math.max(0, Number(s.transitionMs) || 180);
  const ease = s.transitionEasing || "ease";
  const targets = String(s.transitionTargets || "caret,selection,line-highlight")
    .split(",")
    .map((x) => x.trim());

  let exp = "";
  if (s.experimentalTransitions) {
    const props = [];
    if (targets.includes("caret")) props.push("caret-color", "opacity", "transform", "outline-color");
    if (targets.includes("selection")) props.push("background-color");
    if (targets.includes("line-highlight")) props.push("background-color");
    const trans = `transition: ${props.map((p) => `${p} ${tMs}ms ${ease}`).join(", ")};`;
    exp = `
/* experimental transitions — selection + line highlight + caret feel smoother */
.monaco-editor .view-overlays .current-line,
.monaco-editor .view-overlays .current-line-exact,
.monaco-editor .selected-text,
.monaco-editor .cslr.selected-text,
.monaco-editor .monaco-selection {
  ${trans}
}
.monaco-editor .cursor,
.monaco-editor .monaco-mouse-cursor-text {
  ${trans}
}
#monaco-container .monaco-editor {
  transition: filter ${tMs}ms ${ease};
}
`;
  }

  el.textContent = `
/* n3xn cursor / caret (IndexedDB-backed settings) */
#monaco-container,
#monaco-container .monaco-editor,
#monaco-container .monaco-editor .view-lines {
  cursor: ${curM} !important;
}
#terminal-panel,
#terminal-panel *,
#terminal-input {
  cursor: ${curT} !important;
}
button, .btn, .icon-btn, .topbar, .file-tree, select, a {
  cursor: ${curU} !important;
}

/* Text caret colors by surface */
#monaco-container .monaco-editor,
#monaco-container textarea,
#monaco-container .inputarea {
  caret-color: ${s.caretColorMonaco} !important;
}
#terminal-input {
  caret-color: ${s.caretColorTerminal} !important;
  ${glowT}
}
input:not([type="color"]):not([type="range"]):not([type="checkbox"]):not([type="file"]),
textarea {
  caret-color: ${s.caretColorInputs} !important;
}

/* Monaco draws the caret as .cursor (not CSS caret-color on the hidden textarea) */
.monaco-editor .cursor {
  background-color: ${s.caretColorMonaco} !important;
  border-color: ${s.caretColorMonaco} !important;
  ${glowM}
  ${animRule}
  ${s.pixelatedCaret ? "image-rendering: pixelated; image-rendering: crisp-edges;" : ""}
}
.monaco-editor .cursor.secondary {
  background-color: ${s.caretColorMonaco} !important;
}
/* Hidden textarea caret (fallback) */
.monaco-editor .inputarea {
  caret-color: ${s.caretColorMonaco} !important;
}
#monaco-container, #monaco-container * {
  ${s.pixelatedCursor ? "cursor: " + curM + " !important;" : ""}
}
${s.pixelatedCursor ? "body { image-rendering: pixelated; }" : ""}


@keyframes n3xn-caret-frames {
${kf}
}

${exp}
`;
}


const UI_STYLE_ID = "n3xn-ui-chrome-css";

export function applyUiChromeCss(settings) {
  const s = { ...DEFAULTS, ...settings };
  let el = document.getElementById(UI_STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = UI_STYLE_ID;
    document.head.appendChild(el);
  }

  const br = `${s.uiBorderWidth || "1px"} ${s.uiBorderStyle || "solid"} ${s.uiBorderColor || "#1e293b"}`;
  const radius = s.uiBorderRadius || "6px";
  const clip = s.uiBackgroundClip || "border-box";

  el.textContent = `
/* n3xn UI chrome — selection, backgrounds, borders, shadows, hover/active */
::selection {
  background: ${s.uiSelection} !important;
  color: ${s.uiSelectionColor} !important;
}
::-moz-selection {
  background: ${s.uiSelection} !important;
  color: ${s.uiSelectionColor} !important;
}

/* Monaco selection / line highlight */
.monaco-editor .selected-text,
.monaco-editor .cslr.selected-text,
.monaco-editor .monaco-selection {
  background-color: ${s.uiMonacoSelection} !important;
}
.monaco-editor .wordHighlight,
.monaco-editor .wordHighlightStrong,
.monaco-editor .selectionHighlight {
  background-color: ${s.uiMonacoSelectionHighlight} !important;
}
.monaco-editor .view-overlays .current-line,
.monaco-editor .view-overlays .current-line-exact {
  background-color: ${s.uiMonacoLineHighlight} !important;
}

html, body {
  background: ${s.uiBg} !important;
  color: ${s.uiColor} !important;
}

.topbar, .panel, .side-panel, #explorer-panel, #editor-panel, #terminal-panel,
#github-panel, #monaco-settings-drawer > div,
.glass-panel, .modal, .drawer {
  background: ${s.uiBgPanel} !important;
  border: ${br} !important;
  border-radius: ${radius} !important;
  box-shadow: ${s.uiBoxShadow} !important;
  color: ${s.uiColor} !important;
  background-clip: ${clip} !important;
}

input:not([type="color"]):not([type="range"]):not([type="checkbox"]):not([type="file"]),
textarea, select, #terminal-input {
  background: ${s.uiBgInput} !important;
  color: ${s.uiColor} !important;
  border: ${br} !important;
  border-radius: ${radius} !important;
  box-shadow: none !important;
  background-clip: ${clip} !important;
  text-shadow: ${s.uiTextShadow || "none"} !important;
}
input:hover, textarea:hover, select:hover, #terminal-input:hover {
  border-color: ${s.uiBorderColorHover} !important;
  box-shadow: ${s.uiBoxShadowHover} !important;
  text-shadow: ${s.uiTextShadowHover || "none"} !important;
}
input:focus, textarea:focus, select:focus, #terminal-input:focus {
  border-color: ${s.uiBorderColorFocus} !important;
  outline: none !important;
  box-shadow: ${s.uiBoxShadowHover} !important;
}

.btn, button.btn, .icon-btn, button:not(.monaco-editor button) {
  background: ${s.uiBgButton} !important;
  color: ${s.uiColor} !important;
  border: ${br} !important;
  border-radius: ${radius} !important;
  box-shadow: ${s.uiBoxShadow} !important;
  text-shadow: ${s.uiTextShadow || "none"} !important;
  background-clip: ${clip} !important;
  transition: background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, text-shadow 0.15s ease;
}
.btn:hover, button.btn:hover, .icon-btn:hover, button:not(.monaco-editor button):hover {
  background: ${s.uiBgButtonHover} !important;
  border-color: ${s.uiBorderColorHover} !important;
  box-shadow: ${s.uiBoxShadowHover} !important;
  text-shadow: ${s.uiTextShadowHover || "none"} !important;
  color: ${s.uiColorAccent} !important;
}
.btn:active, button.btn:active, .icon-btn:active, button:not(.monaco-editor button):active {
  background: ${s.uiBgButtonActive} !important;
  box-shadow: ${s.uiBoxShadowActive} !important;
  transform: translateY(1px);
}
.btn.primary {
  border-color: ${s.uiColorAccent} !important;
  color: ${s.uiColorAccent} !important;
}

.file-tree .node:hover, .file-tree .file:hover, #file-tree [data-path]:hover {
  background: ${s.uiMonacoLineHighlight} !important;
  border-radius: ${radius} !important;
  box-shadow: ${s.uiBoxShadowHover} !important;
}
.file-tree .node.active, .file-tree .file.active {
  border-color: ${s.uiBorderColorFocus} !important;
  box-shadow: ${s.uiBoxShadowActive} !important;
}

a { color: ${s.uiColorAccent}; }
.muted, .status-bar { color: ${s.uiColorMuted} !important; }

/* User free-form CSS (last — highest priority among our injects) */
${s.uiCustomCss || ""}
`;
}


export function applySettings(settings) {
  const s = { ...DEFAULTS, ...settings };
  lastApplied = s;
  defineExtraThemes();

  const ed = getEditor();
  if (ed && window.monaco) {
    try {
      monaco.editor.setTheme(s.theme || "n3xn-dark");
    } catch {
      try {
        monaco.editor.setTheme("vs-dark");
      } catch (_) {}
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
      cursorStyle: s.cursorStyle || "line",
      cursorWidth: Number(s.cursorWidth) || 2,
      renderWhitespace: s.renderWhitespace || "selection",
      smoothScrolling: !!s.smoothScrolling,
      mouseWheelZoom: !!s.mouseWheelZoom,
      "bracketPairColorization.enabled": s.bracketPairColorization !== false,
    });
  }

  applyCursorCaretCss(s);
  applyUiChromeCss(s);
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

export function getLastApplied() {
  return { ...lastApplied };
}

export function openSettingsDrawer() {
  ensurePanel();
  panel.style.display = "flex";
  fillForm();
}

export function closeSettingsDrawer() {
  if (panel) panel.style.display = "none";
}

function fieldStyle() {
  return "width:100%;margin-bottom:10px;background:#05070f;border:1px solid #1e293b;color:#eee;padding:6px;box-sizing:border-box";
}

function ensurePanel() {
  if (panel && document.body.contains(panel)) return;
  panel = document.createElement("div");
  panel.id = "monaco-settings-drawer";
  panel.style.cssText =
    "display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.55);justify-content:flex-end";
  const fs = fieldStyle();
  const cursorOpts = Object.keys(CURSOR_PRESETS)
    .map((k) => `<option value="${k}">${k}</option>`)
    .join("");

  panel.innerHTML = `
    <div style="width:360px;max-width:100%;height:100%;background:#0d111e;border-left:1px solid #1e293b;
      display:flex;flex-direction:column;font-size:12px;color:#e2e8f0;overflow:hidden">
      <div style="padding:12px 14px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center">
        <strong style="color:#00f3ff">Monaco & Cursor Settings</strong>
        <button type="button" id="ms-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer">×</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:12px 14px">
        <label style="color:#888">Apply to</label>
        <select id="ms-scope" style="${fs}">
          <option value="global">All files (global) → IndexedDB</option>
          <option value="file">This file only → IndexedDB</option>
        </select>

        <div style="color:#00f3ff;font-weight:600;margin:8px 0 6px">Editor</div>
        <label style="color:#888">Theme</label>
        <select id="ms-theme" style="${fs}"></select>
        <label style="color:#888">Font size</label>
        <input id="ms-fontsize" type="number" min="10" max="28" style="${fs}" />
        <label style="color:#888">Word wrap</label>
        <select id="ms-wordwrap" style="${fs}"><option value="off">Off</option><option value="on">On</option></select>
        <label style="color:#888">Minimap</label>
        <select id="ms-minimap" style="${fs}"><option value="true">On</option><option value="false">Off</option></select>
        <label style="color:#888">Line numbers</label>
        <select id="ms-linenumbers" style="${fs}">
          <option value="on">On</option><option value="off">Off</option><option value="relative">Relative</option>
        </select>
        <label style="color:#888">Tab size</label>
        <input id="ms-tabsize" type="number" min="1" max="8" style="${fs}" />

        <div style="color:#00f3ff;font-weight:600;margin:12px 0 6px">Monaco text caret</div>
        <label style="color:#888">Caret blink</label>
        <select id="ms-cursor-blink" style="${fs}">
          <option value="blink">blink</option>
          <option value="smooth">smooth</option>
          <option value="phase">phase</option>
          <option value="expand">expand</option>
          <option value="solid">solid</option>
        </select>
        <label style="color:#888">Caret style</label>
        <select id="ms-cursor-style" style="${fs}">
          <option value="line">line</option>
          <option value="block">block</option>
          <option value="underline">underline</option>
          <option value="line-thin">line-thin</option>
          <option value="block-outline">block-outline</option>
          <option value="underline-thin">underline-thin</option>
        </select>
        <label style="color:#888">Caret width (line)</label>
        <input id="ms-cursor-width" type="number" min="1" max="8" style="${fs}" />
        <label style="color:#888">Caret color (Monaco)</label>
        <input id="ms-caret-monaco" type="color" style="${fs}" />
        <label style="color:#888">Caret color (Terminal)</label>
        <input id="ms-caret-term" type="color" style="${fs}" />
        <label style="color:#888">Caret color (UI inputs)</label>
        <input id="ms-caret-inputs" type="color" style="${fs}" />
        <label style="color:#888"><input type="checkbox" id="ms-caret-glow" /> Caret glow</label>
        <label style="color:#888">Glow color</label>
        <input id="ms-caret-glow-color" type="color" style="${fs}" />
        <label style="color:#888">Glow blur (px)</label>
        <input id="ms-caret-glow-blur" type="number" min="0" max="32" style="${fs}" />
        <label style="color:#888"><input type="checkbox" id="ms-pixel-caret" /> Pixelated caret (crisp block edges)</label>
        <label style="color:#888"><input type="checkbox" id="ms-pixel-cursor" /> Pixelated mouse cursor rendering</label>

        <div style="color:#00f3ff;font-weight:600;margin:12px 0 6px">Multi-frame caret animation</div>
        <label style="color:#888"><input type="checkbox" id="ms-caret-anim" /> Enable frame animation</label>
        <label style="color:#888">Duration (ms)</label>
        <input id="ms-caret-anim-ms" type="number" min="100" max="5000" style="${fs}" />
        <label style="color:#888">Frames JSON (color, scaleY, opacity)</label>
        <textarea id="ms-caret-frames" rows="5" style="${fs};font-family:monospace;font-size:11px"></textarea>

        <div style="color:#00f3ff;font-weight:600;margin:12px 0 6px">Mouse cursor (CSS)</div>
        <p style="color:#666;margin:0 0 8px;font-size:11px">Monaco, terminal, and UI buttons use separate cursors.</p>
        <label style="color:#888">Monaco editor</label>
        <select id="ms-mouse-monaco" style="${fs}">${cursorOpts}</select>
        <label style="color:#888">Terminal</label>
        <select id="ms-mouse-term" style="${fs}">${cursorOpts}</select>
        <label style="color:#888">UI / buttons</label>
        <select id="ms-mouse-ui" style="${fs}">${cursorOpts}</select>
        <label style="color:#888">Custom cursor URL (when preset = custom)</label>
        <input id="ms-mouse-custom" type="text" placeholder="https://…/cursor.png or data:…" style="${fs}" />

        <div style="color:#fbbf24;font-weight:600;margin:12px 0 6px">Experimental</div>
        <label style="color:#888"><input type="checkbox" id="ms-exp-trans" /> CSS transitions on caret / selection / line highlight</label>
        <label style="color:#888">Transition ms</label>
        <input id="ms-trans-ms" type="number" min="0" max="2000" style="${fs}" />
        <label style="color:#888">Easing</label>
        <input id="ms-trans-ease" type="text" style="${fs}" />
        <label style="color:#888">Targets (caret,selection,line-highlight)</label>
        <input id="ms-trans-targets" type="text" style="${fs}" />


        <div style="color:#c084fc;font-weight:600;margin:12px 0 6px">Selection &amp; Monaco highlights</div>
        <label style="color:#888">Page ::selection background</label>
        <input id="ms-ui-sel" type="text" placeholder="rgba(...) or #hex" style="${fs}" />
        <label style="color:#888">::selection text color</label>
        <input id="ms-ui-sel-color" type="text" style="${fs}" />
        <label style="color:#888">Monaco selection</label>
        <input id="ms-ui-monaco-sel" type="text" style="${fs}" />
        <label style="color:#888">Monaco selection highlight</label>
        <input id="ms-ui-monaco-hl" type="text" style="${fs}" />
        <label style="color:#888">Monaco line highlight</label>
        <input id="ms-ui-monaco-line" type="text" style="${fs}" />

        <div style="color:#c084fc;font-weight:600;margin:12px 0 6px">Backgrounds (any CSS: color, gradient, image…)</div>
        <label style="color:#888">Page / body</label>
        <input id="ms-ui-bg" type="text" style="${fs}" />
        <label style="color:#888">Panels</label>
        <input id="ms-ui-bg-panel" type="text" style="${fs}" />
        <label style="color:#888">Inputs</label>
        <input id="ms-ui-bg-input" type="text" style="${fs}" />
        <label style="color:#888">Buttons</label>
        <input id="ms-ui-bg-btn" type="text" style="${fs}" />
        <label style="color:#888">Buttons :hover</label>
        <input id="ms-ui-bg-btn-hover" type="text" style="${fs}" />
        <label style="color:#888">Buttons :active / click</label>
        <input id="ms-ui-bg-btn-active" type="text" style="${fs}" />
        <label style="color:#888">background-clip</label>
        <select id="ms-ui-clip" style="${fs}">
          <option value="border-box">border-box</option>
          <option value="padding-box">padding-box</option>
          <option value="content-box">content-box</option>
          <option value="text">text</option>
        </select>

        <div style="color:#c084fc;font-weight:600;margin:12px 0 6px">Color / border</div>
        <label style="color:#888">Text color</label>
        <input id="ms-ui-color" type="text" style="${fs}" />
        <label style="color:#888">Muted color</label>
        <input id="ms-ui-color-muted" type="text" style="${fs}" />
        <label style="color:#888">Accent color</label>
        <input id="ms-ui-color-accent" type="text" style="${fs}" />
        <label style="color:#888">Border color</label>
        <input id="ms-ui-border" type="text" style="${fs}" />
        <label style="color:#888">Border :hover</label>
        <input id="ms-ui-border-hover" type="text" style="${fs}" />
        <label style="color:#888">Border :focus</label>
        <input id="ms-ui-border-focus" type="text" style="${fs}" />
        <label style="color:#888">Border width</label>
        <input id="ms-ui-border-w" type="text" style="${fs}" />
        <label style="color:#888">Border style</label>
        <input id="ms-ui-border-style" type="text" placeholder="solid dashed etc" style="${fs}" />
        <label style="color:#888">Border radius</label>
        <input id="ms-ui-radius" type="text" style="${fs}" />

        <div style="color:#c084fc;font-weight:600;margin:12px 0 6px">Shadows / glows (multi-layer CSS ok)</div>
        <label style="color:#888">box-shadow</label>
        <input id="ms-ui-shadow" type="text" style="${fs}" />
        <label style="color:#888">box-shadow :hover</label>
        <input id="ms-ui-shadow-hover" type="text" style="${fs}" />
        <label style="color:#888">box-shadow :active</label>
        <input id="ms-ui-shadow-active" type="text" style="${fs}" />
        <label style="color:#888">text-shadow</label>
        <input id="ms-ui-tshadow" type="text" style="${fs}" />
        <label style="color:#888">text-shadow :hover</label>
        <input id="ms-ui-tshadow-hover" type="text" style="${fs}" />

        <div style="color:#c084fc;font-weight:600;margin:12px 0 6px">Custom CSS (anything)</div>
        <textarea id="ms-ui-custom" rows="6" placeholder=".btn.primary { ... }" style="${fs};font-family:monospace;font-size:11px"></textarea>

        <div style="color:#00f3ff;font-weight:600;margin:12px 0 6px">Presets</div>
        <select id="ms-preset" style="${fs}"></select>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <button type="button" class="btn small" id="ms-load-preset">Load</button>
          <button type="button" class="btn small" id="ms-save-preset">Save as…</button>
          <button type="button" class="btn small" id="ms-share-preset">Share WSS</button>
        </div>
      </div>
      <div style="padding:12px;border-top:1px solid #1e293b;display:flex;gap:8px">
        <button type="button" class="btn primary" id="ms-apply" style="flex:1">Apply &amp; Save (IndexedDB)</button>
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

function setVal(id, v) {
  const el = panel.querySelector("#" + id);
  if (!el) return;
  if (el.type === "checkbox") el.checked = !!v;
  else el.value = v;
}

function getVal(id) {
  const el = panel.querySelector("#" + id);
  if (!el) return null;
  if (el.type === "checkbox") return el.checked;
  return el.value;
}

async function fillForm() {
  await loadPresets();
  const path = window.__n3xnActivePath;
  const s = await getSettingsForPath(path);
  setVal("ms-scope", s._scope === "file" ? "file" : "global");
  setVal("ms-theme", s.theme || "n3xn-dark");
  setVal("ms-fontsize", s.fontSize || 13);
  setVal("ms-wordwrap", s.wordWrap || "off");
  setVal("ms-minimap", s.minimap ? "true" : "false");
  setVal("ms-linenumbers", s.lineNumbers || "on");
  setVal("ms-tabsize", s.tabSize || 2);
  setVal("ms-cursor-blink", s.cursorBlinking || "smooth");
  setVal("ms-cursor-style", s.cursorStyle || "line");
  setVal("ms-cursor-width", s.cursorWidth || 2);
  setVal("ms-caret-monaco", s.caretColorMonaco || "#00f3ff");
  setVal("ms-caret-term", s.caretColorTerminal || "#00f3ff");
  setVal("ms-caret-inputs", s.caretColorInputs || "#c084fc");
  setVal("ms-caret-glow", s.caretGlow);
  setVal("ms-caret-glow-color", s.caretGlowColor || "#00f3ff");
  setVal("ms-caret-glow-blur", s.caretGlowBlur ?? 8);
  setVal("ms-pixel-caret", s.pixelatedCaret);
  setVal("ms-pixel-cursor", s.pixelatedCursor);

  setVal("ms-ui-sel", s.uiSelection);
  setVal("ms-ui-sel-color", s.uiSelectionColor);
  setVal("ms-ui-monaco-sel", s.uiMonacoSelection);
  setVal("ms-ui-monaco-hl", s.uiMonacoSelectionHighlight);
  setVal("ms-ui-monaco-line", s.uiMonacoLineHighlight);
  setVal("ms-ui-bg", s.uiBg);
  setVal("ms-ui-bg-panel", s.uiBgPanel);
  setVal("ms-ui-bg-input", s.uiBgInput);
  setVal("ms-ui-bg-btn", s.uiBgButton);
  setVal("ms-ui-bg-btn-hover", s.uiBgButtonHover);
  setVal("ms-ui-bg-btn-active", s.uiBgButtonActive);
  setVal("ms-ui-clip", s.uiBackgroundClip || "border-box");
  setVal("ms-ui-color", s.uiColor);
  setVal("ms-ui-color-muted", s.uiColorMuted);
  setVal("ms-ui-color-accent", s.uiColorAccent);
  setVal("ms-ui-border", s.uiBorderColor);
  setVal("ms-ui-border-hover", s.uiBorderColorHover);
  setVal("ms-ui-border-focus", s.uiBorderColorFocus);
  setVal("ms-ui-border-w", s.uiBorderWidth);
  setVal("ms-ui-border-style", s.uiBorderStyle);
  setVal("ms-ui-radius", s.uiBorderRadius);
  setVal("ms-ui-shadow", s.uiBoxShadow);
  setVal("ms-ui-shadow-hover", s.uiBoxShadowHover);
  setVal("ms-ui-shadow-active", s.uiBoxShadowActive);
  setVal("ms-ui-tshadow", s.uiTextShadow);
  setVal("ms-ui-tshadow-hover", s.uiTextShadowHover);
  setVal("ms-ui-custom", s.uiCustomCss || "");

  setVal("ms-caret-anim", s.caretAnimEnabled);
  setVal("ms-caret-anim-ms", s.caretAnimDurationMs || 600);
  setVal("ms-caret-frames", JSON.stringify(s.caretAnimFrames || DEFAULTS.caretAnimFrames, null, 2));
  setVal("ms-mouse-monaco", s.mouseCursorMonaco || "text");
  setVal("ms-mouse-term", s.mouseCursorTerminal || "text");
  setVal("ms-mouse-ui", s.mouseCursorUi || "default");
  setVal("ms-mouse-custom", s.mouseCursorCustomUrl || "");
  setVal("ms-exp-trans", s.experimentalTransitions);
  setVal("ms-trans-ms", s.transitionMs ?? 180);
  setVal("ms-trans-ease", s.transitionEasing || DEFAULTS.transitionEasing);
  setVal("ms-trans-targets", s.transitionTargets || DEFAULTS.transitionTargets);
  const ps = panel.querySelector("#ms-preset");
  ps.innerHTML = Object.keys(presets)
    .map((k) => `<option value="${k}">${presets[k].name || k}</option>`)
    .join("");
}

function readForm() {
  let frames = DEFAULTS.caretAnimFrames;
  try {
    frames = JSON.parse(getVal("ms-caret-frames") || "[]");
    if (!Array.isArray(frames)) frames = DEFAULTS.caretAnimFrames;
  } catch {
    frames = DEFAULTS.caretAnimFrames;
  }
  return {
    theme: getVal("ms-theme"),
    fontSize: +getVal("ms-fontsize") || 13,
    wordWrap: getVal("ms-wordwrap"),
    minimap: getVal("ms-minimap") === "true",
    lineNumbers: getVal("ms-linenumbers"),
    tabSize: +getVal("ms-tabsize") || 2,
    cursorBlinking: getVal("ms-cursor-blink"),
    cursorStyle: getVal("ms-cursor-style"),
    cursorWidth: +getVal("ms-cursor-width") || 2,
    caretColorMonaco: getVal("ms-caret-monaco"),
    caretColorTerminal: getVal("ms-caret-term"),
    caretColorInputs: getVal("ms-caret-inputs"),
    caretGlow: !!getVal("ms-caret-glow"),
    caretGlowColor: getVal("ms-caret-glow-color"),
    caretGlowBlur: +getVal("ms-caret-glow-blur") || 0,
    pixelatedCaret: !!getVal("ms-pixel-caret"),
    pixelatedCursor: !!getVal("ms-pixel-cursor"),

    uiSelection: getVal("ms-ui-sel"),
    uiSelectionColor: getVal("ms-ui-sel-color"),
    uiMonacoSelection: getVal("ms-ui-monaco-sel"),
    uiMonacoSelectionHighlight: getVal("ms-ui-monaco-hl"),
    uiMonacoLineHighlight: getVal("ms-ui-monaco-line"),
    uiBg: getVal("ms-ui-bg"),
    uiBgPanel: getVal("ms-ui-bg-panel"),
    uiBgInput: getVal("ms-ui-bg-input"),
    uiBgButton: getVal("ms-ui-bg-btn"),
    uiBgButtonHover: getVal("ms-ui-bg-btn-hover"),
    uiBgButtonActive: getVal("ms-ui-bg-btn-active"),
    uiBackgroundClip: getVal("ms-ui-clip"),
    uiColor: getVal("ms-ui-color"),
    uiColorMuted: getVal("ms-ui-color-muted"),
    uiColorAccent: getVal("ms-ui-color-accent"),
    uiBorderColor: getVal("ms-ui-border"),
    uiBorderColorHover: getVal("ms-ui-border-hover"),
    uiBorderColorFocus: getVal("ms-ui-border-focus"),
    uiBorderWidth: getVal("ms-ui-border-w"),
    uiBorderStyle: getVal("ms-ui-border-style"),
    uiBorderRadius: getVal("ms-ui-radius"),
    uiBoxShadow: getVal("ms-ui-shadow"),
    uiBoxShadowHover: getVal("ms-ui-shadow-hover"),
    uiBoxShadowActive: getVal("ms-ui-shadow-active"),
    uiTextShadow: getVal("ms-ui-tshadow"),
    uiTextShadowHover: getVal("ms-ui-tshadow-hover"),
    uiCustomCss: getVal("ms-ui-custom") || "",

    caretAnimEnabled: !!getVal("ms-caret-anim"),
    caretAnimDurationMs: +getVal("ms-caret-anim-ms") || 600,
    caretAnimFrames: frames,
    mouseCursorMonaco: getVal("ms-mouse-monaco"),
    mouseCursorTerminal: getVal("ms-mouse-term"),
    mouseCursorUi: getVal("ms-mouse-ui"),
    mouseCursorCustomUrl: getVal("ms-mouse-custom") || "",
    experimentalTransitions: !!getVal("ms-exp-trans"),
    transitionMs: +getVal("ms-trans-ms") || 0,
    transitionEasing: getVal("ms-trans-ease"),
    transitionTargets: getVal("ms-trans-targets"),
  };
}

async function applyFromForm(persist) {
  const s = readForm();
  applySettings(s);
  if (persist) {
    const asGlobal = getVal("ms-scope") !== "file";
    try {
      await saveSettings(s, { path: window.__n3xnActivePath, asGlobal });
    } catch (e) {
      alert("Save to IndexedDB failed (sign in?): " + e.message);
    }
  }
}

function loadPresetFromSelect() {
  const name = getVal("ms-preset");
  const p = presets[name];
  if (!p) return;
  // write into form via temporary merge
  const merged = { ...DEFAULTS, ...p };
  // quick apply + fill
  applySettings(merged);
  fillFormFromObj(merged);
}

function fillFormFromObj(s) {
  setVal("ms-theme", s.theme);
  setVal("ms-fontsize", s.fontSize);
  setVal("ms-wordwrap", s.wordWrap);
  setVal("ms-minimap", s.minimap ? "true" : "false");
  setVal("ms-linenumbers", s.lineNumbers);
  setVal("ms-tabsize", s.tabSize);
  setVal("ms-cursor-blink", s.cursorBlinking);
  setVal("ms-cursor-style", s.cursorStyle);
  setVal("ms-cursor-width", s.cursorWidth);
  setVal("ms-caret-monaco", s.caretColorMonaco);
  setVal("ms-caret-term", s.caretColorTerminal);
  setVal("ms-caret-inputs", s.caretColorInputs);
  setVal("ms-caret-glow", s.caretGlow);
  setVal("ms-caret-glow-color", s.caretGlowColor);
  setVal("ms-caret-glow-blur", s.caretGlowBlur);
  setVal("ms-pixel-caret", s.pixelatedCaret);
  setVal("ms-pixel-cursor", s.pixelatedCursor);
  setVal("ms-caret-anim", s.caretAnimEnabled);
  setVal("ms-caret-anim-ms", s.caretAnimDurationMs);
  setVal("ms-caret-frames", JSON.stringify(s.caretAnimFrames || [], null, 2));
  setVal("ms-mouse-monaco", s.mouseCursorMonaco);
  setVal("ms-mouse-term", s.mouseCursorTerminal);
  setVal("ms-mouse-ui", s.mouseCursorUi);
  setVal("ms-mouse-custom", s.mouseCursorCustomUrl || "");
  setVal("ms-exp-trans", s.experimentalTransitions);
  setVal("ms-trans-ms", s.transitionMs);
  setVal("ms-trans-ease", s.transitionEasing);
  setVal("ms-trans-targets", s.transitionTargets);
}

async function savePresetFromForm() {
  const name = prompt("Preset name:", "my-preset");
  if (!name) return;
  await savePreset(name, readForm());
  await fillForm();
  alert("Preset saved: " + name);
}

async function sharePresetWss() {
  const name = getVal("ms-preset") || "shared";
  const s = { ...(presets[name] || readForm()), name };
  try {
    const collab = await import("./collab.js");
    if (!collab.isConnected()) {
      alert("Connect WSS first: wss connect <url> <password>");
      return;
    }
    await collab.chat("[monaco-preset]" + JSON.stringify(s));
    alert("Preset shared to room.");
  } catch (e) {
    alert("Share failed: " + e.message);
  }
}

export async function applyForOpenFile(path) {
  const s = await getSettingsForPath(path);
  applySettings(s);
}


/** Used by DevTools Sources Monaco to match host theme/settings */
export function applyMonacoSettingsToEditor(editor) {
  try {
    if (!editor || !window.monaco) return;
    const s = (typeof loadSettings === "function" && loadSettings()) || window.__n3xnMonacoSettings || {};
    if (s.theme) window.monaco.editor.setTheme(s.theme);
    if (s.options) editor.updateOptions(s.options);
  } catch (_) {}
}
if (typeof window !== "undefined") {
  window.__n3xnApplyMonacoSettings = applyMonacoSettingsToEditor;
}
