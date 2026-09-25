/**
 * Chromebook Minecraft helper
 * All upstream mapping is server-side via /__proxy__/mc/<id>
 * Client never constructs or opens github.com URLs.
 */

const SHELL_CACHES = ["n3xn-shell-v11", "n3xn-shell-v10", "n3xn-shell-v9", "n3xn-shell-v8"];

export const MC_VERSIONS = [
  { id: "1.8-better", label: "1.8 WASM-GC better (recommended)", size: "~24 MB", recommend: true },
  { id: "1.8", label: "1.8 classic", size: "~14 MB" },
  { id: "1.12", label: "1.12", size: "~19 MB" },
  { id: "1.14", label: "1.14.4", size: "~34 MB" },
  { id: "1.16", label: "1.16 WASM-GC", size: "~51 MB" },
  { id: "1.20.6", label: "1.20.6", size: "~53 MB" },
  { id: "1.21.11", label: "1.21.11", size: "~47 MB" },
  { id: "1.21.11-mobile", label: "1.21.11 mobile", size: "~47 MB" },
  { id: "1.21.11-desktop", label: "1.21.11 desktop", size: "~47 MB" },
  { id: "26.2", label: "26.2 experimental", size: "~72 MB" },
  { id: "0.6.1-pe", label: "0.6.1 PE", size: "~17 MB" },
  { id: "1.6.4-wasm", label: "1.6.4 modpack WASM", size: "~58 MB" },
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
    MC_VERSIONS.find((v) => v.id.includes(k) || v.label.toLowerCase().includes(k))
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

/** Opaque same-origin proxy URL — no upstream host in the path */
function mcProxyUrl(id) {
  return `/__proxy__/mc/${encodeURIComponent(id)}`;
}

function skinProxyUrl(file) {
  return `/__proxy__/skin/${encodeURIComponent(file)}`;
}

async function proxyFetch(url, onProgress, label) {
  onProgress?.(label || "Downloading via n3xn proxy…");
  const res = await fetch(url, {
    credentials: "same-origin",
    redirect: "follow",
    headers: {
      "X-N3xn-Proxy": "1",
      Accept: "*/*",
    },
  });
  if (!res.ok) throw new Error("Proxy HTTP " + res.status);
  const buf = await res.arrayBuffer();
  return buf;
}

export async function seedMcHtml(buf, filename = "minecraft.html") {
  if (!(buf instanceof ArrayBuffer) && !(buf instanceof Uint8Array)) {
    throw new Error("seedMcHtml expects ArrayBuffer");
  }
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength < 500_000) {
    throw new Error("File too small (" + bytes.byteLength + " bytes)");
  }
  const sample = new TextDecoder().decode(bytes.slice(0, 4000)).toLowerCase();
  if (sample.includes("n3xn virtual") || sample.includes('id="app"')) {
    throw new Error("That file looks like the n3xn shell, not Minecraft");
  }

  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const makeRes = () =>
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
        await cache.put(location.origin + "/mc.html", makeRes());
        await cache.put("/mc.html", makeRes());
      } catch (_) {}
    }
  }

  try {
    const fs = await import("./fs.js");
    await fs.mkdir("/minecraft", { parents: true });
    await fs.writeFile("/minecraft/" + filename, new Uint8Array(body), { mime: "text/html" });
  } catch (_) {}

  return { size: bytes.byteLength, filename };
}

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
        if (open) openMcWindow();
        resolve(seeded);
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

export async function fetchMcAsset(kind, key, onProgress) {
  if (kind === "skin") {
    const name = MC_SKINS.find((s) => s === key || s.includes(key)) || key;
    const filename = name.endsWith(".png") ? name : name + ".png";
    const buf = await proxyFetch(skinProxyUrl(filename), onProgress, "Skin via n3xn proxy…");
    const blob = new Blob([buf], { type: "image/png" });
    return {
      blob,
      blobUrl: URL.createObjectURL(blob),
      filename,
      size: buf.byteLength,
      mime: "image/png",
      method: "n3xn-proxy",
    };
  }

  const v = resolveVersion(key);
  if (!v) throw new Error("Unknown version. Run: minecraft list");
  const id = v.id;
  const filename = id + ".html";

  // Cached /mc.html for recommended build
  if (id === "1.8-better" && "caches" in self) {
    try {
      for (const name of SHELL_CACHES) {
        const cache = await caches.open(name);
        const hit = (await cache.match("/mc.html")) || (await cache.match(location.origin + "/mc.html"));
        if (!hit || hit.headers.get("X-N3xn-Mc") === "0") continue;
        const buf = await hit.arrayBuffer();
        if (buf.byteLength > 500_000) {
          onProgress?.("Using cached /mc.html");
          const blob = new Blob([buf], { type: "text/html; charset=utf-8" });
          return {
            blob,
            blobUrl: URL.createObjectURL(blob),
            filename,
            size: buf.byteLength,
            mime: "text/html",
            method: "sw-cache",
          };
        }
      }
    } catch (_) {}
  }

  const buf = await proxyFetch(mcProxyUrl(id), onProgress, "n3xn proxy…");
  if (buf.byteLength < 500_000) {
    throw new Error("Proxy returned incomplete file (" + buf.byteLength + " bytes). Is functions/_middleware.js deployed?");
  }
  await seedMcHtml(buf, filename);
  onProgress?.("Cached /mc.html");
  const blob = new Blob([buf], { type: "text/html; charset=utf-8" });
  return {
    blob,
    blobUrl: URL.createObjectURL(blob),
    filename,
    size: buf.byteLength,
    mime: "text/html",
    method: "n3xn-proxy",
  };
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

/** @deprecated — never open upstream hosts from the client */
export function browserDownload() {
  throw new Error("Direct upstream download disabled. Use: minecraft get <id>");
}

export function openMcWindow() {
  const url = new URL("/mc.html", location.origin).href;
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) throw new Error("Popup blocked — allow popups for this site");
  return w;
}

export async function openMcInTab(key) {
  await fetchMcAsset("game", key);
  openMcWindow();
  return { opened: "/mc.html" };
}

export function openOfflineMc() {
  openMcWindow();
}

export function openN3xnChat() {
  window.open("/n3xn-chat.html", "_blank", "noopener,noreferrer");
}

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

// External proxy stubs (disabled — kept so terminal proxy cmds don't crash)
export function getFetchProxy() {
  return "";
}
export function setFetchProxy() {
  return "";
}
export function isProxyEnabled() {
  return false;
}
export function setProxyEnabled() {
  return false;
}
