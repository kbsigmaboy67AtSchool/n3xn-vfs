/**
 * n3xn public chat + global voice rooms
 * Encrypted with a built-in public room key so anyone can join.
 * Signaling still goes through the user's WSS relay URL.
 */

import {
  encrypt,
  decrypt,
  toBase64,
  fromBase64,
} from "./crypto.js";
import * as db from "./db.js";

/** Public room password — intentional shared key for open rooms */
export const PUBLIC_ROOM_KEY = "n3xn-public-v1-join-anyone";

export const PUBLIC_ROOMS = [
  { id: "global-text", name: "Global Text", kind: "text" },
  { id: "global-vc", name: "Global Voice", kind: "vc" },
  { id: "global-hangout", name: "Hangout", kind: "both" },
];

let ws = null;
let myId = null;
let roomId = "global-text";
let roomUrl = null;
let onLog = () => {};
let onMessage = () => {};
let onPresence = () => {};
let onVcLevel = () => {};

const peers = new Map();
const vcPcs = new Map();
let localStream = null;
let localVideo = false;
let micEnabled = true;
let audioCtx = null;
let analyser = null;
let levelTimer = null;
let localBus = null; // BroadcastChannel — same-browser / no-WSS local mode
let localMode = false;

/* ---------- Zoom-style participant tiles ---------- */

function gridEl() {
  return document.getElementById("chat-vc-videos");
}

function initials(name) {
  const s = String(name || "?").trim();
  const parts = s.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

/**
 * mode: 'video' | 'audio' | 'idle'
 */
export function ensureTile(peerId, { name, mode = "idle", stream = null, self = false } = {}) {
  const grid = gridEl();
  if (!grid) return null;
  let tile = document.getElementById("chat-tile-" + peerId);
  if (!tile) {
    tile = document.createElement("div");
    tile.id = "chat-tile-" + peerId;
    tile.className = "chat-tile";
    tile.innerHTML = `
      <div class="chat-tile-avatar"></div>
      <video playsinline autoplay></video>
      <div class="chat-tile-name"></div>
      <div class="chat-tile-badge"></div>`;
    grid.appendChild(tile);
  }
  tile.classList.toggle("self", !!self);
  const label = name || peers.get(peerId)?.user || peerId;
  tile.querySelector(".chat-tile-name").textContent = self ? label + " (you)" : label;
  tile.querySelector(".chat-tile-avatar").textContent = initials(label);

  const video = tile.querySelector("video");
  tile.classList.remove("audio-only", "idle");
  if (mode === "video" && stream) {
    video.srcObject = stream;
    video.muted = !!self; // avoid feedback
    video.style.display = "block";
    tile.querySelector(".chat-tile-badge").textContent = "CAM";
    video.play?.().catch(() => {});
  } else if (mode === "audio") {
    tile.classList.add("audio-only");
    if (stream) {
      video.srcObject = stream;
      video.muted = true; // audio played via hidden element if needed
    }
    tile.querySelector(".chat-tile-badge").textContent = "🎤";
  } else {
    tile.classList.add("idle");
    tile.querySelector(".chat-tile-badge").textContent = "";
  }
  return tile;
}

export function setTileTalking(peerId, on) {
  document.getElementById("chat-tile-" + peerId)?.classList.toggle("talking", !!on);
}

export function removeTile(peerId) {
  document.getElementById("chat-tile-" + peerId)?.remove();
  document.getElementById("n3xn-chat-av-" + peerId)?.remove();
}

function refreshLocalTile() {
  if (!localStream) {
    ensureTile("local", {
      name: (typeof db !== "undefined" && db.getCurrentUser?.()) || "you",
      mode: "idle",
      self: true,
    });
    return;
  }
  const hasVid = localStream.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
  const hasAud = localStream.getAudioTracks().some((t) => t.enabled && t.readyState === "live");
  ensureTile("local", {
    name: (typeof db !== "undefined" && db.getCurrentUser?.()) || "you",
    mode: hasVid ? "video" : hasAud ? "audio" : "idle",
    stream: localStream,
    self: true,
  });
}



export function setChatHandlers({ log, message, presence, vcLevel } = {}) {
  if (log) onLog = log;
  if (message) onMessage = message;
  if (presence) onPresence = presence;
  if (vcLevel) onVcLevel = vcLevel;
}

export function getPublicRooms() {
  return PUBLIC_ROOMS.slice();
}

export function isChatConnected() {
  return (ws && ws.readyState === WebSocket.OPEN) || (localMode && !!localBus);
}

export function getChatStatus() {
  return {
    connected: isChatConnected(),
    room: roomId,
    id: myId,
    peers: [...peers.entries()].map(([id, p]) => ({
      id,
      user: p.user,
      mic: p.mic,
      level: p.level || 0,
    })),
    mic: micEnabled,
    video: localVideo,
  };
}

/**
 * Connect to relay path = room id. Uses PUBLIC_ROOM_KEY for E2E.
 * @param {string} relayBase e.g. wss://relay.example.com
 * @param {string} room one of PUBLIC_ROOMS ids or custom
 */
export async function chatConnect(relayBase, room = "global-text") {
  await chatDisconnect();
  roomId = room || "global-text";
  let u = String(relayBase || "").trim();
  if (!u) throw new Error("Relay URL required");
  if (u.startsWith("https://")) u = "wss://" + u.slice(8);
  if (u.startsWith("http://")) u = "ws://" + u.slice(7);
  if (!u.startsWith("ws")) u = "wss://" + u;
  const base = u.replace(/\/$/, "");
  // path = room name
  const url = new URL(base.includes("/", 8) && base.split("/").length > 3 ? base : base + "/" + roomId);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/" + roomId;
  } else if (!url.pathname.includes(roomId)) {
    url.pathname = "/" + roomId;
  }
  url.searchParams.set("presence", "1");
  url.searchParams.set("echo", "0");
  roomUrl = url.toString();

  await new Promise((resolve, reject) => {
    ws = new WebSocket(roomUrl);
    const t = setTimeout(() => reject(new Error("Chat connect timeout")), 15000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error("Chat WebSocket error"));
    };
    ws.onclose = () => {
      onLog("Chat disconnected", "err");
      stopLevelLoop();
      teardownAllVc();
      peers.clear();
      onPresence(getChatStatus());
    };
    ws.onmessage = (ev) => handleRaw(ev.data);
  });

  setTimeout(() => {
    sendEnc({
      t: "hello",
      user: db.getCurrentUser() || "anon",
      room: roomId,
      mic: micEnabled,
    }).catch(() => {});
  }, 150);

  onLog(`Chat joined ${roomId}`, "ok");
  onPresence(getChatStatus());
  return getChatStatus();
}

