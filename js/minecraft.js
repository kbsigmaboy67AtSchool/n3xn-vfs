/**
 * Chromebook Minecraft helper
 * Release assets cannot be fetched() from the browser (CORS + proxy blocks).
 * Strategy: native browser download (top-level navigation) + local import to seed /mc.html.
 * Upstream host/repo are never printed in UI.
 */

const TAG_GAME = "MINECRAFT";
const TAG_SKINS = "minecraft_skins";
const SHELL_CACHES = ["n3xn-shell-v11", "n3xn-shell-v10", "n3xn-shell-v9", "n3xn-shell-v8"];

/** Optional CF Pages fetch-proxy (user-owned). Empty = disabled. */
const FETCH_PROXY_KEY = "n3xn_fetch_proxy";
const FETCH_PROXY_ON_KEY = "n3xn_fetch_proxy_on";
const DEFAULT_PROXY = "https://git-5y9.pages.dev/$/";

export function getFetchProxy() {
  try {
    const v = localStorage.getItem(FETCH_PROXY_KEY);
    if (v === "") return ""; // explicitly cleared
    if (v) return v.endsWith("/") ? v : v + "/";
  } catch (_) {}
  return DEFAULT_PROXY;
}

export function setFetchProxy(url) {
  if (url == null || url === "off" || url === "clear") {
    localStorage.setItem(FETCH_PROXY_KEY, "");
    localStorage.setItem(FETCH_PROXY_ON_KEY, "0");
    return "";
  }
  let u = String(url).trim();
  if (!u.endsWith("/")) u += "/";
  localStorage.setItem(FETCH_PROXY_KEY, u);
  localStorage.setItem(FETCH_PROXY_ON_KEY, "1");
  return u;
}

export function isProxyEnabled() {
  try {
    // External proxy defaults OFF — use built-in /__proxy__ instead
    if (localStorage.getItem(FETCH_PROXY_ON_KEY) === "1") return true;
    return false;
  } catch {
    return false;
  }
}

export function setProxyEnabled(on) {
  localStorage.setItem(FETCH_PROXY_ON_KEY, on ? "1" : "0");
  return isProxyEnabled();
}

/** Build proxied URL: base + github.com/user/repo/releases/... */
function proxiedUrl(tag, file) {
  const base = getFetchProxy();
  if (!base) return null;
  const host = ["git", "hub", ".com"].join("");
  const user = ["kbsigmaboy", "67AtSchool"].join("");
  const path = `${host}/${user}/minecraft/releases/download/${tag}/${file}`;
  // base already ends with $/ or similar
  if (base.includes("$/")) return base + path;
  return base + path;
}

function upstreamUrl(tag, file) {
  const host = ["git", "hub", ".com"].join("");
  const user = ["kbsigmaboy", "67AtSchool"].join("");
  return `https://${host}/${user}/minecraft/releases/download/${tag}/${encodeURIComponent(file).replace(/%2F/gi, "/")}`;
}

/** Same-origin CF proxy path (works only if _redirects 200 proxy is live) */
function siteProxyUrl(tag, file) {
  return `/github-assets/${tag}/${file}`;
}

/** Built-in n3xn Pages Function proxy (JS-only, navigation → 404) */
function internalProxyUrl(tag, file) {
  const host = ["git", "hub", ".com"].join("");
  const user = ["kbsigmaboy", "67AtSchool"].join("");
  return `/__proxy__/$/${host}/${user}/minecraft/releases/download/${tag}/${file}`;
}

async function tryInternalProxy(tag, file, onProgress) {
  const url = internalProxyUrl(tag, file);
  onProgress?.("Trying n3xn internal proxy…");
  const res = await fetch(url, {
    credentials: "same-origin",
    redirect: "follow",
    headers: {
      "X-N3xn-Proxy": "1",
      Accept: "*/*",
    },
  });
  if (!res.ok) throw new Error("Internal proxy HTTP " + res.status);
  const buf = await res.arrayBuffer();
  if (file.endsWith(".html") && buf.byteLength < 500_000) {
    throw new Error("Internal proxy returned non-game file (" + buf.byteLength + " b)");
  }
  return buf;
}

export const MC_VERSIONS = [
  { id: "1.8-better", file: "Xclounkit234X.wasm-gc.1.8.better.version.html", label: "1.8 WASM-GC better (recommended)", size: "~24 MB", recommend: true },
  { id: "1.8", file: "Xclounkit234X.MINECRAFT.1.8.html", label: "1.8 classic", size: "~14 MB" },
  { id: "1.12", file: "Xclounkit234X.MINECRAFT.1.12.html", label: "1.12", size: "~19 MB" },
  { id: "1.14", file: "Xclounkit234X.MINECRAFT.1.14.4.html", label: "1.14.4", size: "~34 MB" },
  { id: "1.16", file: "Xclounkit234X.MINECRAFT.1.16.html", label: "1.16 WASM-GC", size: "~51 MB" },
  { id: "1.20.6", file: "Xclounkit234X.MINECRAFT.1.20.6.html", label: "1.20.6", size: "~53 MB" },
  { id: "1.21.11", file: "Xclounkit234X.MINECRAFT.1.21.11.html", label: "1.21.11", size: "~47 MB" },
  { id: "1.21.11-mobile", file: "1.21.11-mobile.html", label: "1.21.11 mobile", size: "~47 MB" },
  { id: "1.21.11-desktop", file: "1.21.11-desktop.html", label: "1.21.11 desktop", size: "~47 MB" },
  { id: "26.2", file: "26.2.html", label: "26.2 experimental", size: "~72 MB" },
  { id: "0.6.1-pe", file: "0.6.1-pe.html", label: "0.6.1 PE", size: "~17 MB" },
  { id: "1.6.4-wasm", file: "1.6.4-modpack-wasm.html", label: "1.6.4 modpack WASM", size: "~58 MB" },
];

