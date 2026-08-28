/**
 * n3xn VFS v2 — Encrypted IndexedDB + localStorage accounts
 */

import { encrypt, decrypt, toBase64, fromBase64, hashPassword, verifyPassword } from "./crypto.js";

const DB_NAME = "n3xn_vfs_v2";
const DB_VERSION = 1;
const STORE_FILES = "files";
const STORE_META = "meta";

let db = null;
let currentUser = null;
let currentPassword = null;

export function getCurrentUser() {
  return currentUser;
}

export function getPassword() {
  return currentPassword;
}

function openDB(username) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`${DB_NAME}_${username}`, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_FILES)) {
        database.createObjectStore(STORE_FILES, { keyPath: "path" });
      }
      if (!database.objectStoreNames.contains(STORE_META)) {
        database.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ========== ACCOUNTS (localStorage, encrypted metadata) ========== */

export function listAccounts() {
  try {
    const raw = localStorage.getItem("n3xn_accounts");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAccounts(list) {
  localStorage.setItem("n3xn_accounts", JSON.stringify(list));
}

export async function createAccount(username, password) {
  const accounts = listAccounts();
  if (accounts.find((a) => a.username === username)) {
    throw new Error("Account already exists");
  }
  const creds = await hashPassword(password);
  accounts.push({
    username,
    ...creds,
    created: Date.now(),
  });
  saveAccounts(accounts);

  // Initialize empty FS
  const database = await openDB(username);
  const tx = database.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put({ key: "root", value: { type: "dir", children: {} } });
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  database.close();
  return true;
}

export async function login(username, password) {
  const accounts = listAccounts();
  const acc = accounts.find((a) => a.username === username);
  if (!acc) throw new Error("Account not found");
  const ok = await verifyPassword(password, acc);
  if (!ok) throw new Error("Invalid password");

  db = await openDB(username);
  currentUser = username;
  currentPassword = password;
  return true;
}

export function logout() {
  if (db) {
    db.close();
    db = null;
  }
  currentUser = null;
  currentPassword = null;
}

/* ========== ENCRYPTED FILE STORAGE ========== */

export async function putFile(path, content, meta = {}) {
  if (!db || !currentPassword) throw new Error("Not logged in");

  let data;
  if (typeof content === "string") {
    data = new TextEncoder().encode(content);
  } else if (content instanceof ArrayBuffer) {
    data = new Uint8Array(content);
  } else if (content instanceof Uint8Array) {
    data = content;
  } else {
    data = new TextEncoder().encode(JSON.stringify(content));
  }

  const encrypted = await encrypt(data, currentPassword);
  const record = {
    path,
    data: toBase64(encrypted),
    size: data.length,
    mime: meta.mime || guessMime(path),
    modified: Date.now(),
    ...meta,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readwrite");
    tx.objectStore(STORE_FILES).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getFile(path) {
  if (!db || !currentPassword) throw new Error("Not logged in");

  return new Promise(async (resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readonly");
    const req = tx.objectStore(STORE_FILES).get(path);
    req.onsuccess = async () => {
      const record = req.result;
      if (!record) {
        resolve(null);
        return;
      }
      try {
        const encrypted = fromBase64(record.data);
        const plain = await decrypt(encrypted, currentPassword);
        resolve({
          ...record,
          content: plain,
          text: () => new TextDecoder().decode(plain),
        });
      } catch (e) {
        reject(new Error("Decryption failed — wrong password or corrupted data"));
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFile(path) {
  if (!db) throw new Error("Not logged in");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readwrite");
    tx.objectStore(STORE_FILES).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listAllFiles() {
  if (!db) throw new Error("Not logged in");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readonly");
    const req = tx.objectStore(STORE_FILES).getAll();
    req.onsuccess = () => {
      // Return metadata only (no decryption of content)
      resolve(
        req.result.map((r) => ({
          path: r.path,
          size: r.size,
          mime: r.mime,
          modified: r.modified,
        }))
      );
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getMeta(key) {
  if (!db) throw new Error("Not logged in");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(key, value) {
  if (!db) throw new Error("Not logged in");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ========== FULL ENCRYPTED EXPORT / IMPORT ========== */

export async function exportEverything(includeAccounts = true) {
  if (!currentPassword) throw new Error("Not logged in");

  const files = await listAllFiles();
  const fileData = {};
  for (const f of files) {
    const full = await getFile(f.path);
    if (full) {
      fileData[f.path] = {
        size: full.size,
        mime: full.mime,
        modified: full.modified,
        content: toBase64(full.content), // already decrypted, re-encrypt outer
      };
    }
  }

  const payload = {
    version: 2,
    username: currentUser,
    exported: Date.now(),
    files: fileData,
    meta: {
      root: await getMeta("root"),
    },
  };

  if (includeAccounts) {
    payload.accounts = listAccounts();
  }

  // Outer encryption of the whole export
  const encrypted = await encrypt(JSON.stringify(payload), currentPassword);
  return {
    n3xn: true,
    version: 2,
    encrypted: toBase64(encrypted),
  };
}

export async function importEverything(json, password) {
  let data;
  if (json.encrypted) {
    const plain = await decrypt(fromBase64(json.encrypted), password);
    data = JSON.parse(new TextDecoder().decode(plain));
  } else {
    data = json;
  }

  if (!data.username) throw new Error("Invalid export");

  // Ensure account exists or create
  const accounts = listAccounts();
  if (!accounts.find((a) => a.username === data.username)) {
    // Create with provided password
    await createAccount(data.username, password);
  }

  await login(data.username, password);

  // Restore files
  for (const [path, info] of Object.entries(data.files || {})) {
    const content = fromBase64(info.content);
    await putFile(path, content, {
      mime: info.mime,
      modified: info.modified,
    });
  }

  if (data.meta?.root) {
    await setMeta("root", data.meta.root);
  }

  return data.username;
}

function guessMime(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  const map = {
    txt: "text/plain",
    md: "text/markdown",
    js: "application/javascript",
    mjs: "text/javascript",
    ts: "application/typescript",
    json: "application/json",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    py: "text/x-python",
    sh: "application/x-sh",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    pdf: "application/pdf",
    zip: "application/zip",
    wasm: "application/wasm",
  };
  return map[ext] || "application/octet-stream";
}
