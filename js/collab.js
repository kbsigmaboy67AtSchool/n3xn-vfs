/**
 * n3xn VFS v2 — Encrypted WSS collab over Universal Relay (Cloudflare DO)
 *
 * Relay is opaque broadcast. All app payloads are E2E AES-GCM with a room password.
 * Relay control frames (_hello, _join, _leave) stay plaintext JSON from the server.
 *
 * Features:
 *  - connect / disconnect / status
 *  - encrypted chat
 *  - file share (chunked binary)
 *  - collab edit sessions (live text sync + cursors)
 *  - FS push/pull of single files or whole tree manifests
 */

import {
  encrypt,
  decrypt,
  toBase64,
  fromBase64,
} from "./crypto.js";
import * as fs from "./fs.js";
import * as db from "./db.js";

const CHUNK = 48 * 1024; // ~48KB binary chunks before base64

let ws = null;
let roomKey = null; // password string used with encrypt()
let roomUrl = null;
let roomName = null;
let myId = null;
let peers = new Map(); // id -> { lastSeen }
let onLog = (msg, cls) => console.log(msg);
let transfers = new Map(); // id -> { path, mime, chunks[], total, from }
/** Collab FS catalog: key = collabPath "/collab/<from>/<path>" */
const sharedFiles = new Map(); // key -> { key, path, from, fromUser, mime, size, status, id, content, updated }
let myShares = new Map(); // path -> { id, mime, size }
let collabFsListeners = [];

let collabDoc = null; // { path, version, applying }
let statusEl = null;
/** @type {Map<string, { id, user, path, line, column, color, lastSeen, decorationIds, widget }>} */
const remoteCursors = new Map();
let cursorSendTimer = null;
let lastSentCursor = null; // { path, line, column }
let cursorHooked = false;
/** @type {Map<string, object>} */
const pendingVc = new Map(); // id -> request
/** @type {Map<string, RTCPeerConnection>} */
const vcPeers = new Map();
let vcLocalStream = null;
let vcMuted = false;
/** @type {Array<object>} */
const pmHistory = []; // last private messages for reply
let lastPmId = null;
const PM_MAX_IMAGES = 4;
const PM_MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const PM_MAX_TEXT = 12000;

const CURSOR_PALETTE = [
  "#00f3ff", "#ff79c6", "#4ade80", "#fbbf24", "#a78bfa",
  "#fb7185", "#38bdf8", "#f472b6", "#34d399", "#facc15",
];


export function setLogger(fn) {
  onLog = fn || onLog;
}

function log(msg, cls = "out") {
  onLog(msg, cls);
}

export function onCollabFsChange(fn) {
  if (typeof fn === "function") collabFsListeners.push(fn);
}
function notifyCollabFs() {
  const list = listSharedFiles();
  for (const fn of collabFsListeners) {
    try {
      fn(list);
    } catch (_) {}
  }
  if (window.__n3xnRefreshCollabFs) {
    try {
      window.__n3xnRefreshCollabFs(list);
    } catch (_) {}
  }
}

export function listSharedFiles() {
  return [...sharedFiles.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function getSharedFile(keyOrPath) {
  if (sharedFiles.has(keyOrPath)) return sharedFiles.get(keyOrPath);
  for (const v of sharedFiles.values()) {
    if (v.path === keyOrPath || v.key.endsWith(keyOrPath)) return v;
  }
  return null;
}

function collabKey(from, path) {
  const p = path.startsWith("/") ? path : "/" + path;
  return `/collab/${from}${p}`;
}


export function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN;
}

export function getStatus() {
  return {
    connected: isConnected(),
    url: roomUrl,
    room: roomName,
    id: myId,
    peers: [...peers.keys()],
    collab: collabDoc?.path || null,
  };
}

/** Connect to wss://host/room?presence=1&echo=0 */
export async function connect(url, password, opts = {}) {
  if (isConnected()) await disconnect();

  if (!password || password.length < 4) {
    throw new Error("Room password required (min 4 chars) — used for E2E encryption");
  }

  let u = url.trim();
  if (u.startsWith("https://")) u = "wss://" + u.slice(8);
  if (u.startsWith("http://")) u = "ws://" + u.slice(7);
  if (!u.startsWith("ws://") && !u.startsWith("wss://")) u = "wss://" + u;

  const parsed = new URL(u);
  if (!parsed.searchParams.has("presence")) parsed.searchParams.set("presence", "1");
  // echo=0 so we don't receive our own frames (we apply local edits optimistically)
  if (!parsed.searchParams.has("echo")) parsed.searchParams.set("echo", opts.echo ? "1" : "0");

  roomUrl = parsed.toString();
  roomName = parsed.pathname.replace(/^\/+/, "") || "default";
  roomKey = password;
  peers.clear();
  myId = null;

  log(`Connecting ${roomUrl} …`, "out");

  await new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(roomUrl);
    } catch (e) {
      reject(e);
      return;
    }
    ws.binaryType = "arraybuffer";

    const t = setTimeout(() => {
      reject(new Error("Connection timeout"));
      try { ws.close(); } catch {}
    }, 15000);

    ws.onopen = () => {
      clearTimeout(t);
      log("WSS open — waiting for relay hello…", "ok");
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error("WebSocket error (check URL / CORS / mixed content)"));
    };
    ws.onclose = () => {
      log("WSS closed", "err");
      ws = null;
      myId = null;
      peers.clear();
      clearRemoteCursors();
      updateStatusBar();
    };
    ws.onmessage = (ev) => handleRaw(ev.data);
  });

  // Announce encrypted presence after a short delay (hello may arrive first)
  setTimeout(() => {
    if (isConnected()) {
      sendEnc({
        t: "hello",
        user: db.getCurrentUser() || "anon",
        agent: "n3xn-vfs-v2",
        collab: collabDoc?.path || null,
      });
      setTimeout(() => announceMyShares().catch(() => {}), 400);
    }
  }, 200);

  updateStatusBar();
  return getStatus();
}

