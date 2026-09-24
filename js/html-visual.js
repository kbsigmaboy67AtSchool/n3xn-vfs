/**
 * n3xn VFS v3 — Advanced Visual HTML & Web Builder
 * Full visual layout designer with drag-and-drop structural controls,
 * style inspector, viewport responsive toggles, gamehub/card presets, and VFS sync.
 */

import * as fs from "./fs.js";

let panel = null;
let currentPath = null;
let docRoot = null;
let selectedEl = null;
let activeTab = "elements"; // 'elements' | 'styles' | 'tree'

/* ==========================================================================
   PUBLIC API
   ========================================================================== */

export function openHtmlVisual(filePath) {
  try {
    currentPath = filePath || "/index.html";
    ensurePanel();
    showPanelEl(panel);
    load(currentPath).catch((e) => {
      console.error(e);
      alert("HTML Visual Studio load error: " + e.message);
    });
  } catch (e) {
    console.error(e);
    alert("HTML Visual Studio error: " + e.message);
  }
}

export function closeHtmlVisual() {
  hidePanelEl(panel);
}

/* ==========================================================================
   DOM UTILITIES & PANEL VISIBILITY
   ========================================================================== */

function showPanelEl(el) {
  if (!el) return;
  el.className = "html-visual";
  el.removeAttribute("hidden");
  Object.assign(el.style, {
    display: "flex",
    position: "fixed",
    left: "16px",
    right: "16px",
    top: "16px",
    bottom: "16px",
    zIndex: "99999",
    visibility: "visible",
    opacity: "1",
    pointerEvents: "auto",
    flexDirection: "column",
    background: "#0a0a0f",
    overflow: "hidden",
    border: "1px solid #2d3748",
    borderRadius: "8px",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.75)"
  });
}

function hidePanelEl(el) {
  if (!el) return;
  el.className = "html-visual hidden";
  el.style.display = "none";
  el.style.visibility = "hidden";
  el.style.pointerEvents = "none";
}

/* ==========================================================================
   INITIALIZATION & INTERFACE LAYOUT
   ========================================================================== */

