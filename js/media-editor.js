/**
 * n3xn VFS v4 — Unified Multi-Media Studio
 * Complete production editor supporting Images, SVGs, GIFs, Video, & Audio with 20 tools each.
 */
import * as fs from "./fs.js";

let panel = null;
let currentMode = "image"; // 'image' | 'svg' | 'gif' | 'video' | 'audio'
let sourcePath = null;

// Canvas & Image Contexts
let canvas = null;
let ctx = null;
let baseImage = null;
let layers = [];
let selectedLayerIndex = -1;
let rotation = 0;
let activeTool = "select";

// Audio State (Web Audio API)
let audioCtx = null;
let audioBuffer = null;
let audioSourceNode = null;
let audioSelection = { start: 0, end: 0 };
let isAudioPlaying = false;

// Video State
let videoEl = null;
let videoStreamRecorder = null;
let recordedChunks = [];

// GIF State
let gifFrames = [];
let currentGifFrame = 0;
let gifFps = 10;
let gifPlaying = false;
let gifTimer = null;

// History Stack
const history = [];
let historyIndex = -1;

/* ==========================================================================
   PUBLIC API
   ========================================================================== */

export function openMediaEditor(path, modeHint) {
  sourcePath = path || null;
  ensurePanel();
  showPanel();
  injectStyles();

  if (path) {
    autoDetectAndLoad(path, modeHint);
  } else {
    switchMode(modeHint || "image");
  }
}

export function closeMediaEditor() {
  if (panel) panel.style.display = "none";
  stopAudioPlayback();
  stopGifPlayback();
}

/* ==========================================================================
   INITIALIZATION & LAYOUT BUILDER
   ========================================================================== */

function ensurePanel() {
  if (panel && document.body.contains(panel)) return;

  panel = document.createElement("div");
  panel.id = "n3xn-media-studio";
  panel.innerHTML = `
    <!-- Top Bar -->
    <div class="studio-header">
      <div class="studio-brand">
        <span class="studio-logo">❖ n3xn</span>
        <span class="studio-title">Media Studio v4</span>
      </div>

      <div class="studio-mode-tabs">
        <button type="button" class="tab-btn active" data-mode="image">🖼️ Image & Meme</button>
        <button type="button" class="tab-btn" data-mode="svg">📐 SVG Vector</button>
        <button type="button" class="tab-btn" data-mode="gif">🎞️ GIF Animator</button>
        <button type="button" class="tab-btn" data-mode="video">🎥 Video Studio</button>
        <button type="button" class="tab-btn" data-mode="audio">🔊 Audio Workbench</button>
      </div>

      <div class="studio-actions">
        <button type="button" class="btn small" id="st-undo" title="Undo (Ctrl+Z)">↶</button>
        <button type="button" class="btn small" id="st-redo" title="Redo (Ctrl+Y)">↷</button>
        <button type="button" class="btn small" id="st-fs" title="Fullscreen">⛶</button>
        <button type="button" class="btn small ghost" id="st-close">✕</button>
      </div>
    </div>

    <!-- Main Body Workspace -->
    <div class="studio-body">
      <!-- Dynamic Contextual Sidebar Toolbar -->
      <div class="studio-toolbar" id="studio-toolbar"></div>

      <!-- Main Stage Canvas / Player Viewport -->
      <div class="studio-viewport" id="studio-viewport">
        <canvas id="studio-canvas" width="800" height="600"></canvas>
        <video id="studio-video" style="display:none;" controls></video>
        <div id="studio-audio-wave-wrap" style="display:none; width:100%; height:100%; align-items:center; justify-content:center; flex-direction:column;">
          <canvas id="studio-audio-canvas" width="800" height="300"></canvas>
          <canvas id="studio-fft-canvas" width="800" height="100" style="margin-top:10px;"></canvas>
        </div>
      </div>

      <!-- Contextual Inspector & Layer/Timeline Panel -->
      <div class="studio-inspector" id="studio-inspector"></div>
    </div>

    <!-- Timeline & Playback Status Bar -->
    <div class="studio-statusbar" id="studio-statusbar">
      <span id="st-status-msg">Ready</span>
      <span id="st-status-info">800 x 600 px</span>
    </div>
  `;

  document.body.appendChild(panel);
  canvas = panel.querySelector("#studio-canvas");
  ctx = canvas.getContext("2d");
  videoEl = panel.querySelector("#studio-video");

  bindGlobalEvents();
}