export async function disconnect() {
  if (ws) {
    try {
      await sendEnc({ t: "bye", user: db.getCurrentUser() || "anon" });
    } catch {}
    try { ws.close(); } catch {}
  }
  ws = null;
  myId = null;
  peers.clear();
  collabDoc = null;
  transfers.clear();
  clearRemoteCursors();
  sharedFiles.clear();
  myShares.clear();
  notifyCollabFs();
  updateStatusBar();
  log("Disconnected", "out");
}

function updateStatusBar() {
  const el = document.getElementById("status-stats");
  if (!el) return;
  if (isConnected()) {
    el.textContent = `WSS · ${roomName} · id:${myId || "?"} · peers:${peers.size}${collabDoc ? " · collab:" + collabDoc.path : ""}`;
  } else {
    el.textContent = "";
  }
}

async function handleRaw(data) {
  // Relay control frames are plaintext JSON starting with {"t":"_
  if (typeof data === "string") {
    try {
      const j = JSON.parse(data);
      if (j && typeof j.t === "string" && j.t.startsWith("_")) {
        handleRelayControl(j);
        return;
      }
    } catch {
      // fall through — may be encrypted envelope as string
    }
  }

  // Encrypted app envelope
  try {
    let bytes;
    if (typeof data === "string") {
      // envelope: {"v":1,"e":"<b64>"}
      const env = JSON.parse(data);
      if (!env.e) throw new Error("no payload");
      bytes = fromBase64(env.e);
    } else {
      bytes = new Uint8Array(data);
    }
    const plain = await decrypt(bytes, roomKey);
    const text = new TextDecoder().decode(plain);
    const msg = JSON.parse(text);
    await handleAppMessage(msg);
  } catch (e) {
    // Wrong room password or non-n3xn traffic
    log(`Decrypt failed (wrong room password or foreign traffic): ${e.message}`, "err");
  }
}

function handleRelayControl(j) {
  if (j.t === "_hello") {
    myId = j.id;
    log(`Relay hello — you are ${myId}, room size ${j.n}`, "ok");
    updateStatusBar();
  } else if (j.t === "_join") {
    peers.set(j.id, { lastSeen: Date.now() });
    log(`Peer joined: ${j.id} (n=${j.n})`, "ok");
    updateStatusBar();
  } else if (j.t === "_leave") {
    peers.delete(j.id);
    removeRemoteCursor(j.id);
    removeSharesFromPeer(j.id);
    log(`Peer left: ${j.id} (n=${j.n})`, "out");
    updateStatusBar();
  }
}

async function handleAppMessage(msg) {
  if (!msg || !msg.t) return;
  const from = msg.from || "?";

  switch (msg.t) {
    case "hello":
      peers.set(from, { lastSeen: Date.now(), user: msg.user });
      log(`[${from}] hello · ${msg.user || "anon"}`, "ok");
      updateStatusBar();
      break;
    case "bye":
      peers.delete(from);
      removeRemoteCursor(from);
      removeSharesFromPeer(from);
      log(`[${from}] bye`, "out");
      updateStatusBar();
      break;
    case "chat":
      log(`[${from}] ${msg.text}`, "cmd");
      break;
    case "file_meta":
      transfers.set(msg.id, {
        id: msg.id,
        path: msg.path,
        mime: msg.mime,
        total: msg.chunks,
        size: msg.size,
        from,
        parts: new Array(msg.chunks),
      });
      {
        const key = collabKey(from, msg.path);
        sharedFiles.set(key, {
          key,
          path: msg.path.startsWith("/") ? msg.path : "/" + msg.path,
          from,
          fromUser: peers.get(from)?.user || msg.user || from,
          mime: msg.mime,
          size: msg.size || 0,
          status: "streaming",
          id: msg.id,
          updated: Date.now(),
        });
        notifyCollabFs();
      }
      log(`[${from}] sharing → ${msg.path} (${msg.size}b, ${msg.chunks} chunks)`, "ok");
      break;
    case "share_revoke":
      revokeShared(from, msg.path, msg.id);
      break;
    case "share_list":
      // peer announces currently shared paths (metadata only — re-pull if needed)
      if (Array.isArray(msg.files)) {
        for (const f of msg.files) {
          const key = collabKey(from, f.path);
          if (!sharedFiles.has(key)) {
            sharedFiles.set(key, {
              key,
              path: f.path,
              from,
              fromUser: peers.get(from)?.user || from,
              mime: f.mime,
              size: f.size || 0,
              status: "announced",
              id: f.id,
              updated: Date.now(),
            });
          }
        }
        notifyCollabFs();
      }
      break;
    case "file_chunk": {
      const tr = transfers.get(msg.id);
      if (!tr) break;
      tr.parts[msg.i] = msg.data;
      const got = tr.parts.filter(Boolean).length;
      if (got === tr.total) {
        await assembleTransfer(msg.id);
      }
      break;
    }
    case "collab_open":
      log(`[${from}] collab open ${msg.path}`, "ok");
      if (msg.cursor && msg.path) {
        handleRemoteCursor(from, {
          path: msg.path,
          line: msg.cursor.line,
          column: msg.cursor.column,
          user: msg.user || peers.get(from)?.user,
        });
      }
      break;
    case "collab_edit":
      await applyRemoteEdit(msg);
      break;
    case "collab_cursor":
      handleRemoteCursor(from, msg);
      break;
    case "pmsg":
      handlePmsg(from, msg);
      break;
    case "vc_request":
    case "vc_invite":
      handleVcRequest(from, msg);
      break;
    case "vc_accept":
      await handleVcAccept(from, msg);
      break;
    case "vc_reject":
      log(`[${from}] declined voice ${msg.id || ""}`, "out");
      pendingVc.delete(msg.id);
      break;
    case "vc_signal":
      await handleVcSignal(from, msg);
      break;
    case "vc_leave":
      teardownVcPeer(from);
      log(`[${from}] left voice`, "out");
      break;
    case "fs_pull_req":
      await respondPull(msg);
      break;
    case "fs_push":
      await receivePush(msg, from);
      break;
    case "ping":
      await sendEnc({ t: "pong", ts: Date.now() });
      break;
    case "pong":
      log(`[${from}] pong`, "out");
      break;
    default:
      log(`[${from}] ${msg.t}`, "out");
  }
}

