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
let collabDoc = null; // { path, version, applying }
let statusEl = null;
/** @type {Map<string, { id, user, path, line, column, color, lastSeen, decorationIds, widget }>} */
const remoteCursors = new Map();
let cursorSendTimer = null;
let lastSentCursor = null; // { path, line, column }
let cursorHooked = false;
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
      log(`[${from}] bye`, "out");
      updateStatusBar();
      break;
    case "chat":
      log(`[${from}] ${msg.text}`, "cmd");
      break;
    case "file_meta":
      transfers.set(msg.id, {
        path: msg.path,
        mime: msg.mime,
        total: msg.chunks,
        size: msg.size,
        from,
        parts: new Array(msg.chunks),
      });
      log(`[${from}] file offer: ${msg.path} (${msg.size}b, ${msg.chunks} chunks)`, "ok");
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
    const b64 = tr.parts.join("");
    const bytes = fromBase64(b64);
    const dest = tr.path.startsWith("/") ? tr.path : "/" + tr.path;
    // ensure parents
    const parts = dest.split("/").filter(Boolean);
    parts.pop();
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      if (!fs.exists(cur)) await fs.mkdir(cur);
    }
    await fs.writeFile(dest, bytes, { mime: tr.mime });
    log(`Received file → ${dest} (${bytes.length}b) from ${tr.from}`, "ok");
    transfers.delete(id);
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
  const f = await fs.readFile(path);
  if (!f) throw new Error("File not found: " + path);
  const b64 = toBase64(f.content);
  const chunks = [];
  for (let i = 0; i < b64.length; i += CHUNK) {
    chunks.push(b64.slice(i, i + CHUNK));
  }
  const id = crypto.randomUUID().slice(0, 10);
  await sendEnc({
    t: "file_meta",
    id,
    path,
    mime: f.mime,
    size: f.content.length,
    chunks: chunks.length,
  });
  for (let i = 0; i < chunks.length; i++) {
    await sendEnc({ t: "file_chunk", id, i, data: chunks[i] });
  }
  log(`Shared ${path} (${f.content.length}b, ${chunks.length} chunks)`, "ok");
  return id;
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
  pointer-events: none;
  user-select: none;
  font-size: 10px;
  line-height: 1.2;
  font-family: system-ui, sans-serif;
  padding: 1px 5px;
  border-radius: 3px;
  color: #0a0a0f;
  background: var(--n3xn-rc, #00f3ff);
  box-shadow: 0 1px 4px rgba(0,0,0,0.45);
  white-space: nowrap;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  transform: translateY(-100%);
  opacity: 0.95;
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

  // name badge content widget
  if (!entry.widget) {
    const dom = document.createElement("div");
    dom.className = "n3xn-remote-name";
    dom.style.setProperty("--n3xn-rc", entry.color);
    dom.style.background = entry.color;
    dom.textContent = entry.user;
    entry.widget = {
      domNode: dom,
      getId: () => "n3xn-cursor-widget-" + peerId,
      getDomNode: () => dom,
      getPosition: () => ({
        position: { lineNumber: entry.line, column: entry.column },
        preference: [
          monaco.editor.ContentWidgetPositionPreference.ABOVE,
          monaco.editor.ContentWidgetPositionPreference.BELOW,
        ],
      }),
    };
    ed.addContentWidget(entry.widget);
  } else {
    entry.widget.domNode.textContent = entry.user;
    entry.widget.domNode.style.background = entry.color;
    ed.layoutContentWidget(entry.widget);
  }

  remoteCursors.set(peerId, entry);
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