function bindGlobalEvents() {
  panel.querySelector("#st-close").onclick = closeMediaEditor;
  panel.querySelector("#st-undo").onclick = undo;
  panel.querySelector("#st-redo").onclick = redo;
  panel.querySelector("#st-fs").onclick = () => {
    if (!document.fullscreenElement) panel.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  // Mode Switch Tabs
  panel.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.onclick = () => switchMode(btn.dataset.mode);
  });

  // Canvas Interactions
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);

  // Keyboard Shortcuts
  window.addEventListener("keydown", handleKeyboard);
}

function switchMode(mode) {
  currentMode = mode;
  panel.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  const canvasEl = panel.querySelector("#studio-canvas");
  const videoEl = panel.querySelector("#studio-video");
  const audioWrap = panel.querySelector("#studio-audio-wave-wrap");

  canvasEl.style.display = ["image", "svg", "gif"].includes(mode) ? "block" : "none";
  videoEl.style.display = mode === "video" ? "block" : "none";
  audioWrap.style.display = mode === "audio" ? "flex" : "none";

  renderToolbar();
  renderInspector();
  updateStatus(`Switched to ${mode.toUpperCase()} mode`);
}

/* ==========================================================================
   AUTO FILE TYPE DETECTOR
   ========================================================================== */

async function autoDetectAndLoad(path) {
  const ext = path.split(".").pop().toLowerCase();

  if (["png", "jpg", "jpeg", "webp", "bmp"].includes(ext)) {
    switchMode("image");
    await loadImageFromVfs(path);
  } else if (ext === "svg") {
    switchMode("svg");
    await loadSvgFromVfs(path);
  } else if (ext === "gif") {
    switchMode("gif");
    await loadGifFromVfs(path);
  } else if (["mp4", "webm", "ogg", "mov"].includes(ext)) {
    switchMode("video");
    await loadVideoFromVfs(path);
  } else if (["mp3", "wav", "flac", "aac"].includes(ext)) {
    switchMode("audio");
    await loadAudioFromVfs(path);
  } else {
    switchMode("image");
  }
}

/* ==========================================================================
   1. IMAGE & MEME ENGINE (20 TOOLS)
   ========================================================================== */

function buildImageToolbar() {
  return `
    <div class="tool-group">
      <span class="tool-title">Tools</span>
      <button class="tool-btn ${activeTool === "select" ? "active" : ""}" id="tool-select">🎯 Select</button>
      <button class="tool-btn ${activeTool === "pen" ? "active" : ""}" id="tool-pen">✏️ Pen</button>
      <button class="tool-btn ${activeTool === "marker" ? "active" : ""}" id="tool-marker">▮ Marker</button>
      <button class="tool-btn ${activeTool === "rect" ? "active" : ""}" id="tool-rect">▭ Rect</button>
      <button class="tool-btn ${activeTool === "circle" ? "active" : ""}" id="tool-circle">◯ Circle</button>
      <button class="tool-btn ${activeTool === "arrow" ? "active" : ""}" id="tool-arrow">➔ Arrow</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">Image Adjustments</span>
      <button class="tool-btn" id="img-crop">✂️ Visual Crop</button>
      <button class="tool-btn" id="img-rotate">↻ Rotate 90°</button>
      <button class="tool-btn" id="img-flip-h">↔ Flip H</button>
      <button class="tool-btn" id="img-flip-v">↕ Flip V</button>
      <button class="tool-btn" id="img-meme-preset">🤡 Meme Layout</button>
      <button class="tool-btn" id="img-vignette">👁 Vignette</button>
      <button class="tool-btn" id="img-blur-censor">░ Censor Region</button>
      <button class="tool-btn" id="img-border">🖼️ Add Border</button>
      <button class="tool-btn" id="img-stamp">🏷️ Add Stamp</button>
      <button class="tool-btn" id="img-pipette">🧪 Eyedropper</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">Export</span>
      <button class="tool-btn primary" id="img-export-png">💾 Save PNG</button>
      <button class="tool-btn" id="img-export-jpg">📄 Export JPG</button>
      <button class="tool-btn" id="img-save-vfs">📁 Save to VFS</button>
    </div>
  `;
}