async function assembleTransfer(id) {
  const tr = transfers.get(id);
  if (!tr) return;
  try {
    // ensure all chunks present
    for (let i = 0; i < tr.total; i++) {
      if (tr.parts[i] == null) {
        log(`Share ${id}: missing chunk ${i}/${tr.total}`, "err");
        return;
      }
    }
    const b64 = tr.parts.join("");
    const bytes = fromBase64(b64);
    const orig = tr.path.startsWith("/") ? tr.path : "/" + tr.path;
    const from = tr.from || "peer";
    const key = collabKey(from, orig);
    // Mirror under /collab/<peerId>/...
    const dest = key;
    const parts = dest.split("/").filter(Boolean);
    parts.pop();
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      if (!fs.exists(cur)) {
        try {
          await fs.mkdir(cur, { parents: true });
        } catch {
          try {
            await fs.mkdir(cur);
          } catch {}
        }
      }
    }
    await fs.writeFile(dest, bytes, { mime: tr.mime || "application/octet-stream" });
    sharedFiles.set(key, {
      key,
      path: orig,
      from,
      fromUser: peers.get(from)?.user || from,
      mime: tr.mime,
      size: bytes.length,
      status: "ready",
      id: tr.id || id,
      updated: Date.now(),
    });
    log(`Collab FS ← ${key} (${bytes.length}b)`, "ok");
    transfers.delete(id);
    notifyCollabFs();
    if (window.refreshTree) window.refreshTree();
  } catch (e) {
    log(`Assemble failed: ${e.message}`, "err");
  }
}

async function applyRemoteEdit(msg) {
  if (!collabDoc || collabDoc.path !== msg.path) {
    // Auto-join if we have the file open
    if (window.__n3xnActivePath === msg.path) {
      collabDoc = { path: msg.path, version: msg.v || 0, applying: false };
    } else {
      return;
    }
  }
  if (collabDoc.applying) return;
  if (msg.v != null && collabDoc.version != null && msg.v <= collabDoc.version) return;

  const ed = window.__n3xnEditor;
  if (!ed || window.__n3xnActivePath !== msg.path) {
    // Write to VFS only
    try {
      await fs.writeFile(msg.path, msg.content, { mime: "text/plain" });
      collabDoc.version = msg.v || (collabDoc.version || 0) + 1;
    } catch (e) {
      log(`Remote edit save failed: ${e.message}`, "err");
    }
    return;
  }

  collabDoc.applying = true;
  try {
    const model = ed.getModel();
    if (model && model.getValue() !== msg.content) {
      const pos = ed.getPosition();
      model.setValue(msg.content);
      if (pos) ed.setPosition(pos);
    }
    collabDoc.version = msg.v || (collabDoc.version || 0) + 1;
    // Persist
    await fs.writeFile(msg.path, msg.content);
  } finally {
    collabDoc.applying = false;
  }
}

async function respondPull(msg) {
  try {
    const f = await fs.readFile(msg.path);
    if (!f) {
      await sendEnc({ t: "fs_push", path: msg.path, error: "not found", req: msg.req });
      return;
    }
    // small files inline; large via chunk transfer
    if (f.content.length > 200000) {
      await shareFile(msg.path);
      return;
    }
    await sendEnc({
      t: "fs_push",
      path: msg.path,
      mime: f.mime,
      content: toBase64(f.content),
      req: msg.req,
    });
  } catch (e) {
    await sendEnc({ t: "fs_push", path: msg.path, error: e.message, req: msg.req });
  }
}

async function receivePush(msg, from) {
  if (msg.error) {
    log(`[${from}] pull error ${msg.path}: ${msg.error}`, "err");
    return;
  }
  try {
    const bytes = fromBase64(msg.content);
    const dest = msg.path.startsWith("/") ? msg.path : "/" + msg.path;
    const parts = dest.split("/").filter(Boolean);
    parts.pop();
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      if (!fs.exists(cur)) await fs.mkdir(cur);
    }
    await fs.writeFile(dest, bytes, { mime: msg.mime });
    log(`[${from}] pushed → ${dest} (${bytes.length}b)`, "ok");
    if (window.refreshTree) window.refreshTree();
  } catch (e) {
    log(`Push apply failed: ${e.message}`, "err");
  }
}

async function sendEnc(obj) {
  if (!isConnected()) throw new Error("Not connected");
  const payload = {
    ...obj,
    from: myId || "local",
    ts: Date.now(),
  };
  const encrypted = await encrypt(JSON.stringify(payload), roomKey);
  const envelope = JSON.stringify({ v: 1, e: toBase64(encrypted) });
  ws.send(envelope);
}

export async function chat(text) {
  await sendEnc({ t: "chat", text: String(text) });
  log(`[you] ${text}`, "cmd");
}

