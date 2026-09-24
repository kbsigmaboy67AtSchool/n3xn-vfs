/**
 * n3xn VFS v3 — Advanced Media & Meme Studio
 * Interactive transform layers, vector annotations, visual cropping, & Undo/Redo history.
 */
import * as fs from "./fs.js";

let panel = null;
let canvas = null;
let ctx = null;

// Editor State
let baseImage = null; 
let layers = []; 
let selectedLayerIndex = -1;
let rotation = 0;
let sourcePath = null;
let activeTool = "select"; // 'select' | 'crop' | 'pen' | 'marker' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'arrow'
let isDrawingOrTransforming = false;
let currentPath = [];

// Crop Tool State
let cropRect = null; // { x, y, w, h }

// History Engine
const history = [];
let historyIndex = -1;
const MAX_HISTORY = 30;

const FONTS = [
  "Impact, Haettenschweiler, sans-serif",
  "Arial Black, Gadget, sans-serif",
  "Comic Sans MS, cursive",
  "Georgia, serif",
  "Courier New, monospace",
  "Sixtyfour, monospace",
  "JetBrains Mono, monospace",
  "system-ui, sans-serif",
];

/* ==========================================================================
   PUBLIC API
   ========================================================================== */

export function openMediaEditor(path) {
  try {
    sourcePath = path || null;
    ensurePanel();
    showPanelEl(panel);
    setupKeyboardListeners();

    if (path) {
      loadFromPath(path).catch((e) => {
        console.error("VFS Load Error:", e);
        resetCanvas(800, 600);
      });
    } else {
      resetCanvas(800, 600);
    }
  } catch (e) {
    console.error(e);
    alert("Media editor error: " + e.message);
  }
}

export function closeMediaEditor() {
  hidePanelEl(panel);
  removeKeyboardListeners();
}

/* ==========================================================================
   PANEL INITIALIZATION & LAYOUT
   ========================================================================== */

function showPanelEl(el) {
  if (!el) return;
  el.className = "media-editor";
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
    background: "#0d0e15",
    color: "#e2e8f0",
    overflow: "hidden",
    border: "1px solid #2d3748",
    borderRadius: "8px",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
    fontFamily: "system-ui, sans-serif",
  });
}

function hidePanelEl(el) {
  if (!el) return;
  el.className = "media-editor hidden";
  el.style.setProperty("display", "none", "important");
}

