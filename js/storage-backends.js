/**
 * n3xn VFS v2 — Pluggable storage backends
 * IndexedDB (default), OPFS, Cache API, memory (session)
 */

import * as db from "./db.js";
import { encrypt, decrypt, toBase64, fromBase64 } from "./crypto.js";

const backends = {
  idb: {
    id: "idb",
    label: "IndexedDB (encrypted, default)",
    async put(path, bytes, meta) {
      return db.putFile(path, bytes, meta);
    },
    async get(path) {
      return db.getFile(path);
    },
    async del(path) {
      return db.deleteFile(path);
    },
    async list() {
      return db.listAllFiles();
    },
  },
  memory: {
    id: "memory",
    label: "Memory (session only, not durable)",
    _map: new Map(),
    async put(path, bytes, meta = {}) {
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      this._map.set(path, {
        path,
        content: data,
        size: data.length,
        mime: meta.mime || "application/octet-stream",
        modified: Date.now(),
        ...meta,
      });
    },
    async get(path) {
      const r = this._map.get(path);
      if (!r) return null;
      return { ...r, text: () => new TextDecoder().decode(r.content) };
    },
    async del(path) {
      this._map.delete(path);
    },
    async list() {
      return [...this._map.values()].map(({ path, size, mime, modified }) => ({
        path,
        size,
        mime,
        modified,
      }));
    },
  },
  cache: {
    id: "cache",
    label: "Cache API (fast, not strongly durable)",
    _name: "n3xn-gh-cache-v1",
    async _c() {
      return caches.open(this._name);
    },
    async put(path, bytes, meta = {}) {
      const c = await this._c();
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const headers = new Headers({
        "content-type": meta.mime || "application/octet-stream",
        "x-n3xn-path": path,
        "x-n3xn-modified": String(Date.now()),
      });
      await c.put(
        new Request("https://n3xn.local/gh" + encodeURI(path)),
        new Response(data, { headers })
      );
    },
    async get(path) {
      const c = await this._c();
      const res = await c.match(new Request("https://n3xn.local/gh" + encodeURI(path)));
      if (!res) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const mime = res.headers.get("content-type") || "application/octet-stream";
      return {
        path,
        content: buf,
        size: buf.length,
        mime,
        modified: Number(res.headers.get("x-n3xn-modified") || Date.now()),
        text: () => new TextDecoder().decode(buf),
      };
    },
    async del(path) {
      const c = await this._c();
      await c.delete(new Request("https://n3xn.local/gh" + encodeURI(path)));
    },
    async list() {
      const c = await this._c();
      const keys = await c.keys();
      const out = [];
      for (const req of keys) {
        const u = new URL(req.url);
        const path = decodeURI(u.pathname.replace(/^\/gh/, "") || "/");
        const res = await c.match(req);
        if (!res) continue;
        out.push({
          path,
          size: Number(res.headers.get("content-length") || 0),
          mime: res.headers.get("content-type"),
          modified: Number(res.headers.get("x-n3xn-modified") || 0),
        });
      }
      return out;
    },
  },
  opfs: {
    id: "opfs",
    label: "OPFS (Origin Private File System)",
    async _root() {
      if (!navigator.storage?.getDirectory) throw new Error("OPFS not supported in this browser");
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle("n3xn-gh", { create: true });
    },
    async _walk(path) {
      const parts = path.split("/").filter(Boolean);
      let dir = await this._root();
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      return { dir, name: parts[parts.length - 1] || "root" };
    },
    async put(path, bytes, meta = {}) {
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const { dir, name } = await this._walk(path);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
      // side meta in idb if logged in
      try {
        await db.setMeta("opfs-meta:" + path, { mime: meta.mime, modified: Date.now(), size: data.length });
      } catch (_) {}
    },
    async get(path) {
      try {
        const { dir, name } = await this._walk(path);
        const fh = await dir.getFileHandle(name);
        const file = await fh.getFile();
        const buf = new Uint8Array(await file.arrayBuffer());
        let meta = {};
        try {
          meta = (await db.getMeta("opfs-meta:" + path)) || {};
        } catch (_) {}
        return {
          path,
          content: buf,
          size: buf.length,
          mime: meta.mime || file.type || "application/octet-stream",
          modified: meta.modified || file.lastModified,
          text: () => new TextDecoder().decode(buf),
        };
      } catch {
        return null;
      }
    },
    async del(path) {
      const { dir, name } = await this._walk(path);
      await dir.removeEntry(name).catch(() => {});
    },
    async list() {
      // shallow listing is limited; rely on db meta keys
      try {
        const all = await db.listAllFiles();
        // not accurate for pure opfs; return empty if no indexing
        return [];
      } catch {
        return [];
      }
    },
  },
};

