/**
 * n3xn VFS v2 — Media / Meme editor
 * Image, GIF frame, text overlays, crop, rotate, URL insert, export
 */

import * as fs from "./fs.js";

let panel = null;
let canvas = null;
let ctx = null;
let baseImage = null; // HTMLImageElement or ImageBitmap
let layers = []; // { type:'text'|'image', ... }
let selectedLayer = -1;
let rotation = 0;
let crop = null; // {x,y,w,h} in image space
let sourcePath = null;
let dirty = false;

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

function showPanelEl(el) {
  if (!el) return;
  // Drop .hidden entirely so theme.css `.hidden { display:none !important }` cannot win
  el.className = el.id === "html-visual" ? "html-visual" : "media-editor";
  el.removeAttribute("hidden");
  el.style.setProperty("display", "flex", "important");
  el.style.setProperty("position", "fixed", "important");
  el.style.setProperty("left", "24px", "important");
  el.style.setProperty("right", "24px", "important");
  el.style.setProperty("top", "24px", "important");
  el.style.setProperty("bottom", "24px", "important");
  el.style.setProperty("z-index", "99999", "important");
  el.style.setProperty("visibility", "visible", "important");
  el.style.setProperty("opacity", "1", "important");
  el.style.setProperty("pointer-events", "auto", "important");
  el.style.setProperty("flex-direction", "column", "important");
  el.style.setProperty("background", "#0a0a0f", "important");
  el.style.setProperty("overflow", "hidden", "important");
  el.style.setProperty("border", "1px solid #444", "important");
  el.style.setProperty("border-radius", "6px", "important");
}

function hidePanelEl(el) {
  if (!el) return;
  el.className = (el.id === "html-visual" ? "html-visual" : "media-editor") + " hidden";
  el.style.setProperty("display", "none", "important");
  el.style.setProperty("visibility", "hidden", "important");
  el.style.setProperty("pointer-events", "none", "important");
}