/** Local-only mode via BroadcastChannel (same origin tabs) — no WSS required */
export async function chatConnectLocal(room = "global-text") {
  await chatDisconnect();
  localMode = true;
  roomId = room || "global-text";
  myId = "local-" + crypto.randomUUID().slice(0, 6);
  try {
    localBus = new BroadcastChannel("n3xn-chat-" + roomId);
  } catch (e) {
    throw new Error("BroadcastChannel unavailable: " + e.message);
  }
  localBus.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || msg.from === myId) return;
    handleMsg(msg);
  };
  peers.set(myId, { user: db.getCurrentUser() || "you", mic: micEnabled, level: 0 });
  onLog("Local chat room " + roomId + " (BroadcastChannel, no WSS)", "ok");
  onPresence(getChatStatus());
  localBus.postMessage({
    t: "hello",
    from: myId,
    user: db.getCurrentUser() || "anon",
    mic: micEnabled,
    ts: Date.now(),
  });
  return getChatStatus();
}

export function openChatSidebar() {
  const side = document.getElementById("chat-sidebar");
  if (!side) {
    console.warn("[n3xn] #chat-sidebar not in DOM");
    return false;
  }
  side.classList.remove("collapsed");
  setSidebarCollapsed(false);
  side.style.display = "flex";
  side.style.zIndex = "10000";
  return true;
}

export function closeChatSidebar() {
  const side = document.getElementById("chat-sidebar");
  if (!side) return false;
  side.classList.add("collapsed");
  setSidebarCollapsed(true);
  return true;
}

export function toggleChatSidebar() {
  const side = document.getElementById("chat-sidebar");
  if (!side) return false;
  side.classList.toggle("collapsed");
  setSidebarCollapsed(side.classList.contains("collapsed"));
  return !side.classList.contains("collapsed");
}

export async function chatDisconnect() {
  try {
    if (isChatConnected()) await sendEnc({ t: "bye", user: db.getCurrentUser() || "anon" });
  } catch {}
  teardownAllVc();
  stopLevelLoop();
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  try {
    ws?.close();
  } catch {}
  ws = null;
  try {
    localBus?.close();
  } catch {}
  localBus = null;
  localMode = false;
  myId = null;
  peers.clear();
  onPresence(getChatStatus());
}