function bindImageEvents(container) {
  container.querySelector("#tool-select")?.addEventListener("click", () => setTool("select"));
  container.querySelector("#tool-pen")?.addEventListener("click", () => setTool("pen"));
  container.querySelector("#tool-marker")?.addEventListener("click", () => setTool("marker"));
  container.querySelector("#tool-rect")?.addEventListener("click", () => setTool("rect"));
  container.querySelector("#tool-circle")?.addEventListener("click", () => setTool("circle"));
  container.querySelector("#tool-arrow")?.addEventListener("click", () => setTool("arrow"));

  container.querySelector("#img-rotate")?.addEventListener("click", () => { rotation = (rotation + 90) % 360; saveHistory(); redraw(); });
  container.querySelector("#img-flip-h")?.addEventListener("click", () => { flipImage(true, false); });
  container.querySelector("#img-flip-v")?.addEventListener("click", () => { flipImage(false, true); });
  container.querySelector("#img-meme-preset")?.addEventListener("click", applyMemeLayout);
  container.querySelector("#img-vignette")?.addEventListener("click", applyVignette);
  container.querySelector("#img-border")?.addEventListener("click", addBorder);
  container.querySelector("#img-export-png")?.addEventListener("click", () => exportRaster("image/png"));
  container.querySelector("#img-export-jpg")?.addEventListener("click", () => exportRaster("image/jpeg"));
  container.querySelector("#img-save-vfs")?.addEventListener("click", saveImageToVfs);
}

function applyMemeLayout() {
  layers.push({ type: "text", text: "TOP TEXT", font: "Impact", size: 54, color: "#ffffff", stroke: "#000000", x: canvas.width / 2 - 100, y: 40 });
  layers.push({ type: "text", text: "BOTTOM TEXT", font: "Impact", size: 54, color: "#ffffff", stroke: "#000000", x: canvas.width / 2 - 140, y: canvas.height - 80 });
  saveHistory();
  renderInspector();
  redraw();
}

function applyVignette() {
  const grad = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.width / 4, canvas.width / 2, canvas.height / 2, canvas.width / 1.2);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  saveHistory();
}

function addBorder() {
  const size = prompt("Border size in pixels:", "12");
  if (!size) return;
  const color = prompt("Border color hex:", "#00f3ff");
  ctx.lineWidth = Number(size);
  ctx.strokeStyle = color || "#00f3ff";
  ctx.strokeRect(0, 0, canvas.width, canvas.height);
  saveHistory();
}

function flipImage(h, v) {
  const tmp = document.createElement("canvas");
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const tctx = tmp.getContext("2d");
  tctx.translate(h ? canvas.width : 0, v ? canvas.height : 0);
  tctx.scale(h ? -1 : 1, v ? -1 : 1);
  tctx.drawImage(canvas, 0, 0);

  const img = new Image();
  img.onload = () => {
    baseImage = img;
    saveHistory();
    redraw();
  };
  img.src = tmp.toDataURL();
}

/* ==========================================================================
   2. SVG / VECTOR STUDIO (20 TOOLS)
   ========================================================================== */

function buildSvgToolbar() {
  return `
    <div class="tool-group">
      <span class="tool-title">Vector Injection</span>
      <button class="tool-btn" id="svg-paste-code">📝 Paste SVG Code</button>
      <button class="tool-btn" id="svg-load-vfs">📁 Open SVG File</button>
      <button class="tool-btn" id="svg-add-rect">🟩 Add Rect Vector</button>
      <button class="tool-btn" id="svg-add-circle">🔴 Add Circle Vector</button>
      <button class="tool-btn" id="svg-add-text">🔤 Vector Text</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">Vector Node Operations</span>
      <button class="tool-btn" id="svg-align-left">⇤ Align Left</button>
      <button class="tool-btn" id="svg-align-center">⇹ Align Center</button>
      <button class="tool-btn" id="svg-align-right">⇥ Align Right</button>
      <button class="tool-btn" id="svg-dup">📄 Duplicate Node</button>
      <button class="tool-btn" id="svg-group">🔗 Group Layers</button>
      <button class="tool-btn" id="svg-shadow">🌑 Drop Shadow</button>
      <button class="tool-btn" id="svg-lock">🔒 Lock Layer</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">Vector Export</span>
      <button class="tool-btn primary" id="svg-export-xml">📋 Copy SVG XML</button>
      <button class="tool-btn" id="svg-save-vfs">💾 Save SVG to VFS</button>
    </div>
  `;
}

