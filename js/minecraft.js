/**
 * Chromebook Minecraft catalog + download helper
 * Uses same-origin /github-assets/:tag/:file (CF Pages 200 proxy).
 * Never prints upstream host/repo in UI.
 */

const TAG_GAME = "MINECRAFT";
const TAG_SKINS = "minecraft_skins";
const SHELL_CACHE = "n3xn-shell-v11";

function assetUrl(tag, file) {
  // Do NOT encodeURIComponent path segments for CF :tag/:file matching
  return `/github-assets/${tag}/${file}`;
}

function upstreamUrl(tag, file) {
  const host = ["git", "hub", ".com"].join("");
  const user = ["kbsigmaboy", "67AtSchool"].join("");
  return `https://${host}/${user}/minecraft/releases/download/${tag}/${file}`;
}

/**
 * Fetch order:
 * 1) same-origin /github-assets (CF proxy) — preferred
 * 2) optional CORS proxies on upstream (last resort)
 * 3) direct upstream (usually CORS-fails)
 */
async function fetchAsset(tag, file, onProgress) {
  const sameOrigin = assetUrl(tag, file);
  const upstream = upstreamUrl(tag, file);
  const attempts = [
    { label: "site-proxy", url: sameOrigin, mode: "same-origin" },
    {
      label: "corsproxy",
      url: "https://corsproxy.io/?" + encodeURIComponent(upstream),
      mode: "cors",
    },
    {
      label: "allorigins",
      url: "https://api.allorigins.win/raw?url=" + encodeURIComponent(upstream),
      mode: "cors",
    },
    { label: "direct", url: upstream, mode: "cors" },
  ];

  let lastErr = null;
  for (const a of attempts) {
    try {
      onProgress?.(`Trying ${a.label}…`);
      const res = await fetch(a.url, {
        redirect: "follow",
        credentials: "omit",
        mode: a.mode === "same-origin" ? "same-origin" : "cors",
      });
      if (!res.ok) {
        lastErr = new Error(a.label + " HTTP " + res.status);
        continue;
      }
      const buf = await res.arrayBuffer();
      // SPA index.html is small-ish; real game is multi-MB. Reject tiny HTML.
      if (buf.byteLength < 500_000 && file.endsWith(".html")) {
        // skins are tiny PNGs — only apply size check to html games
        const head = new TextDecoder().decode(buf.slice(0, 200)).toLowerCase();
        if (head.includes("n3xn") || head.includes("<!doctype html>") && buf.byteLength < 200_000) {
          lastErr = new Error(a.label + " returned site shell, not game (" + buf.byteLength + " bytes)");
          continue;
        }
      }
      if (file.endsWith(".html") && buf.byteLength < 1_000_000) {
        // still allow if looks like eagler (has wasm/eagler markers)
        const sample = new TextDecoder().decode(buf.slice(0, 8000)).toLowerCase();
        if (!/eagler|minecraft|wasm|gameCanvas|webgl/i.test(sample) && buf.byteLength < 500_000) {
          lastErr = new Error(a.label + " not a game HTML (" + buf.byteLength + " b)");
          continue;
        }
      }
      onProgress?.(`OK via ${a.label} (${Math.round(buf.byteLength / 1048576)} MB)`);
      return buf;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All download methods failed");
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

async function seedMcHtml(buf) {
  if (!("caches" in self)) return;
  const names = [SHELL_CACHE, "n3xn-shell-v10", "n3xn-shell-v9", "n3xn-shell-v8"];
  for (const name of names) {
    try {
      const cache = await caches.open(name);
      const html = new Response(buf.slice(0), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-N3xn-Mc": "1",
          "Cache-Control": "public, max-age=86400",
        },
      });
      await cache.put(location.origin + "/mc.html", html.clone());
      await cache.put("/mc.html", html.clone());
    } catch (_) {}
  }
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

  onProgress?.("Downloading " + filename + "…");
  const buf = await fetchAsset(tag, file, onProgress);
  const mime = filename.endsWith(".png") ? "image/png" : "text/html; charset=utf-8";
  const blob = new Blob([buf], { type: mime });
  const blobUrl = URL.createObjectURL(blob);

  if (filename.includes("wasm-gc.1.8.better") || filename.endsWith(".html")) {
    try {
      if (filename.includes("wasm-gc.1.8.better")) await seedMcHtml(buf);
    } catch (_) {}
  }

  return { blob, blobUrl, filename, size: buf.byteLength, mime };
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
  const w = window.open("about:blank", "_blank");
  if (!w) throw new Error("Popup blocked — allow popups, or use: minecraft get " + (key || "1.8-better"));
  try {
    w.document.write("<p style='font-family:system-ui;background:#111;color:#eee;padding:1rem'>Loading Minecraft…</p>");
    const { blob, blobUrl, filename } = await fetchMcAsset("game", key, (m) => {
      try {
        w.document.body.textContent = m;
      } catch (_) {}
    });
    // Prefer blob navigation (keeps binary/wasm relative loads working better in some builds)
    try {
      w.location.href = blobUrl;
    } catch (_) {
      const text = await blob.text();
      w.document.open();
      w.document.write(text);
      w.document.close();
    }
    return { blobUrl, filename };
  } catch (err) {
    try {
      w.close();
    } catch (_) {}
    throw err;
  }
}

export function openOfflineMc() {
  window.open("/mc.html", "_blank");
}

export function openN3xnChat() {
  window.open("/n3xn-chat.html", "_blank");
}
