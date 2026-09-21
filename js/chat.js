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
  return ws && ws.readyState === WebSocket.OPEN;
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
  myId = null;
  peers.clear();
  onPresence(getChatStatus());
}

async function sendEnc(obj) {
  if (!isChatConnected()) throw new Error("Chat not connected");
  const payload = { ...obj, from: myId || "local", ts: Date.now() };
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
    let el = document.getElementById("n3xn-chat-av-" + peerId);
    if (!el) {
      el = document.createElement(ev.track.kind === "video" ? "video" : "audio");
      el.id = "n3xn-chat-av-" + peerId;
      el.autoplay = true;
      el.playsInline = true;
      if (el.tagName === "AUDIO") el.style.display = "none";
      else {
        el.muted = false;
        el.className = "n3xn-chat-remote-video";
        document.getElementById("chat-vc-videos")?.appendChild(el);
      }
      if (el.tagName === "AUDIO") document.body.appendChild(el);
    }
    el.srcObject = ev.streams[0];
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
  for (const id of peers.keys()) {
    if (id !== myId) await startVcWith(id).catch(() => {});
  }
  onLog("VC mesh offer sent to peers", "ok");
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
  document.getElementById("n3xn-chat-av-" + peerId)?.remove();
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
  // renegotiate simply by re-offering
  for (const id of peers.keys()) {
    await startVcWith(id).catch(() => {});
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