function ensurePanel() {
  if (panel && document.body.contains(panel)) return;

  panel = document.createElement("div");
  panel.id = "html-visual";
  panel.className = "html-visual";
  panel.innerHTML = `
    <!-- Studio Header -->
    <div class="hv-header">
      <div class="hv-brand">
        <span class="hv-logo">⚡ n3xn</span>
        <span class="hv-title">Visual Web Builder</span>
      </div>

      <!-- Device Viewport Switcher -->
      <div class="hv-viewports">
        <button type="button" class="hv-vp-btn active" data-width="100%" title="Desktop View">🖥️ Desktop</button>
        <button type="button" class="hv-vp-btn" data-width="768px" title="Tablet View">📱 Tablet</button>
        <button type="button" class="hv-vp-btn" data-width="375px" title="Mobile View">📲 Mobile</button>
      </div>

      <!-- Quick Actions -->
      <div class="hv-actions">
        <button type="button" class="btn small" id="hv-undo" title="Undo (Ctrl+Z)">↶</button>
        <button type="button" class="btn small" id="hv-redo" title="Redo (Ctrl+Y)">↷</button>
        <button type="button" class="btn small" id="hv-fs" title="Toggle Fullscreen">⛶</button>
        <button type="button" class="btn small primary" id="hv-apply">💾 Save to File</button>
        <button type="button" class="btn small ghost" id="hv-close">✕</button>
      </div>
    </div>

    <!-- Main Builder Workspace -->
    <div class="hv-body">
      <!-- Left Sidebar: Insert Palette & Tools -->
      <div class="hv-sidebar">
        <div class="hv-tabs">
          <button type="button" class="hv-tab active" data-tab="elements">➕ Add</button>
          <button type="button" class="hv-tab" data-tab="styles">🎨 Style</button>
          <button type="button" class="hv-tab" data-tab="tree">🌴 DOM Tree</button>
        </div>

        <!-- Add Elements Tab -->
        <div class="hv-tab-content active" id="tab-elements">
          <div class="hv-group-title">Layout & Containers</div>
          <div class="hv-grid-tools">
            <button type="button" class="tool-btn" data-preset="section">📦 Section</button>
            <button type="button" class="tool-btn" data-preset="container">🔲 Container</button>
            <button type="button" class="tool-btn" data-preset="grid-2">⚖️ 2-Col Grid</button>
            <button type="button" class="tool-btn" data-preset="grid-3">📊 3-Col Grid</button>
            <button type="button" class="tool-btn" data-preset="flex-row">↔️ Flex Row</button>
          </div>

          <div class="hv-group-title">GameHub & Cards Presets</div>
          <div class="hv-grid-tools">
            <button type="button" class="tool-btn" data-preset="game-card">🎮 Game Card</button>
            <button type="button" class="tool-btn" data-preset="hero-banner">🚀 Hero Section</button>
            <button type="button" class="tool-btn" data-preset="nav-bar">🧭 Navigation Bar</button>
            <button type="button" class="tool-btn" data-preset="game-frame">🕹️ Game iFrame</button>
          </div>

          <div class="hv-group-title">Typography & UI Elements</div>
          <div class="hv-grid-tools">
            <button type="button" class="tool-btn" data-tag="h1">Heading 1</button>
            <button type="button" class="tool-btn" data-tag="h2">Heading 2</button>
            <button type="button" class="tool-btn" data-tag="p">Paragraph</button>
            <button type="button" class="tool-btn" data-tag="button">Button</button>
            <button type="button" class="tool-btn" data-tag="a">Hyperlink</button>
            <button type="button" class="tool-btn" data-tag="img">Image</button>
            <button type="button" class="tool-btn" data-tag="canvas">Canvas</button>
            <button type="button" class="tool-btn" data-tag="ul">Bulleted List</button>
          </div>
        </div>

        <!-- Visual Style Inspector Tab -->
        <div class="hv-tab-content" id="tab-styles">
          <div id="style-inspector-wrap">
            <p class="hv-empty-msg">Select an element in preview to inspect and edit visual styles.</p>
          </div>
        </div>

        <!-- DOM Tree Hierarchy Tab -->
        <div class="hv-tab-content" id="tab-tree">
          <div class="hv-tree" id="hv-tree"></div>
        </div>
      </div>

      <!-- Center Live Stage Canvas Viewport -->
      <div class="hv-stage" id="hv-stage">
        <div class="hv-frame-wrapper" id="hv-frame-wrapper" style="width: 100%;">
          <iframe class="hv-preview" id="hv-preview" allowfullscreen></iframe>
        </div>
      </div>
    </div>

    <!-- Context Toolbar Footer -->
    <div class="hv-footer">
      <div class="hv-breadcrumbs" id="hv-breadcrumbs"><span>Selected: None</span></div>
      <div class="hv-node-actions">
        <button type="button" class="btn small" id="hv-move-up" title="Move Up">↑ Up</button>
        <button type="button" class="btn small" id="hv-move-down" title="Move Down">↓ Down</button>
        <button type="button" class="btn small" id="hv-duplicate" title="Duplicate Node">📋 Duplicate</button>
        <button type="button" class="btn small danger" id="hv-delete" title="Delete Node">🗑️ Delete</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  injectStudioStyles();
  bindGlobalEvents();
}

/* ==========================================================================
   EVENT BINDINGS & CONTROLS
   ========================================================================== */

function bindGlobalEvents() {
  panel.querySelector("#hv-close").onclick = closeHtmlVisual;
  panel.querySelector("#hv-fs").onclick = () => {
    if (!document.fullscreenElement) panel.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  panel.querySelector("#hv-apply").onclick = applyToFile;
  panel.querySelector("#hv-delete").onclick = deleteSelected;
  panel.querySelector("#hv-duplicate").onclick = duplicateSelected;
  panel.querySelector("#hv-move-up").onclick = () => moveSelected(-1);
  panel.querySelector("#hv-move-down").onclick = () => moveSelected(1);

  // Tab switching
  panel.querySelectorAll(".hv-tab").forEach((btn) => {
    btn.onclick = () => {
      panel.querySelectorAll(".hv-tab").forEach((t) => t.classList.remove("active"));
      panel.querySelectorAll(".hv-tab-content").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      const tabId = `tab-${btn.dataset.tab}`;
      panel.querySelector(`#${tabId}`)?.classList.add("active");
      activeTab = btn.dataset.tab;
    };
  });

  // Responsive Viewport Switches
  panel.querySelectorAll(".hv-vp-btn").forEach((btn) => {
    btn.onclick = () => {
      panel.querySelectorAll(".hv-vp-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const wrapper = panel.querySelector("#hv-frame-wrapper");
      if (wrapper) wrapper.style.width = btn.dataset.width;
    };
  });

  // Element Insertion Listeners
  panel.querySelectorAll("[data-tag]").forEach((btn) => {
    btn.onclick = () => insertTag(btn.dataset.tag);
  });

  panel.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.onclick = () => insertPreset(btn.dataset.preset);
  });

  // Global Keyboard Shortcuts inside editor
  window.addEventListener("keydown", handleKeyShortcuts);
}