function ensurePanel() {
  if (panel && document.body.contains(panel)) {
    canvas = panel.querySelector("#me-canvas");
    ctx = canvas ? canvas.getContext("2d") : null;
    return;
  }

  panel = document.createElement("div");
  panel.id = "media-editor";
  panel.innerHTML = `
    <div class="me-header" style="display:flex; justify-content:space-between; align-items:center; padding:8px 16px; background:#1a202c; border-bottom:1px solid #2d3748;">
      <span class="me-title" style="font-weight:600; font-size:14px;">Media / Meme Studio v3</span>
      <div class="me-header-actions" style="display:flex; gap:8px;">
        <button type="button" class="btn small" id="me-undo" title="Undo (Ctrl+Z)">↶</button>
        <button type="button" class="btn small" id="me-redo" title="Redo (Ctrl+Y)">↷</button>
        <button type="button" class="btn small" id="me-fs" title="Fullscreen">⛶</button>
        <button type="button" class="btn small ghost" id="me-close">✕</button>
      </div>
    </div>
    <div class="me-body" style="display:flex; flex:1; overflow:hidden;">
      <div class="me-toolbar" style="display:flex; flex-direction:column; gap:6px; padding:10px; background:#141824; border-right:1px solid #2d3748; min-width:130px;">
        <button type="button" class="btn small" id="me-tool-select">🎯 Select</button>
        <button type="button" class="btn small" id="me-load">Load</button>
        <button type="button" class="btn small" id="me-url">+ URL</button>
        <button type="button" class="btn small" id="me-text">+ Text</button>
        <button type="button" class="btn small" id="me-svg">+ SVG</button>
        <button type="button" class="btn small" id="me-rotate">↻ 90°</button>
        <button type="button" class="btn small" id="me-crop">✂️ Crop</button>
        <hr style="border:0; border-top:1px solid #2d3748; margin:4px 0;" />
        <button type="button" class="btn small" id="me-tool-pen">✏️ Pen</button>
        <button type="button" class="btn small" id="me-tool-marker">▮ Marker</button>
        <button type="button" class="btn small" id="me-tool-line">／ Line</button>
        <button type="button" class="btn small" id="me-tool-rect">▭ Rect</button>
        <button type="button" class="btn small" id="me-tool-ellipse">◯ Circle</button>
        <button type="button" class="btn small" id="me-tool-arrow">→</button>
        <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
          <label style="font-size:10px; color:#a0aec0;">Stroke Color</label>
          <input type="color" id="me-draw-color" value="#00f3ff" style="width:100%; height:28px; cursor:pointer;" />
          <label style="font-size:10px; color:#a0aec0;">Stroke Size</label>
          <input type="range" id="me-draw-size" min="1" max="64" value="4" style="width:100%;" />
        </div>
        <hr style="border:0; border-top:1px solid #2d3748; margin:4px 0;" />
        <button type="button" class="btn small primary" id="me-export">Export PNG</button>
        <button type="button" class="btn small" id="me-export-jpg">JPG</button>
        <button type="button" class="btn small" id="me-save-vfs">Save VFS</button>
      </div>

      <div class="me-workspace" style="display:flex; flex:1; overflow:hidden; background:#07080c; position:relative;">
        <div class="me-canvas-wrap" style="flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; padding:20px;">
          <canvas id="me-canvas" width="800" height="600" style="box-shadow: 0 10px 30px rgba(0,0,0,0.8); background:#111; cursor:default;"></canvas>
        </div>

        <div class="me-props" style="width:240px; background:#141824; border-left:1px solid #2d3748; padding:12px; display:flex; flex-direction:column; gap:8px; overflow-y:auto;">
          <h4 style="margin:0 0 6px 0; font-size:12px; text-transform:uppercase; color:#718096;">Layer Properties</h4>
          <div id="me-text-props" style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:11px;">Text Content</label>
            <input type="text" id="me-prop-text" placeholder="Meme text" />
            <label style="font-size:11px;">Font</label>
            <select id="me-prop-font"></select>
            <div style="display:flex; gap:6px;">
              <div style="flex:1;"><label style="font-size:11px;">Size</label><input type="number" id="me-prop-size" value="48" /></div>
              <div style="flex:1;"><label style="font-size:11px;">Text Color</label><input type="color" id="me-prop-color" value="#ffffff" style="width:100%; height:26px;" /></div>
            </div>
            <div style="display:flex; gap:6px;">
              <div style="flex:1;"><label style="font-size:11px;">Outline</label><input type="color" id="me-prop-stroke" value="#000000" style="width:100%; height:26px;" /></div>
              <div style="flex:1;"><label style="font-size:11px;">BG Color</label><input type="color" id="me-prop-bg" value="#000000" style="width:100%; height:26px;" /></div>
            </div>
            <label style="font-size:11px;"><input type="checkbox" id="me-prop-bg-on" /> Fill background</label>
          </div>

          <hr style="border:0; border-top:1px solid #2d3748; margin:4px 0;" />
          <h4 style="margin:0; font-size:12px; text-transform:uppercase; color:#718096;">Layer Stack</h4>
          <div class="me-layer-list" id="me-layers" style="flex:1; max-height:180px; overflow-y:auto; border:1px solid #2d3748; border-radius:4px; background:#0d0e15;"></div>
          
          <div style="display:flex; gap:4px;">
            <button type="button" class="btn small" id="me-layer-up" title="Move Up">▲</button>
            <button type="button" class="btn small" id="me-layer-down" title="Move Down">▼</button>
            <button type="button" class="btn small ghost" id="me-del-layer" style="color:#e53e3e; margin-left:auto;">Delete</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  canvas = panel.querySelector("#me-canvas");
  ctx = canvas.getContext("2d");

  // Populate Font Selector
  const fontSel = panel.querySelector("#me-prop-font");
  FONTS.forEach((f) => {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f.split(",")[0];
    fontSel.appendChild(o);
  });

  bindEvents();
}

/* ==========================================================================
   EVENT HANDLERS & INTERACTION ENGINE
   ========================================================================== */

function bindEvents() {
  panel.querySelector("#me-close").onclick = () => closeMediaEditor();
  panel.querySelector("#me-undo").onclick = () => undo();
  panel.querySelector("#me-redo").onclick = () => redo();
  panel.querySelector("#me-fs").onclick = () => {
    if (!document.fullscreenElement) panel.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  // Tool Selection
  const tools = ["select", "pen", "marker", "line", "rect", "ellipse", "arrow"];
  tools.forEach((t) => {
    const btn = panel.querySelector("#me-tool-" + t);
    if (btn) btn.onclick = () => setTool(t);
  });

  panel.querySelector("#me-load").onclick = async () => {
    const p = window.__n3xnActivePath || prompt("VFS path to load:");
    if (p) await loadFromPath(p);
  };
  panel.querySelector("#me-url").onclick = () => insertFromUrl();
  panel.querySelector("#me-text").onclick = () => addTextLayer("TOP TEXT");
  panel.querySelector("#me-svg").onclick = () => insertSvg();
  panel.querySelector("#me-rotate").onclick = () => {
    rotation = (rotation + 90) % 360;
    saveHistoryState();
    redraw();
  };
  panel.querySelector("#me-crop").onclick = () => enableCropMode();
  panel.querySelector("#me-export").onclick = () => exportImage("image/png");
  panel.querySelector("#me-export-jpg").onclick = () => exportImage("image/jpeg");
  panel.querySelector("#me-save-vfs").onclick = () => saveToVfs();

  // Layer Stack Controls
  panel.querySelector("#me-del-layer").onclick = () => deleteSelectedLayer();
  panel.querySelector("#me-layer-up").onclick = () => moveLayerOrder(-1);
  panel.querySelector("#me-layer-down").onclick = () => moveLayerOrder(1);

  // Property Inputs
  ["me-prop-text", "me-prop-font", "me-prop-size", "me-prop-color", "me-prop-stroke", "me-prop-bg", "me-prop-bg-on"].forEach((id) => {
    const el = panel.querySelector("#" + id);
    if (el) {
      el.addEventListener("input", applyPropsToSelected);
      el.addEventListener("change", applyPropsToSelected);
    }
  });

  // Pointer Interaction
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
}

function setTool(tool) {
  activeTool = tool;
  cropRect = null;
  canvas.style.cursor = tool === "select" ? "default" : "crosshair";
  redraw();
}

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height,
  };
}

let activeDrag = null; // { type: 'move'|'resize', layerIndex, startX, startY, origX, origY, origW, origH }

function handlePointerDown(e) {
  const pt = getCanvasCoords(e);
  isDrawingOrTransforming = true;

  if (activeTool === "crop") {
    cropRect = { x: pt.x, y: pt.y, w: 0, h: 0 };
    return;
  }

  if (activeTool === "select") {
    // Check handles for selected layer
    if (selectedLayerIndex >= 0) {
      const L = layers[selectedLayerIndex];
      const bounds = getLayerBounds(L);
      if (bounds && isPointInHandle(pt, bounds.x + bounds.w, bounds.y + bounds.h)) {
        activeDrag = { type: "resize", layerIndex: selectedLayerIndex, startX: pt.x, startY: pt.y, origW: L.w || bounds.w, origH: L.h || bounds.h };
        return;
      }
    }

    // Hit test layers from top to bottom
    let hit = -1;
    for (let i = layers.length - 1; i >= 0; i--) {
      if (hitTestLayer(layers[i], pt)) {
        hit = i;
        break;
      }
    }

    selectedLayerIndex = hit;
    if (hit >= 0) {
      const L = layers[hit];
      activeDrag = { type: "move", layerIndex: hit, startX: pt.x, startY: pt.y, origX: L.x, origY: L.y };
      fillProps(L);
    }
    renderLayerList();
    redraw();
    return;
  }

  // Vector shape / draw tools
  currentPath = [pt];
}

function handlePointerMove(e) {
  if (!isDrawingOrTransforming) return;
  const pt = getCanvasCoords(e);

  if (activeTool === "crop" && cropRect) {
    cropRect.w = pt.x - cropRect.x;
    cropRect.h = pt.y - cropRect.y;
    redraw();
    return;
  }

  if (activeTool === "select" && activeDrag) {
    const dx = pt.x - activeDrag.startX;
    const dy = pt.y - activeDrag.startY;
    const L = layers[activeDrag.layerIndex];

    if (activeDrag.type === "move") {
      L.x = activeDrag.origX + dx;
      L.y = activeDrag.origY + dy;
    } else if (activeDrag.type === "resize") {
      if (L.type === "text") {
        L.size = Math.max(12, Math.round(activeDrag.origH + dy));
      } else {
        L.w = Math.max(20, activeDrag.origW + dx);
        L.h = Math.max(20, activeDrag.origH + dy);
      }
    }
    redraw();
    return;
  }

  // Draw modes preview
  if (["pen", "marker"].includes(activeTool)) {
    currentPath.push(pt);
    redraw();
    drawPathPreview(currentPath);
  } else if (["line", "rect", "ellipse", "arrow"].includes(activeTool)) {
    redraw();
    drawShapePreview(currentPath[0], pt);
  }
}

function handlePointerUp(e) {
  if (!isDrawingOrTransforming) return;
  isDrawingOrTransforming = false;
  const pt = getCanvasCoords(e);

  if (activeTool === "crop") {
    if (cropRect && Math.abs(cropRect.w) > 20 && Math.abs(cropRect.h) > 20) {
      applyCrop(cropRect);
    }
    cropRect = null;
    setTool("select");
    return;
  }

  if (activeTool !== "select" && currentPath.length > 0) {
    const color = panel.querySelector("#me-draw-color")?.value || "#00f3ff";
    const size = Number(panel.querySelector("#me-draw-size")?.value || 4);

    layers.push({
      type: "vector",
      tool: activeTool,
      pts: activeTool === "pen" || activeTool === "marker" ? currentPath : [currentPath[0], pt],
      color,
      size: activeTool === "marker" ? size * 3 : size,
      alpha: activeTool === "marker" ? 0.35 : 1.0,
      x: 0,
      y: 0,
    });

    currentPath = [];
    selectedLayerIndex = layers.length - 1;
    saveHistoryState();
    renderLayerList();
    redraw();
  } else if (activeDrag) {
    saveHistoryState();
    activeDrag = null;
  }
}

/* ==========================================================================
   RENDERING & CANVAS TRANSFORMATIONS
   ========================================================================== */

function redraw() {
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Canvas background
  ctx.fillStyle = "#090a0f";
  ctx.fillRect(0, 0, w, h);

  // Global canvas rotation
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);

  // Render Base Image
  if (baseImage) {
    ctx.drawImage(baseImage, 0, 0, w, h);
  }

  // Render Layers Stack
  layers.forEach((L, idx) => {
    ctx.save();
    if (L.type === "text") {
      ctx.font = `bold ${L.size}px ${L.font}`;
      ctx.textBaseline = "top";
      const metrics = ctx.measureText(L.text);
      if (L.bgOn) {
        ctx.fillStyle = L.bg;
        ctx.fillRect(L.x - 6, L.y - 4, metrics.width + 12, L.size + 12);
      }
      ctx.lineWidth = Math.max(2, L.size / 16);
      ctx.strokeStyle = L.stroke;
      ctx.strokeText(L.text, L.x, L.y);
      ctx.fillStyle = L.color;
      ctx.fillText(L.text, L.x, L.y);
    } else if (L.type === "image" && L.img) {
      ctx.drawImage(L.img, L.x, L.y, L.w || L.img.width, L.h || L.img.height);
    } else if (L.type === "vector") {
      renderVectorLayer(L);
    }

    // Draw Selection Bounds & Handles
    if (idx === selectedLayerIndex && activeTool === "select") {
      const b = getLayerBounds(L);
      if (b) {
        ctx.strokeStyle = "#00f3ff";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
        ctx.setLineDash([]);
        // Handle
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(b.x + b.w + 2, b.y + b.h + 2, 8, 8);
        ctx.strokeRect(b.x + b.w + 2, b.y + b.h + 2, 8, 8);
      }
    }
    ctx.restore();
  });

  // Render Crop Overlay Preview
  if (cropRect) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, w, h);
    ctx.clearRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
    ctx.strokeStyle = "#00f3ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
  }

  ctx.restore();
}

function renderVectorLayer(L) {
  ctx.save();
  ctx.strokeStyle = L.color;
  ctx.fillStyle = L.color;
  ctx.lineWidth = L.size;
  ctx.globalAlpha = L.alpha || 1.0;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (L.tool === "pen" || L.tool === "marker") {
    ctx.beginPath();
    L.pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  } else if (L.tool === "line") {
    ctx.beginPath();
    ctx.moveTo(L.pts[0].x, L.pts[0].y);
    ctx.lineTo(L.pts[1].x, L.pts[1].y);
    ctx.stroke();
  } else if (L.tool === "rect") {
    ctx.strokeRect(L.pts[0].x, L.pts[0].y, L.pts[1].x - L.pts[0].x, L.pts[1].y - L.pts[0].y);
  } else if (L.tool === "ellipse") {
    const x0 = L.pts[0].x, y0 = L.pts[0].y, x1 = L.pts[1].x, y1 = L.pts[1].y;
    ctx.beginPath();
    ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (L.tool === "arrow") {
    const p0 = L.pts[0], p1 = L.pts[1];
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const head = 10 + L.size * 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p1.x - head * Math.cos(ang - 0.4), p1.y - head * Math.sin(ang - 0.4));
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p1.x - head * Math.cos(ang + 0.4), p1.y - head * Math.sin(ang + 0.4));
    ctx.stroke();
  }
  ctx.restore();
}

/* Helper preview during drawing */
function drawPathPreview(pts) {
  ctx.save();
  ctx.strokeStyle = panel.querySelector("#me-draw-color").value;
  ctx.lineWidth = Number(panel.querySelector("#me-draw-size").value);
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();
}

function drawShapePreview(p0, p1) {
  renderVectorLayer({
    tool: activeTool,
    pts: [p0, p1],
    color: panel.querySelector("#me-draw-color").value,
    size: Number(panel.querySelector("#me-draw-size").value),
    alpha: 1.0,
  });
}

/* ==========================================================================
   HIT TESTING & BOUNDS CALCULATIONS
   ========================================================================== */

function getLayerBounds(L) {
  if (!L) return null;
  if (L.type === "text") {
    ctx.font = `bold ${L.size}px ${L.font}`;
    const m = ctx.measureText(L.text || "");
    return { x: L.x, y: L.y, w: m.width, h: L.size };
  }
  if (L.type === "image") {
    return { x: L.x, y: L.y, w: L.w || L.img?.width || 100, h: L.h || L.img?.height || 100 };
  }
  if (L.type === "vector") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    L.pts.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    return { x: minX, y: minY, w: maxX - minX || 10, h: maxY - minY || 10 };
  }
  return null;
}

function hitTestLayer(L, pt) {
  const b = getLayerBounds(L);
  if (!b) return false;
  return pt.x >= b.x - 6 && pt.x <= b.x + b.w + 6 && pt.y >= b.y - 6 && pt.y <= b.y + b.h + 6;
}

function isPointInHandle(pt, hX, hY) {
  return Math.abs(pt.x - hX) <= 10 && Math.abs(pt.y - hY) <= 10;
}

/* ==========================================================================
   HISTORY, CROP & STATE MANAGEMENT
   ========================================================================== */

function saveHistoryState() {
  const state = {
    layers: JSON.parse(JSON.stringify(layers.map((l) => (l.type === "image" ? { ...l, imgUrl: l.img.src } : l)))),
    rotation,
    canvasW: canvas.width,
    canvasH: canvas.height,
  };

  history.splice(historyIndex + 1);
  history.push(state);
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
}

async function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    await restoreHistoryState(history[historyIndex]);
  }
}

async function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    await restoreHistoryState(history[historyIndex]);
  }
}

async function restoreHistoryState(state) {
  canvas.width = state.canvasW;
  canvas.height = state.canvasH;
  rotation = state.rotation;

  layers = await Promise.all(
    state.layers.map(async (l) => {
      if (l.type === "image" && l.imgUrl) {
        const img = new Image();
        img.src = l.imgUrl;
        await new Promise((res) => (img.onload = res));
        return { ...l, img };
      }
      return l;
    })
  );

  selectedLayerIndex = -1;
  renderLayerList();
  redraw();
}

function applyCrop(rect) {
  const rx = Math.max(0, Math.min(rect.x, rect.x + rect.w));
  const ry = Math.max(0, Math.min(rect.y, rect.y + rect.h));
  const rw = Math.abs(rect.w);
  const rh = Math.abs(rect.h);

  const tmp = document.createElement("canvas");
  tmp.width = rw;
  tmp.height = rh;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);

  const img = new Image();
  img.onload = () => {
    baseImage = img;
    canvas.width = rw;
    canvas.height = rh;
    layers = [];
    rotation = 0;
    saveHistoryState();
    renderLayerList();
    redraw();
  };
  img.src = tmp.toDataURL("image/png");
}

/* ==========================================================================
   UI / LAYER HELPERS & EXPORT
   ========================================================================== */

function resetCanvas(w, h) {
  canvas.width = w;
  canvas.height = h;
  baseImage = null;
  layers = [];
  rotation = 0;
  saveHistoryState();
  redraw();
  renderLayerList();
}

function deleteSelectedLayer() {
  if (selectedLayerIndex >= 0) {
    layers.splice(selectedLayerIndex, 1);
    selectedLayerIndex = -1;
    saveHistoryState();
    redraw();
    renderLayerList();
  }
}

function moveLayerOrder(dir) {
  if (selectedLayerIndex < 0) return;
  const target = selectedLayerIndex + dir;
  if (target >= 0 && target < layers.length) {
    const temp = layers[selectedLayerIndex];
    layers[selectedLayerIndex] = layers[target];
    layers[target] = temp;
    selectedLayerIndex = target;
    saveHistoryState();
    redraw();
    renderLayerList();
  }
}

function addTextLayer(text) {
  const L = {
    type: "text",
    text: text || "TEXT",
    font: FONTS[0],
    size: 48,
    color: "#ffffff",
    stroke: "#000000",
    bg: "#000000",
    bgOn: false,
    x: canvas.width / 4,
    y: canvas.height / 4,
  };
  layers.push(L);
  selectedLayerIndex = layers.length - 1;
  fillProps(L);
  saveHistoryState();
  redraw();
  renderLayerList();
}

function fillProps(L) {
  if (!L || L.type !== "text") return;
  panel.querySelector("#me-prop-text").value = L.text;
  panel.querySelector("#me-prop-font").value = L.font;
  panel.querySelector("#me-prop-size").value = L.size;
  panel.querySelector("#me-prop-color").value = L.color;
  panel.querySelector("#me-prop-stroke").value = L.stroke;
  panel.querySelector("#me-prop-bg").value = L.bg;
  panel.querySelector("#me-prop-bg-on").checked = !!L.bgOn;
}

function applyPropsToSelected() {
  if (selectedLayerIndex < 0 || layers[selectedLayerIndex]?.type !== "text") return;
  const L = layers[selectedLayerIndex];
  L.text = panel.querySelector("#me-prop-text").value;
  L.font = panel.querySelector("#me-prop-font").value;
  L.size = +panel.querySelector("#me-prop-size").value || 48;
  L.color = panel.querySelector("#me-prop-color").value;
  L.stroke = panel.querySelector("#me-prop-stroke").value;
  L.bg = panel.querySelector("#me-prop-bg").value;
  L.bgOn = panel.querySelector("#me-prop-bg-on").checked;
  redraw();
}

function renderLayerList() {
  const el = panel.querySelector("#me-layers");
  el.innerHTML = layers
    .map(
      (L, i) =>
        `<div class="me-layer ${i === selectedLayerIndex ? "active" : ""}" data-i="${i}" style="padding:4px 8px; font-size:11px; border-bottom:1px solid #1a202c; cursor:pointer; background:${i === selectedLayerIndex ? "#2b6cb0" : "transparent"}">
          ${L.type === "text" ? "T: " + (L.text || "").slice(0, 16) : L.type === "vector" ? "✒️ " + L.tool : "🖼️ Image"}
        </div>`
    )
    .reverse()
    .join("");

  el.querySelectorAll(".me-layer").forEach((node) => {
    node.onclick = () => {
      selectedLayerIndex = +node.dataset.i;
      fillProps(layers[selectedLayerIndex]);
      renderLayerList();
      redraw();
    };
  });
}

/* ==========================================================================
   VFS LOAD / SAVE & EXPORT
   ========================================================================== */

async function loadFromPath(path) {
  sourcePath = path;
  const f = await fs.readFile(path);
  if (!f) throw new Error("File not found in VFS");
  const blob = new Blob([f.content], { type: f.mime || "image/png" });
  const url = URL.createObjectURL(blob);
  await loadImageUrl(url);
  URL.revokeObjectURL(url);
}

function loadImageUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      baseImage = img;
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      rotation = 0;
      saveHistoryState();
      redraw();
      resolve();
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function exportImage(mime) {
  const url = canvas.toDataURL(mime, 0.92);
  const a = document.createElement("a");
  a.href = url;
  a.download = `n3xn-meme-${Date.now()}.${mime.includes("jpeg") ? "jpg" : "png"}`;
  a.click();
}

async function saveToVfs() {
  const name = prompt("Save as path:", sourcePath || `/memes/meme-${Date.now()}.png`);
  if (!name) return;
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  const buf = await blob.arrayBuffer();

  const parts = name.split("/").filter(Boolean);
  parts.pop();
  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    if (!fs.exists(cur)) await fs.mkdir(cur);
  }

  await fs.writeFile(name, new Uint8Array(buf), { mime: "image/png" });
  if (window.refreshTree) window.refreshTree();
  alert("Saved: " + name);
}

/* ==========================================================================
   KEYBOARD SHORTCUTS
   ========================================================================== */

function handleKeyDown(e) {
  if (document.activeElement?.tagName === "INPUT") return;

  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
    e.preventDefault();
    redo();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    deleteSelectedLayer();
  } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    if (selectedLayerIndex >= 0) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const L = layers[selectedLayerIndex];
      if (e.key === "ArrowLeft") L.x -= step;
      if (e.key === "ArrowRight") L.x += step;
      if (e.key === "ArrowUp") L.y -= step;
      if (e.key === "ArrowDown") L.y += step;
      redraw();
    }
  }
}

function setupKeyboardListeners() {
  window.addEventListener("keydown", handleKeyDown);
}

function removeKeyboardListeners() {
  window.removeEventListener("keydown", handleKeyDown);
}