/** Share a VFS file to the room (chunked, encrypted) */
export async function shareFile(path) {
  path = path.startsWith("/") ? path : "/" + path;
  const f = await fs.readFile(path);
  if (!f) throw new Error("File not found: " + path);
  const b64 = toBase64(f.content);
  const chunks = [];
  for (let i = 0; i < b64.length; i += CHUNK) {
    chunks.push(b64.slice(i, i + CHUNK));
  }
  const id = crypto.randomUUID().slice(0, 10);
  // local catalog entry (our own share visible in Collab FS)
  if (myId) {
    const key = collabKey(myId, path);
    sharedFiles.set(key, {
      key,
      path,
      from: myId,
      fromUser: db.getCurrentUser() || "you",
      mime: f.mime,
      size: f.content.length,
      status: "ready",
      id,
      updated: Date.now(),
    });
    // also mirror under /collab for consistency
    try {
      await ensureCollabPath(key);
      await fs.writeFile(key, f.content, { mime: f.mime });
    } catch (_) {}
  }
  myShares.set(path, { id, mime: f.mime, size: f.content.length });
  await sendEnc({
    t: "file_meta",
    id,
    path,
    mime: f.mime,
    size: f.content.length,
    chunks: chunks.length,
    user: db.getCurrentUser() || "anon",
  });
  for (let i = 0; i < chunks.length; i++) {
    await sendEnc({ t: "file_chunk", id, i, data: chunks[i] });
    // small yield so UI stays responsive on large files
    if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  notifyCollabFs();
  log(`Shared ${path} (${f.content.length}b, ${chunks.length} chunks) → Collab FS`, "ok");
  return id;
}

async function ensureCollabPath(dest) {
  const parts = dest.split("/").filter(Boolean);
  parts.pop();
  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    if (!fs.exists(cur)) {
      try {
        await fs.mkdir(cur, { parents: true });
      } catch {
        try {
          await fs.mkdir(cur);
        } catch {}
      }
    }
  }
}

export async function unshareFile(path) {
  path = path.startsWith("/") ? path : "/" + path;
  const meta = myShares.get(path);
  myShares.delete(path);
  if (myId) {
    const key = collabKey(myId, path);
    sharedFiles.delete(key);
    try {
      if (fs.exists(key)) await fs.remove(key);
    } catch {}
  }
  await sendEnc({ t: "share_revoke", path, id: meta?.id });
  notifyCollabFs();
  log("Unshared " + path, "ok");
}

function revokeShared(from, path, id) {
  if (!path && id) {
    for (const [k, v] of sharedFiles) {
      if (v.id === id || (v.from === from && v.id === id)) {
        sharedFiles.delete(k);
        try {
          if (fs.exists(k)) fs.remove(k);
        } catch {}
      }
    }
  } else if (path) {
    const key = collabKey(from, path);
    sharedFiles.delete(key);
    try {
      if (fs.exists(key)) fs.remove(key);
    } catch {}
    // also remove any matching
    for (const [k, v] of [...sharedFiles.entries()]) {
      if (v.from === from && v.path === path) {
        sharedFiles.delete(k);
        try {
          if (fs.exists(k)) fs.remove(k);
        } catch {}
      }
    }
  }
  notifyCollabFs();
  if (window.refreshTree) window.refreshTree();
  log(`Collab FS removed share from ${from}: ${path || id}`, "out");
}

/** Open / focus Collab FS (virtual tree of shared files) */
export function openCollabFs() {
  notifyCollabFs();
  if (window.__n3xnOpenCollabFs) window.__n3xnOpenCollabFs();
  log("Collab FS — " + sharedFiles.size + " shared file(s)", "ok");
  return listSharedFiles();
}

function removeSharesFromPeer(peerId) {
  for (const [k, v] of [...sharedFiles.entries()]) {
    if (v.from === peerId) {
      sharedFiles.delete(k);
      try {
        if (fs.exists(k)) fs.remove(k);
      } catch {}
    }
  }
  notifyCollabFs();
  if (window.refreshTree) window.refreshTree();
}

export async function announceMyShares() {
  if (!isConnected() || !myShares.size) return;
  const files = [...myShares.entries()].map(([path, m]) => ({
    path,
    id: m.id,
    mime: m.mime,
    size: m.size,
  }));
  await sendEnc({ t: "share_list", files });
}


/** Request a path from peers */
export async function pullFile(path) {
  const req = crypto.randomUUID().slice(0, 8);
  await sendEnc({ t: "fs_pull_req", path, req });
  log(`Requested ${path} from room`, "out");
}

/** Join collab session on a text file; broadcasts edits */
export async function collabJoin(path) {
  path = path.startsWith("/") ? path : "/" + path;
  collabDoc = { path, version: 0, applying: false };
  const cur = getLocalCursor();
  await sendEnc({
    t: "collab_open",
    path,
    user: db.getCurrentUser() || "anon",
    cursor: cur || undefined,
  });
  log(`Collab session: ${path}`, "ok");
  updateStatusBar();
  hookEditor();
  hookCursor();
  sendLocalCursor(true);
  refreshRemoteCursorsForActiveModel();
}

export function collabLeave() {
  collabDoc = null;
  // hide decorations for other files but keep peer state until leave
  hideAllCursorWidgets();
  updateStatusBar();
  log("Left collab session", "out");
}

let editorHooked = false;
function hookEditor() {
  if (editorHooked) return;
  const ed = window.__n3xnEditor;
  if (!ed) return;
  editorHooked = true;
  let timer = null;
  ed.onDidChangeModelContent(() => {
    if (!collabDoc || collabDoc.applying) return;
    if (window.__n3xnActivePath !== collabDoc.path) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!collabDoc || !isConnected()) return;
      try {
        const content = ed.getValue();
        collabDoc.version = (collabDoc.version || 0) + 1;
        await sendEnc({
          t: "collab_edit",
          path: collabDoc.path,
          content,
          v: collabDoc.version,
        });
        // persist local
        await fs.writeFile(collabDoc.path, content);
      } catch (e) {
        log(`Collab broadcast failed: ${e.message}`, "err");
      }
    }, 350);
  });
}