async function sendEnc(obj) {
  const payload = { ...obj, from: myId || "local", ts: Date.now() };
  if (localMode && localBus) {
    localBus.postMessage(payload);
    return;
  }
  if (!isChatConnected()) throw new Error("Chat not connected");
  const encrypted = await encrypt(JSON.stringify(payload), PUBLIC_ROOM_KEY);
  ws.send(JSON.stringify({ v: 1, e: toBase64(encrypted) }));
}

async function handleRaw(data) {
  if (typeof data === "string") {
    try {
      const j = JSON.parse(data);
      if (j?.t?.startsWith("_")) {
        if (j.t === "_hello") {
          myId = j.id;
          onPresence(getChatStatus());
        } else if (j.t === "_join") {
          peers.set(j.id, { user: j.id, mic: false, level: 0 });
          onPresence(getChatStatus());
        } else if (j.t === "_leave") {
          peers.delete(j.id);
          teardownVc(j.id);
          onPresence(getChatStatus());
        }
        return;
      }
    } catch {}
  }
  try {
    let bytes;
    if (typeof data === "string") {
      const env = JSON.parse(data);
      bytes = fromBase64(env.e);
    } else {
      bytes = new Uint8Array(data);
    }
    const plain = await decrypt(bytes, PUBLIC_ROOM_KEY);
    const msg = JSON.parse(new TextDecoder().decode(plain));
    await handleMsg(msg);
  } catch (e) {
    /* wrong key / noise */
  }
}

async function handleMsg(msg) {
  if (!msg?.t) return;
  const from = msg.from || "?";
  if (from === myId) return;

  switch (msg.t) {
    case "hello":
      peers.set(from, {
        user: msg.user || from,
        mic: !!msg.mic,
        level: 0,
      });
      ensureTile(from, {
        name: msg.user || from,
        mode: msg.mic ? "audio" : "idle",
      });
      onPresence(getChatStatus());
      break;
    case "bye":
      peers.delete(from);
      teardownVc(from);
      onPresence(getChatStatus());
      break;
    case "chat":
      onMessage({
        id: msg.id || `C-${Date.now()}`,
        from,
        user: msg.user || peers.get(from)?.user || from,
        text: String(msg.text || "").slice(0, 12000),
        ts: msg.ts || Date.now(),
      });
      break;
    case "mic_state":
      {
        const p = peers.get(from) || { user: from };
        p.mic = !!msg.on;
        peers.set(from, p);
        onPresence(getChatStatus());
      }
      break;
    case "vc_level":
      {
        const p = peers.get(from) || { user: from };
        p.level = Math.min(1, Math.max(0, Number(msg.level) || 0));
        peers.set(from, p);
        onVcLevel(from, p.level);
        setTileTalking(from, p.level > 0.12);
        onPresence(getChatStatus());
      }
      break;
    case "vc_signal":
      await handleVcSignal(from, msg);
      break;
    case "vc_leave":
      teardownVc(from);
      break;
    default:
      break;
  }
}

export async function sendChat(text) {
  const body = String(text || "").trim();
  if (!body) return;
  const id = "C-" + crypto.randomUUID().slice(0, 6).toUpperCase();
  await sendEnc({
    t: "chat",
    id,
    text: body.slice(0, 12000),
    user: db.getCurrentUser() || "anon",
  });
  onMessage({
    id,
    from: myId || "me",
    user: db.getCurrentUser() || "you",
    text: body,
    ts: Date.now(),
    self: true,
  });
}

/* ---------- mic / WebRTC audio (+ optional video) ---------- */

export async function setMic(on) {
  micEnabled = !!on;
  if (localStream) {
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = micEnabled;
    });
  }
  if (isChatConnected()) {
    await sendEnc({ t: "mic_state", on: micEnabled }).catch(() => {});
  }
  if (micEnabled) startLevelLoop();
  else stopLevelLoop();
  refreshLocalTile();
  onPresence(getChatStatus());
  return micEnabled;
}

export function toggleMic() {
  return setMic(!micEnabled);
}

export async function ensureMedia({ video = false } = {}) {
  localVideo = !!video;
  if (localStream) {
    const hasVid = localStream.getVideoTracks().length > 0;
    if (video === hasVid) return localStream;
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: video
      ? {
          width: { max: 320, ideal: 320 },
          height: { max: 240, ideal: 240 },
          frameRate: { max: 15, ideal: 12 },
        }
      : false,
  });
  localStream.getAudioTracks().forEach((t) => {
    t.enabled = micEnabled;
  });
  startLevelLoop();
  refreshLocalTile();
  return localStream;
}

