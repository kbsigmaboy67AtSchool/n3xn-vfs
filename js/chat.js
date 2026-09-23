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
    case "signal":
      await handleSignal({ ...msg, id: msg.id || from, from });
      break;
    case "voice-join":
      peers.set(from, {
        user: msg.u || msg.user || from,
        mic: true,
        level: 0,
      });
      if (inCall) ensurePeer(from, msg.u || msg.user || from, true);
      ensureTile(from, {
        name: msg.u || msg.user || from,
        mode: "idle",
      });
      onPresence(getChatStatus());
      break;
    case "voice-leave":
    case "vc_leave":
      removeCallPeer(from);
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
    }, 200);
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


/* ---------- Voice/Video mesh (V0RT3X-style perfect negotiation) ---------- */

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/** peerId -> { pc, name, polite, makingOffer, ignoreOffer, stream } */
const callPeers = new Map();
let inCall = false;

export async function ensureMedia({ video = false } = {}) {
  localVideo = !!video;
  if (localStream) {
    const hasVid = localStream.getVideoTracks().length > 0;
    if (video === hasVid) {
      localStream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
      refreshLocalTile();
      return localStream;
    }
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
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

function ensurePeer(id, name, initiator) {
  if (!id || id === myId || callPeers.has(id) || !inCall || !localStream) return;
  const pc = new RTCPeerConnection(rtcConfig);
  const polite = String(myId) < String(id);
  const entry = {
    pc,
    name: name || peers.get(id)?.user || id,
    polite,
    makingOffer: false,
    ignoreOffer: false,
    stream: null,
  };
  callPeers.set(id, entry);
  ensureTile(id, { name: entry.name, mode: "idle" });

  localStream.getTracks().forEach((t) => {
    try {
      pc.addTrack(t, localStream);
    } catch (_) {}
  });

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      sendEnc({
        t: "signal",
        id: myId,
        to: id,
        u: db.getCurrentUser() || "anon",
        kind: "ice",
        payload: ev.candidate,
      }).catch(() => {});
    }
  };

  pc.ontrack = (ev) => {
    const stream = ev.streams[0] || new MediaStream([ev.track]);
    entry.stream = stream;
    let audio = document.getElementById("n3xn-chat-av-" + id);
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = "n3xn-chat-av-" + id;
      audio.autoplay = true;
      audio.playsInline = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = stream;
    audio.play().catch(() => {});
    const hasVid = stream.getVideoTracks().some((t) => t.readyState === "live");
    ensureTile(id, {
      name: entry.name,
      mode: hasVid || ev.track.kind === "video" ? "video" : "audio",
      stream,
    });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") removeCallPeer(id);
  };

  pc.onnegotiationneeded = async () => {
    try {
      // Perfect negotiation: only one side creates offers when stable
      if (entry.makingOffer) return;
      if (pc.signalingState !== "stable" && pc.signalingState !== "have-local-offer") {
        // avoid m-line order errors on glare / mid-renegotiation
        return;
      }
      entry.makingOffer = true;
      const offer = await pc.createOffer();
      // Glare check after await
      if (pc.signalingState !== "stable" && pc.signalingState !== "have-local-offer") {
        return;
      }
      await pc.setLocalDescription(offer);
      await sendEnc({
        t: "signal",
        id: myId,
        to: id,
        u: db.getCurrentUser() || "anon",
        kind: "offer",
        payload: pc.localDescription,
      });
    } catch (e) {
      console.warn("nego", e);
    } finally {
      entry.makingOffer = false;
    }
  };

  // Initiator: kick negotiation once via onnegotiationneeded (addTrack already queued it).
  // Do NOT double-createOffer — that causes m-line order InvalidAccessError.
}


async function handleSignal(data) {
  if (!inCall || !localStream) return;
  const from = data.id || data.from;
  if (!from || from === myId) return;
  if (data.to && myId && data.to !== myId) return;
  if (!callPeers.has(from)) ensurePeer(from, data.u || data.user || "?", false);
  const entry = callPeers.get(from);
  if (!entry) return;
  const pc = entry.pc;
  try {
    if (data.kind === "offer") {
      const offerCollision = entry.makingOffer || pc.signalingState !== "stable";
      entry.ignoreOffer = !entry.polite && offerCollision;
      if (entry.ignoreOffer) return;
      if (pc.signalingState === "have-local-offer" && entry.polite) {
        try { await pc.setLocalDescription({ type: "rollback" }); } catch (_) {}
      }
      await pc.setRemoteDescription(data.payload);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendEnc({
        t: "signal",
        id: myId,
        to: from,
        u: db.getCurrentUser() || "anon",
        kind: "answer",
        payload: pc.localDescription,
      });
    } else if (data.kind === "answer") {
      await pc.setRemoteDescription(data.payload);
    } else if (data.kind === "ice" && data.payload) {
      try {
        await pc.addIceCandidate(data.payload);
      } catch (e) {
        if (!entry.ignoreOffer) console.warn(e);
      }
    }
  } catch (e) {
    console.warn("signal", e);
  }
}