/* ========== Remote collaborative cursors (Google-Docs style) ========== */

function colorForPeer(id) {
  let h = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CURSOR_PALETTE[h % CURSOR_PALETTE.length];
}

function ensureCursorCss() {
  if (document.getElementById("n3xn-collab-cursor-css")) return;
  const style = document.createElement("style");
  style.id = "n3xn-collab-cursor-css";
  style.textContent = `
.n3xn-remote-caret {
  border-left: 2px solid var(--n3xn-rc, #00f3ff);
  margin-left: -1px;
  pointer-events: none;
}
.n3xn-remote-line {
  background: color-mix(in srgb, var(--n3xn-rc, #00f3ff) 12%, transparent) !important;
}
.n3xn-remote-name {
  pointer-events: none !important;
  user-select: none !important;
  font-size: 10px;
  line-height: 1.25;
  font-family: system-ui, sans-serif;
  padding: 2px 6px;
  border-radius: 3px;
  color: #0a0a0f;
  background: var(--n3xn-rc, #00f3ff);
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  white-space: nowrap;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.95;
  margin-bottom: 2px;
}
`;
  document.head.appendChild(style);
}

function getLocalCursor() {
  const ed = window.__n3xnEditor;
  if (!ed) return null;
  const pos = ed.getPosition();
  if (!pos) return null;
  return { line: pos.lineNumber, column: pos.column };
}

function hookCursor() {
  if (cursorHooked) return;
  const ed = window.__n3xnEditor;
  if (!ed) return;
  cursorHooked = true;
  ensureCursorCss();
  ed.onDidChangeCursorPosition(() => {
    if (!isConnected() || !collabDoc) return;
    if (window.__n3xnActivePath !== collabDoc.path) return;
    if (collabDoc.applying) return;
    scheduleSendLocalCursor();
  });
  // When active file changes, refresh which remote cursors are visible
  try {
    const orig = window.__n3xnOpenFile;
    // lightweight poll via path check on cursor events is enough; also listen content
  } catch (_) {}
}

function scheduleSendLocalCursor() {
  if (cursorSendTimer) return;
  cursorSendTimer = setTimeout(() => {
    cursorSendTimer = null;
    sendLocalCursor(false);
  }, 40); // ~25/sec cap
}

async function sendLocalCursor(force) {
  if (!isConnected() || !collabDoc) return;
  const ed = window.__n3xnEditor;
  if (!ed || window.__n3xnActivePath !== collabDoc.path) return;
  const pos = ed.getPosition();
  if (!pos) return;
  const payload = {
    path: collabDoc.path,
    line: pos.lineNumber,
    column: pos.column,
  };
  if (
    !force &&
    lastSentCursor &&
    lastSentCursor.path === payload.path &&
    lastSentCursor.line === payload.line &&
    lastSentCursor.column === payload.column
  ) {
    return;
  }
  lastSentCursor = payload;
  try {
    await sendEnc({
      t: "collab_cursor",
      path: payload.path,
      line: payload.line,
      column: payload.column,
      user: db.getCurrentUser() || "anon",
    });
  } catch (_) {}
}

function handleRemoteCursor(from, msg) {
  if (!from || from === myId) return;
  if (!msg || !msg.path) return;
  const line = Math.max(1, parseInt(msg.line, 10) || 1);
  const column = Math.max(1, parseInt(msg.column, 10) || 1);
  const user =
    (typeof msg.user === "string" && msg.user) ||
    peers.get(from)?.user ||
    from;
  const prev = remoteCursors.get(from);
  const color = prev?.color || colorForPeer(from);
  const entry = {
    id: from,
    user: String(user).slice(0, 32),
    path: msg.path,
    line,
    column,
    color,
    lastSeen: Date.now(),
    decorationIds: prev?.decorationIds || [],
    widget: prev?.widget || null,
  };
  // store user on peer map
  const p = peers.get(from) || { lastSeen: Date.now() };
  p.user = entry.user;
  p.lastSeen = Date.now();
  peers.set(from, p);

  remoteCursors.set(from, entry);
  if (window.__n3xnActivePath === entry.path) {
    renderRemoteCursor(from);
  } else {
    // not active file — remove visible widgets only
    unrenderRemoteCursor(from, entry);
  }
}

function clampPos(ed, line, column) {
  const model = ed.getModel();
  if (!model) return { lineNumber: 1, column: 1 };
  const maxLine = model.getLineCount();
  const ln = Math.min(Math.max(1, line), maxLine);
  const maxCol = model.getLineMaxColumn(ln);
  const col = Math.min(Math.max(1, column), maxCol);
  return { lineNumber: ln, column: col };
}