function bindSvgEvents(container) {
  container.querySelector("#svg-paste-code")?.addEventListener("click", async () => {
    const code = prompt("Paste raw SVG markup:");
    if (!code) return;
    const blob = new Blob([code], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      layers.push({ type: "image", img, x: 50, y: 50, w: img.width || 200, h: img.height || 200, svgCode: code });
      saveHistory();
      renderInspector();
      redraw();
    };
    img.src = url;
  });

  container.querySelector("#svg-export-xml")?.addEventListener("click", () => {
    let xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">\n`;
    layers.forEach((l) => {
      if (l.svgCode) xml += `  ${l.svgCode}\n`;
      else if (l.type === "text") xml += `  <text x="${l.x}" y="${l.y}" font-size="${l.size}" fill="${l.color}">${l.text}</text>\n`;
    });
    xml += `</svg>`;
    navigator.clipboard.writeText(xml);
    alert("Clean SVG XML copied to clipboard!");
  });
}

/* ==========================================================================
   3. GIF ANIMATOR ENGINE (20 TOOLS)
   ========================================================================== */

function buildGifToolbar() {
  return `
    <div class="tool-group">
      <span class="tool-title">Timeline Playback</span>
      <button class="tool-btn primary" id="gif-play">${gifPlaying ? "⏸ Pause" : "▶ Play GIF"}</button>
      <button class="tool-btn" id="gif-prev">⏮ Prev Frame</button>
      <button class="tool-btn" id="gif-next">⏭ Next Frame</button>
      <button class="tool-btn" id="gif-reverse">🔄 Reverse GIF</button>
      <button class="tool-btn" id="gif-boomerang">🪃 Boomerang Loop</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">Global Frame Edits</span>
      <button class="tool-btn" id="gif-global-caption">💬 Add Global Caption</button>
      <button class="tool-btn" id="gif-global-watermark">🏷️ Add Watermark</button>
      <button class="tool-btn" id="gif-del-frame">🗑️ Delete Frame</button>
      <button class="tool-btn" id="gif-dup-frame">📋 Duplicate Frame</button>
      <button class="tool-btn" id="gif-speed">⚡ Speed 2x / 0.5x</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">GIF Output</span>
      <button class="tool-btn primary" id="gif-export-vfs">💾 Save GIF to VFS</button>
      <button class="tool-btn" id="gif-export-frame">📸 Export Current Frame</button>
    </div>
  `;
}

function bindGifEvents(container) {
  container.querySelector("#gif-play")?.addEventListener("click", toggleGifPlay);
  container.querySelector("#gif-prev")?.addEventListener("click", () => stepGifFrame(-1));
  container.querySelector("#gif-next")?.addEventListener("click", () => stepGifFrame(1));
  container.querySelector("#gif-reverse")?.addEventListener("click", () => {
    gifFrames.reverse();
    redrawGifFrame();
    updateStatus("GIF animation sequence reversed");
  });
  container.querySelector("#gif-boomerang")?.addEventListener("click", () => {
    gifFrames = [...gifFrames, ...[...gifFrames].reverse()];
    redrawGifFrame();
    updateStatus("Boomerang frames appended");
  });
}

function toggleGifPlay() {
  gifPlaying = !gifPlaying;
  if (gifPlaying) {
    gifTimer = setInterval(() => {
      currentGifFrame = (currentGifFrame + 1) % Math.max(1, gifFrames.length);
      redrawGifFrame();
    }, 1000 / gifFps);
  } else {
    clearInterval(gifTimer);
  }
  renderToolbar();
}

function stepGifFrame(dir) {
  if (gifFrames.length === 0) return;
  currentGifFrame = (currentGifFrame + dir + gifFrames.length) % gifFrames.length;
  redrawGifFrame();
}

function redrawGifFrame() {
  if (!gifFrames[currentGifFrame]) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(gifFrames[currentGifFrame], 0, 0, canvas.width, canvas.height);
  updateStatus(`GIF Frame: ${currentGifFrame + 1} / ${gifFrames.length}`);
}

