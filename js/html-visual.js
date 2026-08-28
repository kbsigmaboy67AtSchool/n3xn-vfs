/**
 * n3xn VFS v2 — Simple visual HTML editor
 * Structure panel + live preview + sync back to Monaco/VFS
 */

import * as fs from "./fs.js";

let panel = null;
let path = null;
let docRoot = null;

function showPanelEl(el) {
  if (!el) return;
  el.classList.remove("hidden");
  el.style.cssText = [
    "position:fixed",
    "left:24px",
    "right:24px",
    "top:24px",
    "bottom:24px",
    "z-index:99999",
    "display:flex",
    "flex-direction:column",
    "background:#0a0a0f",
    "border:1px solid #333",
    "box-shadow:0 0 40px rgba(255,255,255,0.15)",
    "border-radius:6px",
    "overflow:hidden",
    "visibility:visible",
    "opacity:1",
    "pointer-events:auto",
  ].join(";");
}

function hidePanelEl(el) {
  if (!el) return;
  el.classList.add("hidden");
  el.style.display = "none";
  el.style.visibility = "hidden";
}

export function openHtmlVisual(filePath) {
  try {
    path = filePath || "/index.html";
    ensurePanel();
    showPanelEl(panel);
    load(path).catch((e) => {
      console.error(e);
      alert("HTML visual load error: " + e.message);
    });
  } catch (e) {
    console.error(e);
    alert("HTML visual error: " + e.message);
  }
}

export function closeHtmlVisual() {
  hidePanelEl(panel);
}

function ensurePanel() {
  if (panel && document.body.contains(panel)) return;
  panel = document.createElement("div");
  panel.id = "html-visual";
  panel.className = "html-visual";
  panel.innerHTML = `
    <div class="hv-header">
      <span>Visual HTML Editor</span>
      <div>
        <button type="button" class="btn small" id="hv-fs">⛶</button>
        <button type="button" class="btn small primary" id="hv-apply">Apply → file</button>
        <button type="button" class="btn small ghost" id="hv-close">✕</button>
      </div>
    </div>
    <div class="hv-toolbar">
      <button type="button" class="btn small" data-tag="h1">H1</button>
      <button type="button" class="btn small" data-tag="h2">H2</button>
      <button type="button" class="btn small" data-tag="p">P</button>
      <button type="button" class="btn small" data-tag="div">Div</button>
      <button type="button" class="btn small" data-tag="button">Button</button>
      <button type="button" class="btn small" data-tag="a">Link</button>
      <button type="button" class="btn small" data-tag="img">Img</button>
      <button type="button" class="btn small" data-tag="ul">List</button>
      <button type="button" class="btn small" data-tag="section">Section</button>
      <button type="button" class="btn small" id="hv-text">Edit text</button>
      <button type="button" class="btn small" id="hv-style">Style…</button>
      <button type="button" class="btn small" id="hv-delete">Delete</button>
    </div>
    <div class="hv-body">
      <div class="hv-tree" id="hv-tree"></div>
      <iframe class="hv-preview" id="hv-preview" allowfullscreen></iframe>
    </div>
  `;
  document.body.appendChild(panel);

  panel.querySelector("#hv-close").onclick = () => closeHtmlVisual();
  panel.querySelector("#hv-fs").onclick = () => {
    if (!document.fullscreenElement) panel.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  panel.querySelector("#hv-apply").onclick = applyToFile;
  panel.querySelector("#hv-text").onclick = editSelectedText;
  panel.querySelector("#hv-style").onclick = editSelectedStyle;
  panel.querySelector("#hv-delete").onclick = deleteSelected;

  panel.querySelectorAll("[data-tag]").forEach((btn) => {
    btn.onclick = () => insertTag(btn.dataset.tag);
  });
}

async function load(filePath) {
  path = filePath;
  let html = "";
  try {
    const f = await fs.readFile(filePath);
    html = f ? f.text() : "";
  } catch {
    html = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>New</title></head><body><h1>Hello</h1><p>Edit me</p></body></html>";
  }
  if (!html.trim()) {
    html = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>New</title></head><body><h1>Hello</h1></body></html>";
  }

  const iframe = panel.querySelector("#hv-preview");
  if (!iframe) throw new Error("Preview iframe missing");
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  iframe.onload = () => {
    try {
      docRoot = iframe.contentDocument;
      wirePreviewClicks();
      renderTree();
    } catch (e) {
      console.warn(e);
    }
  };
  iframe.src = url;
}

let selectedEl = null;

function wirePreviewClicks() {
  if (!docRoot) return;
  docRoot.body.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectedEl = e.target;
    highlight(selectedEl);
    renderTree();
  }, true);
}