function renderRemoteCursor(peerId) {
  const ed = window.__n3xnEditor;
  const entry = remoteCursors.get(peerId);
  if (!ed || !entry || !window.monaco) return;
  ensureCursorCss();
  if (window.__n3xnActivePath !== entry.path) {
    unrenderRemoteCursor(peerId, entry);
    return;
  }

  const pos = clampPos(ed, entry.line, entry.column);
  entry.line = pos.lineNumber;
  entry.column = pos.column;

  const safeId = String(peerId).replace(/[^a-zA-Z0-9_-]/g, "");
  const caretClass = "n3xn-remote-caret n3xn-rc-" + safeId;
  const lineClass = "n3xn-remote-line n3xn-rl-" + safeId;

  // per-peer color CSS vars
  let tag = document.getElementById("n3xn-rc-style-" + safeId);
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "n3xn-rc-style-" + safeId;
    document.head.appendChild(tag);
  }
  tag.textContent = `
.n3xn-rc-${safeId}, .n3xn-rl-${safeId} { --n3xn-rc: ${entry.color}; }
.n3xn-rc-${safeId} { border-left-color: ${entry.color} !important; }
.n3xn-rl-${safeId} { background: ${entry.color}22 !important; }
`;

  const stick =
    monaco.editor.TrackedRangeStickiness?.NeverGrowsWhenTypingAtEdges ?? 1;

  entry.decorationIds = ed.deltaDecorations(entry.decorationIds || [], [
    {
      range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
      options: {
        className: caretClass,
        stickiness: stick,
      },
    },
    {
      range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, 1),
      options: {
        isWholeLine: true,
        className: lineClass,
        stickiness: stick,
      },
    },
  ]);

  // name badge — Monaco content widget anchored to model position
  if (!entry.widget) {
    const dom = document.createElement("div");
    dom.className = "n3xn-remote-name";
    dom.style.background = entry.color;
    dom.textContent = entry.user;
    const widget = {
      allowEditorOverflow: true,
      getId: () => "n3xn-cursor-widget-" + peerId,
      getDomNode: () => dom,
      getPosition: () => {
        const cur = remoteCursors.get(peerId);
        if (!cur) return null;
        const p = clampPos(ed, cur.line, cur.column);
        return {
          position: { lineNumber: p.lineNumber, column: p.column },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        };
      },
    };
    entry.widget = widget;
    entry.domNode = dom;
    ed.addContentWidget(widget);
  } else {
    if (entry.domNode) {
      entry.domNode.textContent = entry.user;
      entry.domNode.style.background = entry.color;
    } else if (entry.widget.getDomNode) {
      const n = entry.widget.getDomNode();
      n.textContent = entry.user;
      n.style.background = entry.color;
    }
    ed.layoutContentWidget(entry.widget);
  }

  remoteCursors.set(peerId, entry);
  // Force layout after decoration update so badge tracks caret
  try {
    ed.layoutContentWidget(entry.widget);
  } catch (_) {}
}

function unrenderRemoteCursor(peerId, entry) {
  const ed = window.__n3xnEditor;
  if (!entry) entry = remoteCursors.get(peerId);
  if (!entry) return;
  if (ed && entry.decorationIds?.length) {
    entry.decorationIds = ed.deltaDecorations(entry.decorationIds, []);
  }
  if (ed && entry.widget) {
    try {
      ed.removeContentWidget(entry.widget);
    } catch (_) {}
    entry.widget = null;
  }
  if (remoteCursors.has(peerId)) {
    const e = remoteCursors.get(peerId);
    e.decorationIds = [];
    e.widget = null;
  }
}

function removeRemoteCursor(peerId) {
  const entry = remoteCursors.get(peerId);
  if (entry) unrenderRemoteCursor(peerId, entry);
  remoteCursors.delete(peerId);
  const safeId = String(peerId).replace(/[^a-zA-Z0-9_-]/g, "");
  document.getElementById("n3xn-rc-style-" + safeId)?.remove();
}

function clearRemoteCursors() {
  for (const id of [...remoteCursors.keys()]) removeRemoteCursor(id);
}

function hideAllCursorWidgets() {
  for (const [id, entry] of remoteCursors) {
    unrenderRemoteCursor(id, entry);
  }
}

export function refreshRemoteCursorsForActiveModel() {
  const path = window.__n3xnActivePath;
  for (const [id, entry] of remoteCursors) {
    if (entry.path === path) renderRemoteCursor(id);
    else unrenderRemoteCursor(id, entry);
  }
}

// Expose refresh when user switches files (editor openFile sets __n3xnActivePath)
if (typeof window !== "undefined") {
  let lastPath = null;
  setInterval(() => {
    const p = window.__n3xnActivePath || null;
    if (p !== lastPath) {
      lastPath = p;
      if (remoteCursors.size) refreshRemoteCursorsForActiveModel();
    }
  }, 400);
}

export async function ping() {
  await sendEnc({ t: "ping", ts: Date.now() });
}



/* ========== Collab v2: private messages + P2P voice ========== */

function shortId(prefix) {
  const a = new Uint8Array(3);
  crypto.getRandomValues(a);
  return (
    prefix +
    "-" +
    [...a].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()
  );
}

