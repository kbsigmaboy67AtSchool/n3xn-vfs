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
      break;
    case "collab_edit":
      await applyRemoteEdit(msg);
      break;
    case "collab_cursor":
      // optional UI later
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
  await sendEnc({ t: "collab_open", path });
  log(`Collab session: ${path}`, "ok");
  updateStatusBar();
  hookEditor();
}

export function collabLeave() {
  collabDoc = null;
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

export async function ping() {
  await sendEnc({ t: "ping", ts: Date.now() });
}