function handleKeyShortcuts(e) {
  if (!panel || panel.style.display === "none") return;
  if (e.key === "Delete" && selectedEl && docRoot && document.activeElement.tagName !== "INPUT") {
    deleteSelected();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    applyToFile();
  }
}

/* ==========================================================================
   FILE LOADING & IFRAME PREVIEW SYNC
   ========================================================================== */

async function load(filePath) {
  currentPath = filePath;
  let html = "";
  try {
    const f = await fs.readFile(filePath);
    html = f ? f.text() : "";
  } catch {
    html = getFallbackTemplate();
  }

  if (!html.trim()) {
    html = getFallbackTemplate();
  }

  const iframe = panel.querySelector("#hv-preview");
  if (!iframe) throw new Error("Preview frame element missing");

  // Inject helper css into iframe preview for selection border & layout editing
  const helperCss = `
    <style id="__n3xn_editor_styles">
      .__n3xn_sel {
        outline: 2px dashed #00f3ff !important;
        outline-offset: 2px !important;
      }
      [contenteditable="true"] {
        outline: 2px solid #ff0055 !important;
      }
    </style>
  `;

  let processedHtml = html;
  if (processedHtml.includes("</head>")) {
    processedHtml = processedHtml.replace("</head>", `${helperCss}</head>`);
  } else {
    processedHtml = helperCss + processedHtml;
  }

  const blob = new Blob([processedHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  iframe.onload = () => {
    try {
      docRoot = iframe.contentDocument;
      wirePreviewEvents();
      renderTree();
    } catch (e) {
      console.warn("Iframe binding warning:", e);
    }
  };
  iframe.src = url;
}

function getFallbackTemplate() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GameHub Portal</title>
  <style>
    body { background-color: #0d0f17; color: #f7fafc; font-family: system-ui, sans-serif; margin: 0; padding: 20px; }
    h1 { color: #00f3ff; text-align: center; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-top: 30px; }
    .card { background: #1a202c; border: 1px solid #2d3748; border-radius: 8px; padding: 16px; text-align: center; }
    .card img { max-width: 100%; border-radius: 6px; }
    .btn { display: inline-block; background: #00f3ff; color: #000; font-weight: bold; padding: 8px 16px; border-radius: 4px; text-decoration: none; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>🎮 GameHub Portal</h1>
  <p style="text-align:center; color:#a0aec0;">Welcome to your custom Web Gaming Portal!</p>
  <div class="grid">
    <div class="card">
      <h2>Arcade Runner</h2>
      <p>High speed retro action!</p>
      <a href="#" class="btn">Play Now</a>
    </div>
  </div>
</body>
</html>`;
}

/* ==========================================================================
   PREVIEW INTERACTION ENGINE & SELECTION
   ========================================================================== */

function wirePreviewEvents() {
  if (!docRoot) return;

  // Single click selection
  docRoot.body.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectElement(e.target);
  }, true);

  // Double click for direct content editing
  docRoot.body.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    if (target && target !== docRoot.body) {
      target.contentEditable = "true";
      target.focus();
      target.onblur = () => {
        target.removeAttribute("contenteditable");
        renderTree();
      };
    }
  }, true);
}

function selectElement(el) {
  if (!docRoot) return;

  // Un-highlight old element
  docRoot.querySelectorAll(".__n3xn_sel").forEach((n) => {
    n.classList.remove("__n3xn_sel");
  });

  if (el && el !== docRoot.body && el !== docRoot.documentElement) {
    selectedEl = el;
    selectedEl.classList.add("__n3xn_sel");
    updateBreadcrumbs();
    renderInspector();
    renderTree();
  } else {
    selectedEl = null;
    updateBreadcrumbs();
    renderInspector();
    renderTree();
  }
}

function updateBreadcrumbs() {
  const container = panel.querySelector("#hv-breadcrumbs");
  if (!container) return;

  if (!selectedEl) {
    container.innerHTML = "<span>Selected: None</span>";
    return;
  }

  const stack = [];
  let curr = selectedEl;
  while (curr && curr !== docRoot.body) {
    stack.unshift(curr);
    curr = curr.parentElement;
  }

  container.innerHTML = stack
    .map((node) => `<span class="crumb">${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}</span>`)
    .join(" &gt; ");
}

/* ==========================================================================
   VISUAL STYLE INSPECTOR
   ========================================================================== */

function renderInspector() {
  const wrap = panel.querySelector("#style-inspector-wrap");
  if (!wrap) return;

  if (!selectedEl) {
    wrap.innerHTML = `<p class="hv-empty-msg">Select an element in preview to inspect and edit visual styles.</p>`;
    return;
  }

  const compStyle = docRoot.defaultView.getComputedStyle(selectedEl);

  wrap.innerHTML = `
    <div class="insp-section">
      <h4>Attributes</h4>
      <div class="insp-field">
        <label>ID</label>
        <input type="text" id="inp-id" value="${selectedEl.id || ""}">
      </div>
      <div class="insp-field">
        <label>CSS Classes</label>
        <input type="text" id="inp-class" value="${selectedEl.className.replace("__n3xn_sel", "").trim()}">
      </div>
      <div class="insp-field">
        <label>Text Content</label>
        <textarea id="inp-text" rows="2">${selectedEl.innerText || ""}</textarea>
      </div>
    </div>

    <div class="insp-section">
      <h4>Layout & Geometry</h4>
      <div class="insp-field">
        <label>Display</label>
        <select id="inp-display">
          <option value="block" ${compStyle.display === "block" ? "selected" : ""}>block</option>
          <option value="flex" ${compStyle.display === "flex" ? "selected" : ""}>flex</option>
          <option value="grid" ${compStyle.display === "grid" ? "selected" : ""}>grid</option>
          <option value="inline-block" ${compStyle.display === "inline-block" ? "selected" : ""}>inline-block</option>
          <option value="none" ${compStyle.display === "none" ? "selected" : ""}>none</option>
        </select>
      </div>
      <div class="insp-field-row">
        <div>
          <label>Padding</label>
          <input type="text" id="inp-padding" value="${selectedEl.style.padding || ""}" placeholder="e.g. 12px">
        </div>
        <div>
          <label>Margin</label>
          <input type="text" id="inp-margin" value="${selectedEl.style.margin || ""}" placeholder="e.g. 10px">
        </div>
      </div>
    </div>

    <div class="insp-section">
      <h4>Colors & Typography</h4>
      <div class="insp-field-row">
        <div>
          <label>Text Color</label>
          <input type="color" id="inp-color" value="${rgbToHex(compStyle.color)}">
        </div>
        <div>
          <label>Background</label>
          <input type="color" id="inp-bg" value="${rgbToHex(compStyle.backgroundColor)}">
        </div>
      </div>
      <div class="insp-field">
        <label>Font Size</label>
        <input type="text" id="inp-fontsize" value="${selectedEl.style.fontSize || compStyle.fontSize}">
      </div>
    </div>
  `;

  // Bind input change handlers
  wrap.querySelector("#inp-id").oninput = (e) => { selectedEl.id = e.target.value; renderTree(); };
  wrap.querySelector("#inp-class").oninput = (e) => {
    selectedEl.className = e.target.value + " __n3xn_sel";
    renderTree();
  };
  wrap.querySelector("#inp-text").oninput = (e) => { selectedEl.innerText = e.target.value; };
  wrap.querySelector("#inp-display").onchange = (e) => { selectedEl.style.display = e.target.value; };
  wrap.querySelector("#inp-padding").oninput = (e) => { selectedEl.style.padding = e.target.value; };
  wrap.querySelector("#inp-margin").oninput = (e) => { selectedEl.style.margin = e.target.value; };
  wrap.querySelector("#inp-color").oninput = (e) => { selectedEl.style.color = e.target.value; };
  wrap.querySelector("#inp-bg").oninput = (e) => { selectedEl.style.backgroundColor = e.target.value; };
  wrap.querySelector("#inp-fontsize").oninput = (e) => { selectedEl.style.fontSize = e.target.value; };
}

function rgbToHex(rgb) {
  if (!rgb || rgb === "transparent") return "#000000";
  const nums = rgb.match(/\d+/g);
  if (!nums || nums.length < 3) return "#000000";
  return "#" + ((1 << 24) + (+nums[0] << 16) + (+nums[1] << 8) + +nums[2]).toString(16).slice(1);
}

/* ==========================================================================
   DOM TREE HIERARCHY
   ========================================================================== */

function renderTree() {
  const tree = panel.querySelector("#hv-tree");
  if (!tree || !docRoot) return;

  function walk(node, depth) {
    if (node.nodeType !== 1) return "";
    const name = node.tagName.toLowerCase();
    if (["script", "style", "head"].includes(name)) return "";

    const id = node.id ? "#" + node.id : "";
    const cls = node.className && typeof node.className === "string"
      ? "." + node.className.replace("__n3xn_sel", "").trim().split(/\s+/)[0]
      : "";
    const isSel = node === selectedEl ? " active" : "";

    let html = `<div class="hv-node${isSel}" data-depth="${depth}" style="padding-left:${depth * 14 + 8}px">
      <span class="node-tag">&lt;${name}&gt;</span> <span class="node-id">${id}</span><span class="node-class">${cls !== "." ? cls : ""}</span>
    </div>`;

    for (const child of node.children) {
      html += walk(child, depth + 1);
    }
    return html;
  }

  tree.innerHTML = walk(docRoot.body, 0);

  // Bind node click listeners
  const allNodes = [];
  function collect(node) {
    if (node.nodeType !== 1) return;
    const name = node.tagName.toLowerCase();
    if (!["script", "style", "head"].includes(name)) allNodes.push(node);
    for (const c of node.children) collect(c);
  }
  collect(docRoot.body);

  tree.querySelectorAll(".hv-node").forEach((n, idx) => {
    n.onclick = () => {
      selectElement(allNodes[idx]);
    };
  });
}

/* ==========================================================================
   ELEMENT & PRESET INSERTION
   ========================================================================== */

function insertTag(tag) {
  if (!docRoot) return;
  const parent = selectedEl && selectedEl !== docRoot.body ? selectedEl.parentElement : docRoot.body;
  const el = docRoot.createElement(tag);

  if (tag === "img") {
    el.src = prompt("Image URL or path:", "https://via.placeholder.com/300x200") || "";
    el.alt = "Image";
    el.style.maxWidth = "100%";
  } else if (tag === "a") {
    el.href = prompt("Link destination:", "#") || "#";
    el.textContent = prompt("Link Text:", "Click Here") || "Click Here";
    el.style.color = "#00f3ff";
  } else if (tag === "button") {
    el.textContent = "Button";
    el.style.padding = "8px 16px";
    el.style.background = "#00f3ff";
    el.style.border = "none";
    el.style.borderRadius = "4px";
  } else if (tag === "canvas") {
    el.width = 400;
    el.height = 300;
    el.style.border = "1px solid #444";
  } else if (tag === "ul") {
    el.innerHTML = `<li>Item 1</li><li>Item 2</li>`;
  } else {
    el.textContent = tag.startsWith("h") ? "Heading" : "Text Block";
  }

  appendOrAfter(parent, el);
  selectElement(el);
}

function insertPreset(preset) {
  if (!docRoot) return;
  const parent = selectedEl && selectedEl !== docRoot.body ? selectedEl.parentElement : docRoot.body;
  const container = docRoot.createElement("div");

  if (preset === "section") {
    container.innerHTML = `<section style="padding: 40px 20px; background: #141824; margin: 10px 0; border-radius: 8px;"><h2>Section Title</h2><p>Section content details go here...</p></section>`;
  } else if (preset === "container") {
    container.innerHTML = `<div style="max-width: 1100px; margin: 0 auto; padding: 20px; border: 1px dashed #2d3748;">Container Wrapper</div>`;
  } else if (preset === "grid-2") {
    container.innerHTML = `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 10px 0;">
      <div style="background:#1a202c; padding:20px; border-radius:6px;">Column 1</div>
      <div style="background:#1a202c; padding:20px; border-radius:6px;">Column 2</div>
    </div>`;
  } else if (preset === "grid-3") {
    container.innerHTML = `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 10px 0;">
      <div style="background:#1a202c; padding:20px; border-radius:6px;">Card 1</div>
      <div style="background:#1a202c; padding:20px; border-radius:6px;">Card 2</div>
      <div style="background:#1a202c; padding:20px; border-radius:6px;">Card 3</div>
    </div>`;
  } else if (preset === "game-card") {
    container.innerHTML = `<div style="background: #1a202c; border: 1px solid #2d3748; border-radius: 10px; padding: 16px; width: 260px; text-align: center; font-family: sans-serif;">
      <img src="https://via.placeholder.com/260x150" style="width: 100%; border-radius: 6px;" alt="Game Banner"/>
      <h3 style="color: #00f3ff; margin: 12px 0 6px 0;">Awesome Game</h3>
      <p style="color: #a0aec0; font-size: 13px;">Play directly in browser!</p>
      <button style="background: #00f3ff; color: #000; border: none; padding: 8px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; margin-top: 8px;">Launch Game</button>
    </div>`;
  } else if (preset === "game-frame") {
    container.innerHTML = `<div style="width: 100%; height: 400px; border: 2px solid #00f3ff; border-radius: 8px; overflow: hidden;">
      <iframe src="about:blank" style="width: 100%; height: 100%; border: none;"></iframe>
    </div>`;
  } else if (preset === "hero-banner") {
    container.innerHTML = `<div style="padding: 60px 20px; text-align: center; background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); border-radius: 12px; margin: 20px 0;">
      <h1 style="font-size: 42px; color: #00f3ff; margin-bottom: 10px;">Ultimate Game Hub</h1>
      <p style="font-size: 18px; color: #cbd5e1; max-width: 600px; margin: 0 auto 20px auto;">Discover and play top web arcade games instantly.</p>
      <a href="#" style="display: inline-block; background: #00f3ff; color: #000; font-weight: bold; padding: 12px 28px; border-radius: 6px; text-decoration: none;">Explore Games</a>
    </div>`;
  } else if (preset === "nav-bar") {
    container.innerHTML = `<nav style="display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; background: #141824; border-bottom: 1px solid #2d3748;">
      <div style="font-size: 20px; font-weight: bold; color: #00f3ff;">🎮 GamePortal</div>
      <div style="display: flex; gap: 20px;">
        <a href="#" style="color: #fff; text-decoration: none;">Home</a>
        <a href="#" style="color: #a0aec0; text-decoration: none;">Games</a>
        <a href="#" style="color: #a0aec0; text-decoration: none;">Leaderboard</a>
      </div>
    </nav>`;
  }

  const inserted = container.firstElementChild;
  if (inserted) {
    appendOrAfter(parent, inserted);
    selectElement(inserted);
  }
}

function appendOrAfter(parent, newEl) {
  if (selectedEl && selectedEl !== docRoot.body) {
    selectedEl.after(newEl);
  } else {
    parent.appendChild(newEl);
  }
}

/* ==========================================================================
   NODE ACTIONS & SAVE
   ========================================================================== */

function deleteSelected() {
  if (!selectedEl || selectedEl === docRoot.body) return;
  const parent = selectedEl.parentElement;
  selectedEl.remove();
  selectElement(parent !== docRoot.body ? parent : null);
}

function duplicateSelected() {
  if (!selectedEl || selectedEl === docRoot.body) return;
  const clone = selectedEl.cloneNode(true);
  clone.classList.remove("__n3xn_sel");
  selectedEl.after(clone);
  selectElement(clone);
}

function moveSelected(direction) {
  if (!selectedEl || selectedEl === docRoot.body) return;
  if (direction === -1 && selectedEl.previousElementSibling) {
    selectedEl.parentElement.insertBefore(selectedEl, selectedEl.previousElementSibling);
  } else if (direction === 1 && selectedEl.nextElementSibling) {
    selectedEl.parentElement.insertBefore(selectedEl.nextElementSibling, selectedEl);
  }
  renderTree();
}

async function applyToFile() {
  if (!docRoot || !currentPath) return;

  // Clean editor artifacts prior to saving
  const clone = docRoot.documentElement.cloneNode(true);
  clone.querySelectorAll(".__n3xn_sel").forEach((n) => n.classList.remove("__n3xn_sel"));
  const styleTag = clone.querySelector("#__n3xn_editor_styles");
  if (styleTag) styleTag.remove();

  const fullHtml = "<!DOCTYPE html>\n" + clone.outerHTML;

  await fs.writeFile(currentPath, fullHtml, { mime: "text/html" });

  // Sync back to Monaco Editor if open
  if (window.__n3xnActivePath === currentPath && window.__n3xnEditor) {
    const model = window.__n3xnEditor.getModel();
    if (model) model.setValue(fullHtml);
  }
  if (window.refreshTree) window.refreshTree();

  alert("Saved HTML file to " + currentPath);
}

/* ==========================================================================
   STUDIO CSS STYLESHEET
   ========================================================================== */

function injectStudioStyles() {
  if (document.getElementById("n3xn-hv-styles")) return;
  const style = document.createElement("style");
  style.id = "n3xn-hv-styles";
  style.textContent = `
    .hv-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 16px; background: #141824; border-bottom: 1px solid #2d3748;
    }
    .hv-brand { display: flex; align-items: center; gap: 8px; font-weight: bold; color: #00f3ff; }
    .hv-viewports { display: flex; gap: 4px; background: #0d0e15; padding: 2px; border-radius: 6px; }
    .hv-vp-btn { background: transparent; border: none; color: #a0aec0; padding: 4px 10px; font-size: 11px; cursor: pointer; border-radius: 4px; }
    .hv-vp-btn.active { background: #2b6cb0; color: #fff; }

    .hv-body { display: flex; flex: 1; overflow: hidden; }
    .hv-sidebar { width: 280px; background: #141824; border-right: 1px solid #2d3748; display: flex; flex-direction: column; }
    .hv-tabs { display: flex; border-bottom: 1px solid #2d3748; }
    .hv-tab { flex: 1; padding: 8px; background: #0d0e15; border: none; color: #a0aec0; font-size: 12px; cursor: pointer; }
    .hv-tab.active { background: #141824; color: #00f3ff; border-bottom: 2px solid #00f3ff; font-weight: bold; }
    .hv-tab-content { display: none; padding: 12px; flex: 1; overflow-y: auto; }
    .hv-tab-content.active { display: block; }

    .hv-group-title { font-size: 11px; text-transform: uppercase; color: #718096; font-weight: bold; margin: 12px 0 6px 0; }
    .hv-grid-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .tool-btn { background: #1a202c; border: 1px solid #2d3748; color: #e2e8f0; padding: 8px; font-size: 11px; border-radius: 4px; cursor: pointer; text-align: left; }
    .tool-btn:hover { border-color: #00f3ff; color: #00f3ff; }

    .hv-stage { flex: 1; background: #07080c; display: flex; justify-content: center; align-items: center; padding: 16px; overflow: auto; }
    .hv-frame-wrapper { height: 100%; background: #fff; transition: width 0.2s ease; border-radius: 4px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .hv-preview { width: 100%; height: 100%; border: none; }

    .hv-footer { display: flex; justify-content: space-between; align-items: center; padding: 6px 16px; background: #141824; border-top: 1px solid #2d3748; font-size: 11px; color: #a0aec0; }
    .hv-breadcrumbs .crumb { color: #00f3ff; margin: 0 4px; }
    .hv-node-actions { display: flex; gap: 6px; }

    .hv-node { padding: 4px 8px; font-family: monospace; font-size: 11px; color: #a0aec0; cursor: pointer; border-radius: 3px; }
    .hv-node:hover { background: #2d3748; }
    .hv-node.active { background: #2b6cb0; color: #fff; }
    .node-tag { color: #63b3ed; }
    .node-id { color: #f6ad55; }
    .node-class { color: #68d391; }

    .insp-section { margin-bottom: 14px; border-bottom: 1px solid #2d3748; padding-bottom: 10px; }
    .insp-section h4 { margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; color: #00f3ff; }
    .insp-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
    .insp-field label { font-size: 10px; color: #a0aec0; }
    .insp-field input, .insp-field select, .insp-field textarea { background: #0d0e15; border: 1px solid #2d3748; color: #fff; padding: 6px; font-size: 11px; border-radius: 4px; }
    .insp-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .hv-empty-msg { font-size: 11px; color: #718096; text-align: center; margin-top: 20px; }
  `;
  document.head.appendChild(style);
}