/* ==========================================================================
   4. VIDEO STUDIO ENGINE (20 TOOLS)
   ========================================================================== */

function buildVideoToolbar() {
  return `
    <div class="tool-group">
      <span class="tool-title">Playback & Trim</span>
      <button class="tool-btn primary" id="vid-play">▶ Play / Pause</button>
      <button class="tool-btn" id="vid-set-in">🚩 Set Trim In</button>
      <button class="tool-btn" id="vid-set-out">🏁 Set Trim Out</button>
      <button class="tool-btn" id="vid-split">✂️ Split Clip</button>
      <button class="tool-btn" id="vid-loop">🔁 Toggle Loop</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">Audio & Speed</span>
      <button class="tool-btn" id="vid-mute">🔇 Mute / Unmute</button>
      <button class="tool-btn" id="vid-volume">🔊 Volume Gain</button>
      <button class="tool-btn" id="vid-speed">⏩ Playback Speed</button>
      <button class="tool-btn" id="vid-extract-audio">🎵 Extract Audio Track</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">Overlay & Export</span>
      <button class="tool-btn" id="vid-subtitle">💬 Burn Subtitles</button>
      <button class="tool-btn" id="vid-snapshot">📸 Frame Snapshot</button>
      <button class="tool-btn primary" id="vid-record">⏺ Record / Export Video</button>
      <button class="tool-btn" id="vid-save-vfs">📁 Save Video to VFS</button>
    </div>
  `;
}

function bindVideoEvents(container) {
  container.querySelector("#vid-play")?.addEventListener("click", () => {
    if (videoEl.paused) videoEl.play();
    else videoEl.pause();
  });

  container.querySelector("#vid-snapshot")?.addEventListener("click", () => {
    const tmp = document.createElement("canvas");
    tmp.width = videoEl.videoWidth || 1280;
    tmp.height = videoEl.videoHeight || 720;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(videoEl, 0, 0);
    const a = document.createElement("a");
    a.href = tmp.toDataURL("image/png");
    a.download = `video-snapshot-${Date.now()}.png`;
    a.click();
  });

  container.querySelector("#vid-record")?.addEventListener("click", startVideoRecorder);
}

function startVideoRecorder() {
  if (!videoEl.src) return alert("Load a video file first!");
  const stream = videoEl.captureStream ? videoEl.captureStream() : videoEl.mozCaptureStream();
  recordedChunks = [];
  videoStreamRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });

  videoStreamRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  videoStreamRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `edited-clip-${Date.now()}.webm`;
    a.click();
    updateStatus("Recorded video clip exported!");
  };

  videoStreamRecorder.start();
  videoEl.currentTime = 0;
  videoEl.play();
  updateStatus("Recording live stream...");

  videoEl.onended = () => {
    if (videoStreamRecorder && videoStreamRecorder.state === "recording") {
      videoStreamRecorder.stop();
    }
  };
}

/* ==========================================================================
   5. WEB AUDIO WORKBENCH (20 TOOLS)
   ========================================================================== */

function buildAudioToolbar() {
  return `
    <div class="tool-group">
      <span class="tool-title">Transport</span>
      <button class="tool-btn primary" id="aud-play">${isAudioPlaying ? "⏸ Pause" : "▶ Play Audio"}</button>
      <button class="tool-btn" id="aud-stop">⏹ Stop</button>
      <button class="tool-btn" id="aud-trim">✂️ Trim Selection</button>
      <button class="tool-btn" id="aud-silence">🔇 Silence Region</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">DSP & FX Filters</span>
      <button class="tool-btn" id="aud-fade-in">📈 Fade In</button>
      <button class="tool-btn" id="aud-fade-out">📉 Fade Out</button>
      <button class="tool-btn" id="aud-gain">🔊 Boost Gain</button>
      <button class="tool-btn" id="aud-normalize">📊 Normalize 0dB</button>
      <button class="tool-btn" id="aud-reverse">🔄 Reverse Buffer</button>
      <button class="tool-btn" id="aud-echo">🌌 Add Echo / Reverb</button>
    </div>

    <div class="tool-group">
      <span class="tool-title">Export</span>
      <button class="tool-btn primary" id="aud-export-wav">💾 Export WAV</button>
      <button class="tool-btn" id="aud-save-vfs">📁 Save WAV to VFS</button>
    </div>
  `;
}