export function openMediaEditor(path) {
  try {
    sourcePath = path || null;
    ensurePanel();
    showPanelEl(panel);
    if (path) {
      loadFromPath(path).catch((e) => {
        console.error(e);
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
}

function ensurePanel() {
  if (panel && document.body.contains(panel)) {
    canvas = panel.querySelector("#me-canvas");
    ctx = canvas ? canvas.getContext("2d") : null;
    return;
  }
  panel = document.createElement("div");
  panel.id = "media-editor";
  panel.className = "media-editor";
  panel.innerHTML = `
    <div class="me-header">
      <span class="me-title">Media / Meme Editor</span>
      <div class="me-header-actions">
        <button type="button" class="btn small" id="me-fs" title="Fullscreen">⛶</button>
        <button type="button" class="btn small ghost" id="me-close">✕</button>
      </div>
    </div>
    <div class="me-body">
      <div class="me-toolbar">
        <button type="button" class="btn small" id="me-load">Load</button>
        <button type="button" class="btn small" id="me-url">+ URL</button>
        <button type="button" class="btn small" id="me-text">+ Text</button>
        <button type="button" class="btn small" id="me-svg">+ SVG</button>
        <button type="button" class="btn small" id="me-rotate">↻</button>
        <button type="button" class="btn small" id="me-crop">Crop</button>
        <span class="me-sep">|</span>
        <button type="button" class="btn small" id="me-tool-pen" title="Pen">✏️</button>
        <button type="button" class="btn small" id="me-tool-marker" title="Marker">▮</button>
        <button type="button" class="btn small" id="me-tool-eraser" title="Eraser">⌫</button>
        <button type="button" class="btn small" id="me-tool-line" title="Line">／</button>
        <button type="button" class="btn small" id="me-tool-rect" title="Rect">▭</button>
        <button type="button" class="btn small" id="me-tool-ellipse" title="Ellipse">◯</button>
        <button type="button" class="btn small" id="me-tool-arrow" title="Arrow">→</button>
        <input type="color" id="me-draw-color" value="#00f3ff" title="Stroke" />
        <input type="range" id="me-draw-size" min="1" max="64" value="4" title="Size" style="width:72px" />
        <button type="button" class="btn small primary" id="me-export">Export PNG</button>
        <button type="button" class="btn small" id="me-export-jpg">JPG</button>
        <button type="button" class="btn small" id="me-save-vfs">Save to VFS</button>
      </div>
      <div class="me-workspace">
        <div class="me-canvas-wrap">
          <canvas id="me-canvas" width="800" height="600"></canvas>
        </div>
        <div class="me-props">
          <h4>Layer props</h4>
          <label>Text</label>
          <input type="text" id="me-prop-text" placeholder="Meme text" />
          <label>Font</label>
          <select id="me-prop-font"></select>
          <label>Size</label>
          <input type="number" id="me-prop-size" value="48" min="8" max="400" />
          <label>Color</label>
          <input type="color" id="me-prop-color" value="#ffffff" />
          <label>Outline</label>
          <input type="color" id="me-prop-stroke" value="#000000" />
          <label>Background</label>
          <input type="color" id="me-prop-bg" value="#000000" />
          <label><input type="checkbox" id="me-prop-bg-on" /> Fill bg behind text</label>
          <label>X</label>
          <input type="number" id="me-prop-x" value="40" />
          <label>Y</label>
          <input type="number" id="me-prop-y" value="60" />
          <div class="me-layer-list" id="me-layers"></div>
          <button type="button" class="btn small ghost" id="me-del-layer">Delete layer</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  canvas = panel.querySelector("#me-canvas");
  ctx = canvas.getContext("2d");

  const fontSel = panel.querySelector("#me-prop-font");
  FONTS.forEach((f) => {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f.split(",")[0];
    fontSel.appendChild(o);
  });

  panel.querySelector("#me-close").onclick = () => closeMediaEditor();
  panel.querySelector("#me-fs").onclick = () => {
    if (!document.fullscreenElement) panel.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  panel.querySelector("#me-load").onclick = async () => {
    const p = window.__n3xnActivePath || prompt("VFS path to load:");
    if (p) await loadFromPath(p);
  };
  panel.querySelector("#me-url").onclick = () => insertFromUrl();
  panel.querySelector("#me-text").onclick = () => addTextLayer("TOP TEXT");
  panel.querySelector("#me-svg").onclick = () => insertSvg();
  panel.querySelector("#me-rotate").onclick = () => {
    rotation = (rotation + 90) % 360;
    redraw();
  };
  panel.querySelector("#me-crop").onclick = () => startCrop();
  panel.querySelector("#me-export").onclick = () => exportImage("image/png");
  panel.querySelector("#me-export-jpg").onclick = () => exportImage("image/jpeg");
  panel.querySelector("#me-save-vfs").onclick = () => saveToVfs();
  panel.querySelector("#me-del-layer").onclick = () => {
    if (selectedLayer >= 0) {
      layers.splice(selectedLayer, 1);
      selectedLayer = -1;
      redraw();
      renderLayerList();
    }
  };

  ["me-prop-text", "me-prop-font", "me-prop-size", "me-prop-color", "me-prop-stroke", "me-prop-bg", "me-prop-bg-on", "me-prop-x", "me-prop-y"].forEach((id) => {
    const el = panel.querySelector("#" + id);
    if (!el) return;
    el.addEventListener("input", applyPropsToSelected);
    el.addEventListener("change", applyPropsToSelected);
  });


  // ---- Draw tools (mouse + multi-touch) ----
  let drawTool = "none"; // pen|marker|eraser|line|rect|ellipse|arrow
  let drawing = false;
  let drawStart = null;
  let strokePts = [];
  let snapshot = null;

  function setDrawTool(t) {
    drawTool = t;
    ["pen","marker","eraser","line","rect","ellipse","arrow"].forEach((name) => {
      const b = panel.querySelector("#me-tool-" + name);
      if (b) b.classList.toggle("primary", drawTool === name);
    });
    canvas.style.cursor = drawTool === "none" ? "default" : "crosshair";
  }
  panel.querySelector("#me-tool-pen").onclick = () => setDrawTool(drawTool === "pen" ? "none" : "pen");
  panel.querySelector("#me-tool-marker").onclick = () => setDrawTool(drawTool === "marker" ? "none" : "marker");
  panel.querySelector("#me-tool-eraser").onclick = () => setDrawTool(drawTool === "eraser" ? "none" : "eraser");
  panel.querySelector("#me-tool-line").onclick = () => setDrawTool(drawTool === "line" ? "none" : "line");
  panel.querySelector("#me-tool-rect").onclick = () => setDrawTool(drawTool === "rect" ? "none" : "rect");
  panel.querySelector("#me-tool-ellipse").onclick = () => setDrawTool(drawTool === "ellipse" ? "none" : "ellipse");
  panel.querySelector("#me-tool-arrow").onclick = () => setDrawTool(drawTool === "arrow" ? "none" : "arrow");

  function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    if (!src) return null;
    return {
      x: ((src.clientX - rect.left) / rect.width) * canvas.width,
      y: ((src.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function strokeStyle() {
    const color = panel.querySelector("#me-draw-color")?.value || "#00f3ff";
    const size = Number(panel.querySelector("#me-draw-size")?.value || 4);
    return { color, size };
  }

  function beginDraw(e) {
    if (drawTool === "none") return false;
    e.preventDefault();
    const p = canvasXY(e);
    if (!p) return true;
    drawing = true;
    drawStart = p;
    strokePts = [p];
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return true;
  }

  function moveDraw(e) {
    if (!drawing || drawTool === "none") return false;
    e.preventDefault();
    const p = canvasXY(e);
    if (!p) return true;
    const { color, size } = strokeStyle();
    if (drawTool === "pen" || drawTool === "marker" || drawTool === "eraser") {
      const prev = strokePts[strokePts.length - 1];
      strokePts.push(p);
      ctx.save();
      if (drawTool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = color;
        ctx.globalAlpha = drawTool === "marker" ? 0.35 : 1;
      }
      ctx.lineWidth = drawTool === "marker" ? size * 3 : size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    } else {
      // shape preview
      ctx.putImageData(snapshot, 0, 0);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      const x0 = drawStart.x, y0 = drawStart.y;
      if (drawTool === "line" || drawTool === "arrow") {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        if (drawTool === "arrow") {
          const ang = Math.atan2(p.y - y0, p.x - x0);
          const head = 10 + size * 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - head * Math.cos(ang - 0.4), p.y - head * Math.sin(ang - 0.4));
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - head * Math.cos(ang + 0.4), p.y - head * Math.sin(ang + 0.4));
          ctx.stroke();
        }
      } else if (drawTool === "rect") {
        ctx.strokeRect(x0, y0, p.x - x0, p.y - y0);
      } else if (drawTool === "ellipse") {
        ctx.beginPath();
        ctx.ellipse((x0 + p.x) / 2, (y0 + p.y) / 2, Math.abs(p.x - x0) / 2, Math.abs(p.y - y0) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    return true;
  }

  function endDraw(e) {
    if (!drawing) return;
    drawing = false;
    snapshot = null;
    // bake freehand into base by leaving pixels; for shapes already stroked
    strokePts = [];
  }

  canvas.addEventListener("mousedown", (e) => { if (beginDraw(e)) e.stopPropagation(); });
  canvas.addEventListener("mousemove", (e) => { moveDraw(e); });
  window.addEventListener("mouseup", endDraw);
  canvas.addEventListener("touchstart", (e) => { if (beginDraw(e)) e.stopPropagation(); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { moveDraw(e); }, { passive: false });
  canvas.addEventListener("touchend", endDraw);
  canvas.addEventListener("touchcancel", endDraw);


  // Drag layers
  let drag = null;
  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    // hit test layers reverse
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (L.type === "text") {
        const w = ctx.measureText(L.text).width + 20;
        const h = L.size + 10;
        if (x >= L.x - 10 && x <= L.x + w && y >= L.y - L.size && y <= L.y + 10) {
          selectedLayer = i;
          drag = { i, ox: x - L.x, oy: y - L.y };
          fillProps(L);
          renderLayerList();
          return;
        }
      }
    }
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    layers[drag.i].x = x - drag.ox;
    layers[drag.i].y = y - drag.oy;
    document.getElementById("me-prop-x").value = Math.round(layers[drag.i].x);
    document.getElementById("me-prop-y").value = Math.round(layers[drag.i].y);
    redraw();
  });
  window.addEventListener("mouseup", () => { drag = null; });
}

function resetCanvas(w, h) {
  canvas.width = w;
  canvas.height = h;
  baseImage = null;
  layers = [];
  rotation = 0;
  crop = null;
  redraw();
  renderLayerList();
}

async function loadFromPath(path) {
  sourcePath = path;
  const f = await fs.readFile(path);
  if (!f) throw new Error("Not found");
  const mime = f.mime || "image/png";
  const blob = new Blob([f.content], { type: mime });
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
      crop = null;
      redraw();
      resolve();
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
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
    x: 40,
    y: 60 + layers.length * 50,
  };
  layers.push(L);
  selectedLayer = layers.length - 1;
  fillProps(L);
  redraw();
  renderLayerList();
}

function fillProps(L) {
  if (!L || L.type !== "text") return;
  document.getElementById("me-prop-text").value = L.text;
  document.getElementById("me-prop-font").value = L.font;
  document.getElementById("me-prop-size").value = L.size;
  document.getElementById("me-prop-color").value = L.color;
  document.getElementById("me-prop-stroke").value = L.stroke;
  document.getElementById("me-prop-bg").value = L.bg;
  document.getElementById("me-prop-bg-on").checked = !!L.bgOn;
  document.getElementById("me-prop-x").value = Math.round(L.x);
  document.getElementById("me-prop-y").value = Math.round(L.y);
}

function applyPropsToSelected() {
  if (selectedLayer < 0 || !layers[selectedLayer] || layers[selectedLayer].type !== "text") return;
  const L = layers[selectedLayer];
  L.text = document.getElementById("me-prop-text").value;
  L.font = document.getElementById("me-prop-font").value;
  L.size = +document.getElementById("me-prop-size").value || 48;
  L.color = document.getElementById("me-prop-color").value;
  L.stroke = document.getElementById("me-prop-stroke").value;
  L.bg = document.getElementById("me-prop-bg").value;
  L.bgOn = document.getElementById("me-prop-bg-on").checked;
  L.x = +document.getElementById("me-prop-x").value || 0;
  L.y = +document.getElementById("me-prop-y").value || 0;
  dirty = true;
  redraw();
}

function renderLayerList() {
  const el = document.getElementById("me-layers");
  el.innerHTML = layers
    .map(
      (L, i) =>
        `<div class="me-layer ${i === selectedLayer ? "active" : ""}" data-i="${i}">${
          L.type === "text" ? "T: " + (L.text || "").slice(0, 24) : "IMG"
        }</div>`
    )
    .join("");
  el.querySelectorAll(".me-layer").forEach((node) => {
    node.onclick = () => {
      selectedLayer = +node.dataset.i;
      fillProps(layers[selectedLayer]);
      renderLayerList();
    };
  });
}

function redraw() {
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);

  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);

  if (baseImage) {
    if (crop) {
      ctx.drawImage(baseImage, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
    } else {
      ctx.drawImage(baseImage, 0, 0, w, h);
    }
  }

  // layers drawn in unrotated screen space relative to canvas after rotation transform
  // For simplicity, text follows rotation with image
  layers.forEach((L) => {
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
    }
  });

  ctx.restore();
}

async function insertFromUrl() {
  const url = prompt("Image / GIF URL:");
  if (!url) return;
  try {
    if (!baseImage) {
      await loadImageUrl(url);
    } else {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      layers.push({
        type: "image",
        img,
        x: 20,
        y: 20,
        w: Math.min(img.width, canvas.width / 2),
        h: Math.min(img.height, canvas.height / 2),
      });
      redraw();
      renderLayerList();
    }
  } catch {
    alert("Could not load URL (CORS may block it). Try downloading into VFS first.");
  }
}

async function insertSvg() {
  const code = prompt("Paste SVG markup:");
  if (!code) return;
  const blob = new Blob([code], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    if (!baseImage) await loadImageUrl(url);
    else {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      layers.push({ type: "image", img, x: 20, y: 20, w: img.width, h: img.height });
      redraw();
      renderLayerList();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function startCrop() {
  const x = +prompt("Crop X", "0");
  const y = +prompt("Crop Y", "0");
  const w = +prompt("Crop width", String(canvas.width));
  const h = +prompt("Crop height", String(canvas.height));
  if ([x, y, w, h].some((n) => Number.isNaN(n))) return;
  // Bake current canvas then set as new base
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  const img = new Image();
  img.onload = () => {
    baseImage = img;
    canvas.width = w;
    canvas.height = h;
    layers = [];
    rotation = 0;
    crop = null;
    redraw();
    renderLayerList();
  };
  img.src = tmp.toDataURL("image/png");
}

function exportImage(mime) {
  const url = canvas.toDataURL(mime, 0.92);
  const a = document.createElement("a");
  a.href = url;
  a.download = `n3xn-meme-${Date.now()}.${mime.includes("jpeg") ? "jpg" : "png"}`;
  a.click();
  // also register as blob message
  canvas.toBlob((blob) => {
    if (!blob) return;
    const burl = URL.createObjectURL(blob);
    const el = document.getElementById("terminal-output");
    if (el) {
      const line = document.createElement("div");
      line.className = "ok";
      line.innerHTML = `[meme export] <a href="${burl}" target="_blank" style="color:#8cf">${burl}</a>`;
      el.appendChild(line);
    }
  }, mime);
}

async function saveToVfs() {
  const name = prompt("Save as path:", sourcePath || `/memes/meme-${Date.now()}.png`);
  if (!name) return;
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  const buf = await blob.arrayBuffer();
  // ensure parent dirs
  const parts = name.split("/").filter(Boolean);
  parts.pop();
  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    if (!fs.exists(cur)) await fs.mkdir(cur);
  }
  await fs.writeFile(name, new Uint8Array(buf), { mime: "image/png" });
  if (window.refreshTree) window.refreshTree();
  alert("Saved " + name);
}

/* ========== Simple audio / video panel ========== */
export function openAVEditor(path, kind) {
  ensurePanel();
  showPanelEl(panel);
  const wrap = panel.querySelector(".me-canvas-wrap");
  if (!wrap) return;
  wrap.innerHTML = "";
  const media = document.createElement(kind === "audio" ? "audio" : "video");
  media.controls = true;
  media.style.maxWidth = "100%";
  media.style.maxHeight = "70vh";
  (async () => {
    const f = await fs.readFile(path);
    const blob = new Blob([f.content], { type: f.mime || (kind === "audio" ? "audio/mpeg" : "video/mp4") });
    media.src = URL.createObjectURL(blob);
    wrap.appendChild(media);
    const tools = document.createElement("div");
    tools.style.padding = "8px";
    tools.innerHTML = `
      <p style="color:#888;font-size:12px">Playback + export blob. Trim: set start/end (seconds) then Export clip (video/audio copy via MediaRecorder when possible).</p>
      <label>Start <input type="number" id="av-start" value="0" step="0.1" style="width:80px"/></label>
      <label>End <input type="number" id="av-end" value="0" step="0.1" style="width:80px"/></label>
      <button class="btn small" id="av-blob">Open as blob</button>
    `;
    wrap.appendChild(tools);
    document.getElementById("av-blob").onclick = () => {
      const url = media.src;
      const el = document.getElementById("terminal-output");
      if (el) {
        const line = document.createElement("div");
        line.className = "ok";
        line.innerHTML = `[av] ${path} <a href="${url}" target="_blank" style="color:#8cf">${url}</a>`;
        el.appendChild(line);
      }
      window.open(url, "_blank");
    };
  })();
}