function removeCallPeer(id) {
  const entry = callPeers.get(id);
  if (!entry) return;
  try {
    entry.pc.close();
  } catch (_) {}
  callPeers.delete(id);
  removeTile(id);
  document.getElementById("n3xn-chat-av-" + id)?.remove();
}

/** Join call mesh — voice by default; camera if already enabled */
export async function joinVcMesh() {
  if (inCall) {
    onLog("Already in call", "out");
    return;
  }
  if (!isChatConnected()) throw new Error("Join a chat room first");
  await ensureMedia({ video: localVideo });
  inCall = true;
  refreshLocalTile();
  // announce so others connect to us
  await sendEnc({
    t: "voice-join",
    u: db.getCurrentUser() || "anon",
    id: myId,
    video: localVideo,
  });
  // connect to everyone already known
  for (const [id, meta] of peers) {
    if (id !== myId) ensurePeer(id, meta.user || id, true);
  }
  onLog("Joined call mesh", "ok");
  onPresence(getChatStatus());
}

export async function startVcWith(peerId) {
  if (!inCall) await joinVcMesh();
  ensurePeer(peerId, peers.get(peerId)?.user || peerId, true);
}

export async function setVideo(on) {
  const want = !!on;
  if (want === localVideo && localStream) {
    refreshLocalTile();
    return;
  }
  localVideo = want;
  // restart media with/without cam, renegotiate via negotiationneeded
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (inCall || want) {
    await ensureMedia({ video: localVideo });
    // replace tracks on existing PCs
    for (const [id, entry] of callPeers) {
      const senders = entry.pc.getSenders();
      for (const track of localStream.getTracks()) {
        const sender = senders.find((s) => s.track && s.track.kind === track.kind);
        if (sender) {
          try {
            await sender.replaceTrack(track);
          } catch (_) {
            try {
              entry.pc.addTrack(track, localStream);
            } catch (__) {}
          }
        } else {
          try {
            entry.pc.addTrack(track, localStream);
          } catch (_) {}
        }
      }
    }
  }
  refreshLocalTile();
  if (inCall) {
    await sendEnc({
      t: "voice-join",
      u: db.getCurrentUser() || "anon",
      id: myId,
      video: localVideo,
    }).catch(() => {});
  }
}

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
  if (micEnabled && localStream) startLevelLoop();
  else stopLevelLoop();
  refreshLocalTile();
  onPresence(getChatStatus());
  return micEnabled;
}

export function toggleMic() {
  return setMic(!micEnabled);
}

export async function leaveCall() {
  inCall = false;
  for (const id of [...callPeers.keys()]) removeCallPeer(id);
  if (isChatConnected()) {
    await sendEnc({ t: "voice-leave", id: myId }).catch(() => {});
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  stopLevelLoop();
  removeTile("local");
  onLog("Left call", "ok");
  onPresence(getChatStatus());
}

// backward-compat aliases used by app/terminal
export async function vcLeave() {
  return leaveCall();
}

function teardownVc(peerId) {
  removeCallPeer(peerId);
}

function teardownAllVc() {
  inCall = false;
  for (const id of [...callPeers.keys()]) removeCallPeer(id);
}

async function handleVcSignal(from, msg) {
  // legacy wrapper
  await handleSignal({
    ...msg,
    id: from,
    from,
    payload: msg.payload || msg.sdp || msg.candidate,
  });
}


/** When chat sidebar is collapsed, disable video tracks to save decode/CPU */
export function setSidebarCollapsed(collapsed) {
  if (!localStream) return;
  localStream.getVideoTracks().forEach((t) => {
    t.enabled = !collapsed && localVideo;
  });
  document.querySelectorAll(".n3xn-chat-remote-video, .chat-tile video").forEach((v) => {
    try {
      if (collapsed) v.pause();
      else v.play().catch(() => {});
    } catch {}
  });
}