/** Parse "Alice, Bob & Charlie" — does not split inside quotes */
export function parseRecipients(str) {
  const s = String(str || "").trim();
  if (!s) return [];
  // split on , or & or && with optional spaces (outside quotes handled by simple strip)
  return s
    .split(/\s*(?:,|&|&&)\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^["']|["']$/g, ""));
}

function resolvePeerIds(names) {
  const out = [];
  const unknown = [];
  for (const name of names) {
    let found = null;
    if (peers.has(name)) found = name;
    else {
      for (const [id, meta] of peers) {
        if ((meta.user || "").toLowerCase() === name.toLowerCase() || id === name) {
          found = id;
          break;
        }
      }
    }
    if (found) out.push(found);
    else unknown.push(name);
  }
  return { ids: [...new Set(out)], unknown };
}

/** Minimal Markdown → safe DOM (no raw HTML) */
export function renderMarkdownSafe(md) {
  const wrap = document.createElement("div");
  wrap.className = "n3xn-md";
  let text = String(md || "").slice(0, PM_MAX_TEXT);
  // escape
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // extract images first ![alt](url)
  const parts = [];
  const imgRe = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+|data:image\/[a-zA-Z+]+;base64,[a-zA-Z0-9+/=]+)\)/g;
  let last = 0;
  let m;
  while ((m = imgRe.exec(text))) {
    parts.push({ type: "text", v: text.slice(last, m.index) });
    parts.push({ type: "img", alt: m[1], src: m[2] });
    last = m.index + m[0].length;
  }
  parts.push({ type: "text", v: text.slice(last) });

  function inlineFormat(s) {
    let h = esc(s);
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    h = h.replace(/\n/g, "<br/>");
    return h;
  }

  for (const p of parts) {
    if (p.type === "text") {
      const span = document.createElement("span");
      span.innerHTML = inlineFormat(p.v);
      wrap.appendChild(span);
    } else if (p.type === "img") {
      const img = document.createElement("img");
      img.alt = p.alt || "image";
      img.referrerPolicy = "no-referrer";
      img.loading = "lazy";
      img.className = "n3xn-pm-img";
      img.style.cssText =
        "max-width:min(280px,90%);max-height:180px;display:block;margin:4px 0;border-radius:4px;border:1px solid #333";
      if (
        p.src.startsWith("https://") ||
        p.src.startsWith("http://") ||
        p.src.startsWith("data:image/")
      ) {
        img.src = p.src;
      } else {
        img.alt = "blocked";
      }
      img.onerror = () => {
        img.replaceWith(document.createTextNode("[image unavailable]"));
      };
      img.onclick = () => {
        try {
          window.open(img.src, "_blank", "noopener,noreferrer");
        } catch (_) {}
      };
      wrap.appendChild(img);
    }
  }
  return wrap;
}

function showPmInTerminal(entry, direction) {
  const head = document.createElement("div");
  head.className = "cmd";
  head.textContent =
    direction === "out"
      ? `PM→ ${entry.toUsers.join(", ")} [${entry.id}]`
      : `PM← ${entry.fromUser || entry.from} [${entry.id}]`;
  const el = document.getElementById("terminal-output");
  if (!el) {
    log(head.textContent + " " + entry.text, "cmd");
    return;
  }
  el.appendChild(head);
  el.appendChild(renderMarkdownSafe(entry.text));
  el.scrollTop = el.scrollHeight;
}

function handlePmsg(from, msg) {
  if (!msg || !msg.id) return;
  // only show if we are a recipient or sender mirror
  const to = Array.isArray(msg.to) ? msg.to : [];
  if (from !== myId && myId && !to.includes(myId) && !to.includes(db.getCurrentUser())) {
    // also match by username on our peer id
    const myUser = db.getCurrentUser();
    if (!to.some((t) => t === myId || t === myUser)) return;
  }
  const entry = {
    id: String(msg.id).slice(0, 16),
    from,
    fromUser: msg.user || peers.get(from)?.user || from,
    to,
    toUsers: msg.toUsers || to,
    text: String(msg.text || "").slice(0, PM_MAX_TEXT),
    replyTo: msg.replyTo || null,
    ts: msg.ts || Date.now(),
  };
  pmHistory.push(entry);
  if (pmHistory.length > 100) pmHistory.shift();
  lastPmId = entry.id;
  showPmInTerminal(entry, "in");
}

export async function sendPmsg(recipientStr, text, { replyTo = null, images = [] } = {}) {
  if (!isConnected()) throw new Error("Not connected");
  const names = parseRecipients(recipientStr);
  if (!names.length) throw new Error("No recipients");
  const { ids, unknown } = resolvePeerIds(names);
  if (unknown.length) throw new Error("Unknown collaborator: " + unknown.join(", "));
  if (!ids.length) throw new Error("No valid recipients in room");

  let body = String(text || "");
  if (images.length > PM_MAX_IMAGES) throw new Error("Too many images. Maximum is 4 per message.");
  for (const img of images) {
    if (img.size > PM_MAX_IMAGE_BYTES) throw new Error("Image exceeds the maximum allowed size (3 MB).");
    if (!String(img.mime || "").startsWith("image/")) throw new Error("Invalid image MIME type.");
    // data URL already compressed by caller
    body += `\n![attach](${img.dataUrl})`;
  }
  if (body.length > PM_MAX_TEXT + PM_MAX_IMAGES * 100) {
    // data urls can be large — check total payload soft limit ~2.5MB encoded later
  }
  const id = shortId("PM");
  const toUsers = names;
  const payload = {
    t: "pmsg",
    id,
    to: ids,
    toUsers,
    user: db.getCurrentUser() || "anon",
    text: body.slice(0, 500000), // hard cap
    replyTo,
  };
  // size guard
  const approx = JSON.stringify(payload).length;
  if (approx > 2_500_000) throw new Error("Message exceeds the maximum allowed size.");

  await sendEnc(payload);
  const entry = {
    id,
    from: myId,
    fromUser: db.getCurrentUser() || "anon",
    to: ids,
    toUsers,
    text: body,
    replyTo,
    ts: Date.now(),
  };
  pmHistory.push(entry);
  lastPmId = id;
  showPmInTerminal(entry, "out");
  return id;
}

export async function replyPmsg(text) {
  const last = [...pmHistory].reverse().find((m) => m.from && m.from !== myId);
  if (!last) throw new Error("No message to reply to");
  log(`Replying to ${last.fromUser}: "${String(last.text).slice(0, 60)}"`, "out");
  return sendPmsg(last.fromUser || last.from, text, { replyTo: last.id });
}