function startLevelLoop() {
  stopLevelLoop();
  if (!localStream || !micEnabled) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(localStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    levelTimer = setInterval(() => {
      if (!analyser) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const level = Math.min(1, sum / (data.length * 128));
      onVcLevel("local", level);
      setTileTalking("local", level > 0.12);
      if (isChatConnected() && level > 0.02) {
        sendEnc({ t: "vc_level", level: +level.toFixed(3) }).catch(() => {});
      }
    }, 120);
  } catch (_) {}
}

function stopLevelLoop() {
  if (levelTimer) clearInterval(levelTimer);
  levelTimer = null;
  try {
    audioCtx?.close();
  } catch {}
  audioCtx = null;
  analyser = null;
}

async function createPc(peerId) {
  if (vcPcs.has(peerId)) return vcPcs.get(peerId);
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      sendEnc({
        t: "vc_signal",
        to: peerId,
        kind: "ice",
        candidate: ev.candidate.toJSON(),
      }).catch(() => {});
    }
  };
  pc.ontrack = (ev) => {
    const stream = ev.streams[0] || new MediaStream([ev.track]);
    const name = peers.get(peerId)?.user || peerId;
    const hasVideo = stream.getVideoTracks().length > 0 && stream.getVideoTracks().some((t) => t.readyState === "live");
    // keep hidden audio element for audio-only playback reliability
    let audioEl = document.getElementById("n3xn-chat-av-" + peerId);
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.id = "n3xn-chat-av-" + peerId;
      audioEl.autoplay = true;
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
    }
    audioEl.srcObject = stream;
    ensureTile(peerId, {
      name,
      mode: hasVideo || ev.track.kind === "video" ? "video" : "audio",
      stream,
      self: false,
    });
  };
  const stream = await ensureMedia({ video: localVideo });
  stream.getTracks().forEach((tr) => pc.addTrack(tr, stream));
  vcPcs.set(peerId, pc);
  return pc;
}

export async function startVcWith(peerId) {
  const pc = await createPc(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sendEnc({ t: "vc_signal", to: peerId, kind: "offer", sdp: offer });
}

export async function joinVcMesh() {
  await ensureMedia({ video: localVideo });
  refreshLocalTile();
  // show idle tiles for known peers until tracks arrive
  for (const [id, meta] of peers) {
    if (id === myId) continue;
    ensureTile(id, { name: meta.user || id, mode: meta.mic ? "audio" : "idle" });
  }
  for (const id of peers.keys()) {
    if (id !== myId) await startVcWith(id).catch(() => {});
  }
  onLog("Call mesh started — tiles update as streams arrive", "ok");
}

async function handleVcSignal(from, msg) {
  if (msg.to && myId && msg.to !== myId) return;
  const pc = await createPc(from);
  try {
    if (msg.kind === "offer" && msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendEnc({ t: "vc_signal", to: from, kind: "answer", sdp: answer });
    } else if (msg.kind === "answer" && msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
    } else if (msg.kind === "ice" && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch {}
    }
  } catch (e) {
    onLog("VC signal: " + e.message, "err");
  }
}

function teardownVc(peerId) {
  const pc = vcPcs.get(peerId);
  if (pc) {
    try {
      pc.close();
    } catch {}
    vcPcs.delete(peerId);
  }
  removeTile(peerId);
}

function teardownAllVc() {
  for (const id of [...vcPcs.keys()]) teardownVc(id);
}

export async function setVideo(on) {
  localVideo = !!on;
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (on || micEnabled) await ensureMedia({ video: localVideo });
  refreshLocalTile();
  for (const id of peers.keys()) {
    if (id !== myId) await startVcWith(id).catch(() => {});
  }
}


/** When chat sidebar is collapsed, disable video tracks to save decode/CPU */
export function setSidebarCollapsed(collapsed) {
  if (!localStream) return;
  localStream.getVideoTracks().forEach((t) => {
    t.enabled = !collapsed && localVideo;
  });
  // pause remote videos
  document.querySelectorAll(".n3xn-chat-remote-video").forEach((v) => {
    try {
      if (collapsed) v.pause();
      else v.play().catch(() => {});
    } catch {}
  });
}