export const MC_SKINS = [
  "----24308483.png",
  "----scar-male-----24317991.png",
  "academic-red-24319080.png",
  "allium-24321608.png",
  "blush-24306939.png",
  "cookie-24316464.png",
  "cyan-24314809.png",
  "ghost-24312265.png",
  "god-madoka-24310993.png",
  "headshot-24319935.png",
  "lilith---ssrp-24320844.png",
  "mage-x-24318759.png",
  "silver-bellsssss-24318599.png",
  "wish-24287543.png",
];

function resolveVersion(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return MC_VERSIONS.find((v) => v.recommend) || MC_VERSIONS[0];
  const byNum = MC_VERSIONS[Number(k) - 1];
  if (byNum) return byNum;
  return (
    MC_VERSIONS.find((v) => v.id === k) ||
    MC_VERSIONS.find(
      (v) =>
        v.id.includes(k) ||
        v.file.toLowerCase().includes(k) ||
        v.label.toLowerCase().includes(k)
    )
  );
}

export function listVersions() {
  return MC_VERSIONS.map((v, i) => ({
    n: i + 1,
    id: v.id,
    label: v.label,
    size: v.size,
    recommend: !!v.recommend,
  }));
}

export function listSkins() {
  return MC_SKINS.slice();
}

/** Trigger a real browser download (no fetch / no CORS). */
export function browserDownload(tag, file) {
  const url = upstreamUrl(tag, file);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  // download attr often ignored cross-origin; still opens the release asset
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { filename: file, method: "browser-download" };
}

/**
 * Seed SW cache + optional VFS so /mc.html works offline.
 */
export async function seedMcHtml(buf, filename = "minecraft.html") {
  if (!(buf instanceof ArrayBuffer) && !(buf instanceof Uint8Array)) {
    throw new Error("seedMcHtml expects ArrayBuffer");
  }
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength < 500_000) {
    throw new Error("File too small to be a Minecraft HTML build (" + bytes.byteLength + " bytes)");
  }
  const sample = new TextDecoder().decode(bytes.slice(0, 4000)).toLowerCase();
  if (sample.includes("n3xn virtual") || sample.includes('id="app"')) {
    throw new Error("That file looks like the n3xn site shell, not Minecraft");
  }

  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const html = () =>
    new Response(body.slice(0), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-N3xn-Mc": "1",
        "Cache-Control": "public, max-age=31536000",
      },
    });

  if ("caches" in self) {
    for (const name of SHELL_CACHES) {
      try {
        const cache = await caches.open(name);
        await cache.put(location.origin + "/mc.html", html());
        await cache.put("/mc.html", html());
      } catch (_) {}
    }
  }

  // Also stash in VFS if available
  try {
    const fs = await import("./fs.js");
    await fs.mkdir("/minecraft", { parents: true });
    await fs.writeFile("/minecraft/" + filename, new Uint8Array(body), {
      mime: "text/html",
    });
  } catch (_) {}

  return { size: bytes.byteLength, filename };
}