/** Compress image File to data URL under 3MB when possible */
export async function fileToImageAttachment(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Invalid image MIME type.");
  if (file.size > PM_MAX_IMAGE_BYTES * 2) throw new Error("Image exceeds the maximum allowed size (3 MB).");
  const bitmap = await createImageBitmap(file);
  const maxW = 1280;
  const scale = Math.min(1, maxW / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  let quality = 0.82;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > PM_MAX_IMAGE_BYTES * 1.37 && quality > 0.4) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length > PM_MAX_IMAGE_BYTES * 1.37) {
    throw new Error("Image exceeds the maximum allowed size after compression.");
  }
  return { mime: "image/jpeg", dataUrl, size: Math.round(dataUrl.length * 0.75) };
}

/* ----- WebRTC voice (signaling over encrypted WSS only) ----- */

function handleVcRequest(from, msg) {
  const id = msg.id || shortId("VC");
  pendingVc.set(id, {
    id,
    from,
    fromUser: msg.user || peers.get(from)?.user || from,
    message: msg.message || "",
    ts: Date.now(),
  });
  log(
    `${msg.user || from} invited you to voice chat.\nRequest ID: ${id}\nUse: wss vcaccept ${id}`,
    "ok"
  );
}

async function ensureMic() {
  if (vcLocalStream) return vcLocalStream;
  vcLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  if (vcMuted) vcLocalStream.getAudioTracks().forEach((t) => (t.enabled = false));
  return vcLocalStream;
}

async function createPc(peerId) {
  if (vcPeers.has(peerId)) return vcPeers.get(peerId);
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
    let audio = document.getElementById("n3xn-vc-audio-" + peerId);
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = "n3xn-vc-audio-" + peerId;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.style.display = "none";
      document.body.appendChild(audio);
    }
    audio.srcObject = ev.streams[0];
  };
  pc.onconnectionstatechange = () => {
    log(`Voice ${peerId}: ${pc.connectionState}`, "out");
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      // soft
    }
  };
  const stream = await ensureMic();
  stream.getTracks().forEach((tr) => pc.addTrack(tr, stream));
  vcPeers.set(peerId, pc);
  return pc;
}

export async function vcRequest(recipientStr, message = "") {
  if (!isConnected()) throw new Error("Not connected");
  const names = parseRecipients(recipientStr);
  const { ids, unknown } = resolvePeerIds(names);
  if (unknown.length) throw new Error("Unknown collaborator: " + unknown.join(", "));
  if (!ids.length) throw new Error("No recipients");
  const id = shortId("VC");
  await sendEnc({
    t: "vc_invite",
    id,
    to: ids,
    user: db.getCurrentUser() || "anon",
    message: String(message || "").slice(0, 200),
  });
  log(`Voice request sent to ${names.join(", ")}\nRequest ID: ${id}`, "ok");
  // prepare mic early
  try {
    await ensureMic();
  } catch (e) {
    log("Microphone: " + e.message, "err");
  }
  return id;
}

export async function vcAccept(id) {
  if (!id) {
    const latest = [...pendingVc.values()].sort((a, b) => b.ts - a.ts)[0];
    if (!latest) throw new Error("No pending voice request found.");
    id = latest.id;
  }
  const req = pendingVc.get(id);
  if (!req) throw new Error("No pending voice request found.");
  await sendEnc({
    t: "vc_accept",
    id,
    to: req.from,
    user: db.getCurrentUser() || "anon",
  });
  // we create offer after accept — wait for peer to also set up; initiator is acceptor here
  const pc = await createPc(req.from);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sendEnc({
    t: "vc_signal",
    to: req.from,
    kind: "offer",
    sdp: offer,
    id,
  });
  pendingVc.delete(id);
  log(`Accepted voice ${id} with ${req.fromUser}`, "ok");
}

async function handleVcAccept(from, msg) {
  log(`[${from}] accepted voice ${msg.id || ""}`, "ok");
  // remote accepted our invite — wait for their offer or we offer
  const pc = await createPc(from);
  if (pc.signalingState === "stable") {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendEnc({ t: "vc_signal", to: from, kind: "offer", sdp: offer, id: msg.id });
  }
}

async function handleVcSignal(from, msg) {
  if (msg.to && myId && msg.to !== myId) return;
  const pc = await createPc(from);
  try {
    if (msg.kind === "offer" && msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendEnc({ t: "vc_signal", to: from, kind: "answer", sdp: answer, id: msg.id });
    } else if (msg.kind === "answer" && msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
    } else if (msg.kind === "ice" && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (_) {}
    }
  } catch (e) {
    log("WebRTC signal error: " + e.message, "err");
  }
}

function teardownVcPeer(peerId) {
  const pc = vcPeers.get(peerId);
  if (pc) {
    try {
      pc.close();
    } catch (_) {}
    vcPeers.delete(peerId);
  }
  document.getElementById("n3xn-vc-audio-" + peerId)?.remove();
}

export function vcMute() {
  vcMuted = true;
  vcLocalStream?.getAudioTracks().forEach((t) => (t.enabled = false));
  log("Voice muted", "ok");
}
export function vcUnmute() {
  vcMuted = false;
  vcLocalStream?.getAudioTracks().forEach((t) => (t.enabled = true));
  log("Voice unmuted", "ok");
}
export async function vcLeave() {
  for (const id of [...vcPeers.keys()]) {
    try {
      await sendEnc({ t: "vc_leave", to: id });
    } catch (_) {}
    teardownVcPeer(id);
  }
  if (vcLocalStream) {
    vcLocalStream.getTracks().forEach((t) => t.stop());
    vcLocalStream = null;
  }
  log("Left voice chat", "ok");
}
export function vcStatus() {
  return {
    muted: vcMuted,
    peers: [...vcPeers.keys()],
    pending: [...pendingVc.keys()],
    mic: !!vcLocalStream,
  };
}

export function listPeersNamed() {
  return [...peers.entries()].map(([id, m]) => ({ id, user: m.user || id }));
}