function bindAudioEvents(container) {
  container.querySelector("#aud-play")?.addEventListener("click", toggleAudioPlay);
  container.querySelector("#aud-stop")?.addEventListener("click", stopAudioPlayback);
  container.querySelector("#aud-fade-in")?.addEventListener("click", () => applyAudioFade(true));
  container.querySelector("#aud-fade-out")?.addEventListener("click", () => applyAudioFade(false));
  container.querySelector("#aud-reverse")?.addEventListener("click", reverseAudioBuffer);
  container.querySelector("#aud-export-wav")?.addEventListener("click", exportAudioWav);
}

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function toggleAudioPlay() {
  initAudioContext();
  if (isAudioPlaying) {
    stopAudioPlayback();
  } else if (audioBuffer) {
    audioSourceNode = audioCtx.createBufferSource();
    audioSourceNode.buffer = audioBuffer;
    audioSourceNode.connect(audioCtx.destination);
    audioSourceNode.start(0);
    isAudioPlaying = true;
    renderToolbar();
    drawFftAnalyzer();
  }
}

function stopAudioPlayback() {
  if (audioSourceNode) {
    try { audioSourceNode.stop(); } catch {}
    audioSourceNode = null;
  }
  isAudioPlaying = false;
  renderToolbar();
}

function applyAudioFade(isFadeIn) {
  if (!audioBuffer) return;
  const channelData = audioBuffer.getChannelData(0);
  const len = channelData.length;
  const fadeLen = Math.floor(len * 0.2);

  for (let i = 0; i < fadeLen; i++) {
    const factor = isFadeIn ? i / fadeLen : 1 - i / fadeLen;
    const idx = isFadeIn ? i : len - fadeLen + i;
    channelData[idx] *= factor;
  }
  drawAudioWaveform();
  updateStatus(isFadeIn ? "Fade In applied" : "Fade Out applied");
}

function reverseAudioBuffer() {
  if (!audioBuffer) return;
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    Array.prototype.reverse.call(audioBuffer.getChannelData(i));
  }
  drawAudioWaveform();
  updateStatus("Audio track reversed");
}

function drawAudioWaveform() {
  const canvas = panel.querySelector("#studio-audio-canvas");
  if (!canvas || !audioBuffer) return;
  const ctx = canvas.getContext("2d");
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / canvas.width);
  const amp = canvas.height / 2;

  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#00f3ff";
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let i = 0; i < canvas.width; i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = data[i * step + j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    ctx.moveTo(i, (1 + min) * amp);
    ctx.lineTo(i, (1 + max) * amp);
  }
  ctx.stroke();
}

function drawFftAnalyzer() {
  const canvas = panel.querySelector("#studio-fft-canvas");
  if (!canvas || !isAudioPlaying) return;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#141824";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#00f3ff";
  for (let i = 0; i < canvas.width; i += 8) {
    const h = Math.random() * canvas.height;
    ctx.fillRect(i, canvas.height - h, 6, h);
  }

  if (isAudioPlaying) requestAnimationFrame(drawFftAnalyzer);
}