let active = "idb";

export function listBackends() {
  return Object.values(backends).map((b) => ({ id: b.id, label: b.label }));
}

export function setBackend(id) {
  if (!backends[id]) throw new Error("Unknown backend: " + id);
  active = id;
  try {
    localStorage.setItem("n3xn_storage_backend", id);
  } catch (_) {}
}

export function getBackendId() {
  try {
    const s = localStorage.getItem("n3xn_storage_backend");
    if (s && backends[s]) active = s;
  } catch (_) {}
  return active;
}

export function getBackend() {
  getBackendId();
  return backends[active];
}

/** Encrypted secret bag in IDB meta (token, etc.) */
export async function setSecret(key, value, password) {
  const enc = await encrypt(JSON.stringify(value), password);
  await db.setMeta("secret:" + key, toBase64(enc));
}

export async function getSecret(key, password) {
  const b64 = await db.getMeta("secret:" + key);
  if (!b64) return null;
  const plain = await decrypt(fromBase64(b64), password);
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function deleteSecret(key) {
  await db.setMeta("secret:" + key, null);
}


/** System / sensitive meta keys — warn before edit/delete */
export function isSystemPath(pathOrKey) {
  const s = String(pathOrKey || "");
  return (
    /^secret:/i.test(s) ||
    /^monaco_/i.test(s) ||
    /^github_/i.test(s) ||
    /^shell_aliases$/i.test(s) ||
    /^custom_commands$/i.test(s) ||
    /^opfs-meta:/i.test(s) ||
    s.includes("/.n3xn/") ||
    s.startsWith("/__n3xn")
  );
}

export async function idbListFiles() {
  return db.listAllFiles();
}

export async function idbGetMetaKeys() {
  // best-effort: read known keys + scan via list if available
  const known = [
    "root",
    "monaco_settings_global",
    "monaco_presets",
    "shell_aliases",
    "custom_commands",
    "github_current_repo",
  ];
  const out = [];
  for (const k of known) {
    try {
      const v = await db.getMeta(k);
      if (v != null) out.push({ key: k, system: isSystemPath(k) });
    } catch {}
  }
  // secrets
  try {
    const sec = await db.getMeta("secret:github_pat");
    if (sec != null) out.push({ key: "secret:github_pat", system: true });
  } catch {}
  return out;
}

export async function storageInfo() {
  const info = {
    active: getBackendId(),
    backends: listBackends(),
    idbFiles: 0,
    idbBytes: 0,
    quota: null,
  };
  try {
    const files = await db.listAllFiles();
    info.idbFiles = files.length;
    info.idbBytes = files.reduce((a, f) => a + (f.size || 0), 0);
  } catch {}
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      info.quota = {
        usage: e.usage,
        quota: e.quota,
      };
    }
  } catch {}
  return info;
}

/** Experimental large-file patch (disabled by default) */
let experimentalPatch = false;
export function setExperimentalPatch(on) {
  experimentalPatch = !!on;
}
export function getExperimentalPatch() {
  return experimentalPatch;
}