/** File picker → seed /mc.html → optional open */
export function importLocalFile({ open = true } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".html,text/html,application/octet-stream";
    input.onchange = async () => {
      try {
        const file = input.files && input.files[0];
        if (!file) return reject(new Error("No file chosen"));
        const buf = await file.arrayBuffer();
        const seeded = await seedMcHtml(buf, file.name || "minecraft.html");
        if (open) {
          window.open("/mc.html", "_blank");
        }
        resolve(seeded);
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

/**
 * Try same-origin /github-assets proxy (CF _redirects on this site).
 */
export async function trySiteProxyFetch(tag, file, onProgress) {
  const url = siteProxyUrl(tag, file);
  onProgress?.("Trying site proxy…");
  const res = await fetch(url, { credentials: "omit", redirect: "follow" });
  if (!res.ok) throw new Error("Site proxy HTTP " + res.status);
  const buf = await res.arrayBuffer();
  if (file.endsWith(".html") && buf.byteLength < 500_000) {
    throw new Error("Site proxy returned non-game file (" + buf.byteLength + " b)");
  }
  return buf;
}

/**
 * Optional user CF Pages fetch-proxy (e.g. git-*.pages.dev/$/…).
 * Uses credentials:include so a prior passcode unlock on that origin may apply.
 * ONE successful download → seed /mc.html → never need proxy again for offline play.
 */
export async function tryUserFetchProxy(tag, file, onProgress) {
  if (!isProxyEnabled()) throw new Error("User fetch-proxy disabled");
  const url = proxiedUrl(tag, file);
  if (!url) throw new Error("No fetch-proxy configured");
  onProgress?.("Trying your fetch-proxy (one-shot; then cached)…");
  const res = await fetch(url, {
    credentials: "include",
    mode: "cors",
    redirect: "follow",
  });
  if (!res.ok) throw new Error("Fetch-proxy HTTP " + res.status);
  const buf = await res.arrayBuffer();
  if (file.endsWith(".html") && buf.byteLength < 500_000) {
    throw new Error("Fetch-proxy returned non-game file (" + buf.byteLength + " b)");
  }
  return buf;
}

export async function fetchMcAsset(kind, key, onProgress) {
  let file, filename, tag;
  if (kind === "skin") {
    const name = MC_SKINS.find((s) => s === key || s.includes(key)) || key;
    file = name;
    filename = name.endsWith(".png") ? name : name + ".png";
    tag = TAG_SKINS;
  } else {
    const v = resolveVersion(key);
    if (!v) throw new Error("Unknown version. Run: minecraft list");
    file = v.file;
    filename = v.file;
    tag = TAG_GAME;
  }

  const finish = async (buf, method) => {
    const mime = filename.endsWith(".png") ? "image/png" : "text/html; charset=utf-8";
    const blob = new Blob([buf], { type: mime });
    if (filename.endsWith(".html") && (filename.includes("wasm-gc.1.8.better") || kind === "game")) {
      try {
        await seedMcHtml(buf, filename);
        onProgress?.("Cached as /mc.html — offline play will not use the proxy again");
      } catch (_) {}
    }
    return {
      blob,
      blobUrl: URL.createObjectURL(blob),
      filename,
      size: buf.byteLength,
      mime,
      method,
    };
  };

  // 0) Already in SW cache as /mc.html for recommended build?
  if (kind === "game" && filename.includes("wasm-gc.1.8.better") && "caches" in self) {
    try {
      for (const name of SHELL_CACHES) {
        const cache = await caches.open(name);
        const hit = (await cache.match("/mc.html")) || (await cache.match(location.origin + "/mc.html"));
        if (!hit) continue;
        if (hit.headers.get("X-N3xn-Mc") === "0") continue;
        const buf = await hit.arrayBuffer();
        if (buf.byteLength > 500_000) {
          onProgress?.("Using cached /mc.html (0 proxy bandwidth)");
          return finish(buf, "sw-cache");
        }
      }
    } catch (_) {}
  }

  // 1) Built-in /__proxy__/$/… (Pages Function, JS-only)
  try {
    return await finish(await tryInternalProxy(tag, file, onProgress), "n3xn-proxy");
  } catch (e) {
    onProgress?.("n3xn proxy skip: " + (e.message || e));
  }

  // 2) same-origin /github-assets on this site
  try {
    return await finish(await trySiteProxyFetch(tag, file, onProgress), "site-proxy");
  } catch (e) {
    onProgress?.("Site proxy skip: " + (e.message || e));
  }

  // 3) Optional external user fetch-proxy (git-*.pages.dev) — off if you want to save quota
  try {
    return await finish(await tryUserFetchProxy(tag, file, onProgress), "user-proxy");
  } catch (e) {
    onProgress?.("Fetch-proxy skip: " + (e.message || e));
  }

  // 3) Browser download + import (0 CF proxy bandwidth)
  browserDownload(tag, file);
  const err = new Error(
    "Auto-fetch blocked. Browser download started. When done: minecraft import"
  );
  err.code = "NEED_IMPORT";
  err.filename = filename;
  throw err;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  const u = URL.createObjectURL(blob);
  a.href = u;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 30_000);
}

export async function openMcInTab(key) {
  try {
    const { blobUrl, filename, method } = await fetchMcAsset("game", key);
    window.open(blobUrl, "_blank");
    return { blobUrl, filename, method };
  } catch (e) {
    if (e && e.code === "NEED_IMPORT") {
      // Download already started; tell caller to import
      throw e;
    }
    throw e;
  }
}

export function openOfflineMc() {
  window.open("/mc.html", "_blank");
}

export function openN3xnChat() {
  window.open("/n3xn-chat.html", "_blank");
}

/** Load from VFS path into /mc.html cache and open */
export async function loadFromVfs(path) {
  const fs = await import("./fs.js");
  const f = await fs.readFile(path);
  let buf;
  if (f instanceof ArrayBuffer) buf = f;
  else if (f?.content instanceof ArrayBuffer) buf = f.content;
  else if (f?.content instanceof Uint8Array) buf = f.content.buffer;
  else if (typeof f?.text === "function") buf = new TextEncoder().encode(f.text()).buffer;
  else if (typeof f === "string") buf = new TextEncoder().encode(f).buffer;
  else throw new Error("Cannot read VFS file: " + path);
  await seedMcHtml(buf, path.split("/").pop() || "minecraft.html");
  openOfflineMc();
  return { path, size: buf.byteLength };
}