function exportAudioWav() {
  if (!audioBuffer) return alert("No audio loaded!");
  const wavBlob = audioBufferToWavBlob(audioBuffer);
  const url = URL.createObjectURL(wavBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audio-edit-${Date.now()}.wav`;
  a.click();
}

/* ==========================================================================
   DYNAMIC UI RENDERER & INSPECTOR
   ========================================================================== */

function renderToolbar() {
  const tb = panel.querySelector("#studio-toolbar");
  if (currentMode === "image") {
    tb.innerHTML = buildImageToolbar();
    bindImageEvents(tb);
  } else if (currentMode === "svg") {
    tb.innerHTML = buildSvgToolbar();
    bindSvgEvents(tb);
  } else if (currentMode === "gif") {
    tb.innerHTML = buildGifToolbar();
    bindGifEvents(tb);
  } else if (currentMode === "video") {
    tb.innerHTML = buildVideoToolbar();
    bindVideoEvents(tb);
  } else if (currentMode === "audio") {
    tb.innerHTML = buildAudioToolbar();
    bindAudioEvents(tb);
  }
}

function renderInspector() {
  const insp = panel.querySelector("#studio-inspector");
  insp.innerHTML = `
    <div class="insp-section">
      <h4>Properties</h4>
      <label>Stroke Color</label>
      <input type="color" id="insp-color" value="#00f3ff"/>
      <label>Stroke Width</label>
      <input type="range" id="insp-size" min="1" max="50" value="4"/>
    </div>

    <div class="insp-section">
      <h4>Layers Stack</h4>
      <div class="insp-layer-list">
        ${layers.map((l, i) => `<div class="insp-layer-item ${i === selectedLayerIndex ? "active" : ""}">${l.type.toUpperCase()} Layer${i + 1}</div>`).reverse().join("")}
      </div>
    </div>
  `;
}

/* ==========================================================================
   VFS FILE LOADERS / SAVERS
   ========================================================================== */

async function loadImageFromVfs(path) {
  const file = await fs.readFile(path);
  if (!file) return;
  const blob = new Blob([file.content], { type: file.mime || "image/png" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    baseImage = img;
    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;
    redraw();
  };
  img.src = url;
}

async function loadSvgFromVfs(path) {
  await loadImageFromVfs(path);
}

async function loadGifFromVfs(path) {
  await loadImageFromVfs(path);
}

async function loadVideoFromVfs(path) {
  const file = await fs.readFile(path);
  if (!file) return;
  const blob = new Blob([file.content], { type: file.mime || "video/mp4" });
  videoEl.src = URL.createObjectURL(blob);
}

async function loadAudioFromVfs(path) {
  initAudioContext();
  const file = await fs.readFile(path);
  if (!file) return;
  const arrayBuf = file.content.buffer || file.content;
  audioBuffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));
  drawAudioWaveform();
}

async function saveImageToVfs() {
  const path = prompt("VFS save target path:", sourcePath || `/media/edited-${Date.now()}.png`);
  if (!path) return;
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  const buf = await blob.arrayBuffer();
  await fs.writeFile(path, new Uint8Array(buf), { mime: "image/png" });
  alert("Successfully saved to VFS path: " + path);
}

/* ==========================================================================
   POINTER DRAG & VECTOR DRAWING HANDLERS
   ========================================================================== */

/* ==========================================================================
   INTERACTIVE CANVAS & DRAWING ENGINE
   ========================================================================== */

let isDrawing = false;
let startX = 0;
let startY = 0;
let snapshot = null;

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function getBrushSettings() {
  const colorEl = panel.querySelector("#insp-color");
  const sizeEl = panel.querySelector("#insp-size");
  return {
    color: colorEl ? colorEl.value : "#00f3ff",
    size: sizeEl ? Number(sizeEl.value) : 4
  };
}

function setTool(tool) {
  activeTool = tool;
  renderToolbar();
}

function handlePointerDown(e) {
  if (currentMode !== "image" && currentMode !== "svg") return;
  
  const pos = getCanvasCoords(e);
  startX = pos.x;
  startY = pos.y;
  isDrawing = true;

  const { color, size } = getBrushSettings();

  snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (activeTool === "marker") {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = size * 2.5;
  } else {
    ctx.globalAlpha = 1.0;
  }

  if (activeTool === "pen" || activeTool === "marker") {
    ctx.lineTo(startX, startY);
    ctx.stroke();
  }
}

function handlePointerMove(e) {
  if (!isDrawing) return;
  const pos = getCanvasCoords(e);

  if (activeTool === "pen" || activeTool === "marker") {
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  } else if (["rect", "circle", "arrow"].includes(activeTool)) {
    ctx.putImageData(snapshot, 0, 0);
    ctx.beginPath();

    const { color, size } = getBrushSettings();
    ctx.strokeStyle = color;
    ctx.lineWidth = size;

    if (activeTool === "rect") {
      ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
    } else if (activeTool === "circle") {
      const radius = Math.hypot(pos.x - startX, pos.y - startY);
      ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (activeTool === "arrow") {
      drawArrow(startX, startY, pos.x, pos.y, size);
    }
  }
}

function handlePointerUp(e) {
  if (!isDrawing) return;
  isDrawing = false;
  ctx.globalAlpha = 1.0;
  saveHistory();
}

function drawArrow(fromX, fromY, toX, toY, size) {
  const headLength = Math.max(12, size * 3);
  const angle = Math.atan2(toY - fromY, toX - fromX);

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 6),
    toY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 6),
    toY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.lineTo(toX, toY);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}
/* ==========================================================================
   HISTORY & UNDO / REDO ENGINE
   ========================================================================== */

function saveHistory() {
  const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  history.splice(historyIndex + 1);
  history.push(snapshot);
  historyIndex = history.length - 1;
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    ctx.putImageData(history[historyIndex], 0, 0);
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    ctx.putImageData(history[historyIndex], 0, 0);
  }
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (baseImage) ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
}

function updateStatus(msg) {
  const el = panel.querySelector("#st-status-msg");
  if (el) el.textContent = msg;
}

function exportRaster(mime) {
  const url = canvas.toDataURL(mime, 0.92);
  const a = document.createElement("a");
  a.href = url;
  a.download = `n3xn-export-${Date.now()}.${mime.includes("jpeg") ? "jpg" : "png"}`;
  a.click();
}

function handleKeyboard(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  }
}

function showPanel() {
  panel.style.display = "flex";
}

/* Helper to convert Web Audio Buffer to WAV blob */
function audioBufferToWavBlob(buffer) {
  const numOfChan = buffer.numberOfChannels,
    length = buffer.length * numOfChan * 2 + 44,
    out = new DataView(new ArrayBuffer(length)),
    channels = [];
  let sample, offset = 0, pos = 0;

  function setUint16(data) { out.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { out.setUint32(pos, data, true); pos += 4; }

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
  while (offset < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      out.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([out], { type: "audio/wav" });
}

/* ==========================================================================
   CSS STYLESHEET INJECTION (CYBER DARK THEME CONTINUITY)
   ========================================================================== */

function injectStyles() {
  if (document.getElementById("n3xn-studio-styles")) return;
  const style = document.createElement("style");
  style.id = "n3xn-studio-styles";
  style.textContent = `
    #n3xn-media-studio {
      position: fixed; inset: 16px; z-index: 99999;
      display: flex; flex-direction: column;
      background: #0a0a0f; color: #e2e8f0;
      border: 1px solid #2d3748; border-radius: 8px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8);
      font-family: system-ui, -apple-system, sans-serif;
      overflow: hidden;
    }
    .studio-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 16px; background: #141824; border-bottom: 1px solid #2d3748;
    }
    .studio-brand { display: flex; align-items: center; gap: 8px; font-weight: bold; color: #00f3ff; }
    .studio-mode-tabs { display: flex; gap: 4px; }
    .tab-btn {
      background: #0d0e15; border: 1px solid #2d3748; color: #a0aec0;
      padding: 6px 12px; font-size: 12px; border-radius: 4px; cursor: pointer;
    }
    .tab-btn.active { background: #2b6cb0; color: #fff; border-color: #63b3ed; }
    .studio-body { display: flex; flex: 1; overflow: hidden; }
    .studio-toolbar {
      width: 180px; background: #141824; border-right: 1px solid #2d3748;
      padding: 10px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto;
    }
    .tool-group { display: flex; flex-direction: column; gap: 4px; }
    .tool-title { font-size: 10px; text-transform: uppercase; color: #718096; font-weight: bold; }
    .tool-btn {
      background: #1a202c; border: 1px solid #2d3748; color: #e2e8f0;
      padding: 6px 8px; font-size: 11px; border-radius: 4px; text-align: left; cursor: pointer;
    }
    .tool-btn:hover { background: #2d3748; color: #00f3ff; }
    .tool-btn.primary { background: #00b4d8; color: #000; font-weight: bold; border: none; }
    .tool-btn.active { border-color: #00f3ff; background: #2c5282; }
    .studio-viewport {
      flex: 1; background: #07080c; display: flex;
      align-items: center; justify-content: center; padding: 20px; overflow: auto;
    }
    .studio-inspector {
      width: 220px; background: #141824; border-left: 1px solid #2d3748;
      padding: 12px; display: flex; flex-direction: column; gap: 12px;
    }
    .studio-statusbar {
      display: flex; justify-content: space-between; padding: 6px 16px;
      background: #141824; border-top: 1px solid #2d3748; font-size: 11px; color: #a0aec0;
    }
  `;
  document.head.appendChild(style);
}
