/**
 * Chromebook Minecraft catalog + download helper
 * Asset URLs are internal only — never print the upstream host/repo in UI.
 */

const TAG_GAME = "MINECRAFT";
const TAG_SKINS = "minecraft_skins";

/** Base path only used at fetch time (not shown to users) */
function assetUrl(tag, file) {
  return `/github-assets/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

/**
 * CORS Proxy helper to bypass GitHub Release fetch blocks
 */
async function fetchWithProxy(targetUrl) {
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await fetch(proxyUrl, { redirect: "follow" });
      if (res.ok) return res;
    } catch (e) {
      console.warn("CORS proxy attempt failed, retrying fallback...", proxyUrl, e);
    }
  }

  // Fallback direct fetch attempt
  return await fetch(targetUrl, { mode: "cors", credentials: "omit", redirect: "follow" });
}

/** User-facing catalog — ids only, no upstream paths */
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
    MC_VERSIONS.find((v) => v.id.includes(k) || v.file.toLowerCase().includes(k) || v.label.toLowerCase().includes(k))
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

/**
 * Fetch asset → Blob + object URL. Bypasses CORS via proxy.
 */
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

  const rawUrl = assetUrl(tag, file);
  onProgress?.("Downloading " + filename + "…");

  const res = await fetchWithProxy(rawUrl);
  if (!res.ok) throw new Error("Download failed (" + res.status + ") for " + filename);

  const buf = await res.arrayBuffer();
  const mime = filename.endsWith(".png") ? "image/png" : "text/html; charset=utf-8";
  const blob = new Blob([buf], { type: mime });
  const blobUrl = URL.createObjectURL(blob);

  // If this is the recommended offline build, seed SW cache as /mc.html
  try {
    if (filename.includes("wasm-gc.1.8.better") && "caches" in self) {
      const cache = await caches.open("n3xn-shell-v10");
      const html = new Response(buf.slice(0), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
      await cache.put(location.origin + "/mc.html", html.clone());
      await cache.put("/mc.html", html);
    }
  } catch (_) {}

  return { blob, blobUrl, filename, size: buf.byteLength, mime };
}

/** Trigger browser download with proper filename */
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
  // Open window early to prevent popup blocker triggers
  const w = window.open("", "_blank");
  if (!w) throw new Error("Popup blocked — allow popups, or use: minecraft get " + (key || "1.8-better"));

  try {
    const { blob, blobUrl, filename } = await fetchMcAsset("game", key);
    
    // Write HTML content directly into the window document to bypass blob origin restrictions
    const text = await blob.text();
    w.document.open();
    w.document.write(text);
    w.document.close();

    return { blobUrl, filename };
  } catch (err) {
    w.close();
    throw err;
  }
}

/** Offline SW path for recommended build */
export function openOfflineMc() {
  window.open("/mc.html", "_blank");
}

export function openN3xnChat() {
  window.open("/n3xn-chat.html", "_blank");
}