function highlight(el) {
  if (!docRoot) return;
  docRoot.querySelectorAll(".__n3xn_sel").forEach((n) => {
    n.classList.remove("__n3xn_sel");
    n.style.outline = "";
  });
  if (el && el !== docRoot.body && el !== docRoot.documentElement) {
    el.classList.add("__n3xn_sel");
    el.style.outline = "2px solid #0af";
  }
}

function renderTree() {
  const tree = document.getElementById("hv-tree");
  if (!docRoot) {
    tree.textContent = "No document";
    return;
  }
  function walk(node, depth) {
    if (node.nodeType !== 1) return "";
    const name = node.tagName.toLowerCase();
    if (["script", "style"].includes(name)) return "";
    const id = node.id ? "#" + node.id : "";
    const cls = node.className && typeof node.className === "string"
      ? "." + node.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
    const isSel = node === selectedEl ? " active" : "";
    let html = `<div class="hv-node${isSel}" data-depth="${depth}" style="padding-left:${depth * 12}px">${name}${id}${cls}</div>`;
    for (const child of node.children) html += walk(child, depth + 1);
    return html;
  }
  tree.innerHTML = walk(docRoot.body, 0);
  tree.querySelectorAll(".hv-node").forEach((n, idx) => {
    n.onclick = () => {
      const all = [];
      function collect(node) {
        if (node.nodeType !== 1) return;
        const name = node.tagName.toLowerCase();
        if (!["script", "style"].includes(name)) all.push(node);
        for (const c of node.children) collect(c);
      }
      collect(docRoot.body);
      selectedEl = all[idx] || null;
      highlight(selectedEl);
      renderTree();
    };
  });
}

function insertTag(tag) {
  if (!docRoot) return;
  const parent = selectedEl && selectedEl !== docRoot.body ? selectedEl.parentElement : docRoot.body;
  const el = docRoot.createElement(tag);
  if (tag === "img") {
    el.src = prompt("Image URL or path:", "https://") || "";
    el.alt = "image";
    el.style.maxWidth = "100%";
  } else if (tag === "a") {
    el.href = prompt("Link href:", "#") || "#";
    el.textContent = prompt("Link text:", "Link") || "Link";
  } else if (tag === "ul") {
    const li = docRoot.createElement("li");
    li.textContent = "Item";
    el.appendChild(li);
  } else if (tag === "button") {
    el.textContent = "Button";
  } else {
    el.textContent = tag === "div" || tag === "section" ? "" : tag.toUpperCase();
  }
  if (selectedEl && selectedEl !== docRoot.body) {
    selectedEl.after(el);
  } else {
    parent.appendChild(el);
  }
  selectedEl = el;
  highlight(el);
  renderTree();
}

function editSelectedText() {
  if (!selectedEl) return alert("Select an element in the preview");
  const t = prompt("Text content:", selectedEl.textContent || "");
  if (t !== null) {
    selectedEl.textContent = t;
    renderTree();
  }
}

function editSelectedStyle() {
  if (!selectedEl) return alert("Select an element");
  const color = prompt("Color (CSS):", selectedEl.style.color || "#ffffff");
  const bg = prompt("Background:", selectedEl.style.background || "");
  const size = prompt("Font size:", selectedEl.style.fontSize || "16px");
  const pad = prompt("Padding:", selectedEl.style.padding || "");
  if (color) selectedEl.style.color = color;
  if (bg !== null) selectedEl.style.background = bg;
  if (size) selectedEl.style.fontSize = size;
  if (pad !== null) selectedEl.style.padding = pad;
}

function deleteSelected() {
  if (!selectedEl || selectedEl === docRoot.body) return;
  selectedEl.remove();
  selectedEl = null;
  renderTree();
}

async function applyToFile() {
  if (!docRoot || !path) return;
  const html = "<!DOCTYPE html>\n" + docRoot.documentElement.outerHTML;
  await fs.writeFile(path, html, { mime: "text/html" });
  // refresh monaco if same file open
  if (window.__n3xnActivePath === path && window.__n3xnEditor) {
    const model = window.__n3xnEditor.getModel();
    if (model) model.setValue(html);
  }
  if (window.refreshTree) window.refreshTree();
  alert("Applied to " + path);
}
