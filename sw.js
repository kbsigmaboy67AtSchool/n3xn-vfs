/**
 * n3xn VFS v2 — Service Worker
 * - App shell cache (offline PWA)
 * - Monaco CDN proxy under /__monaco__/ so workers + AMD are same-origin and offline-cacheable
 *   (no vendored Monaco in deploy — first online session fills the cache)
 */
const SHELL = "n3xn-vfs-v2-shell-2";
const MONACO = "n3xn-vfs-v2-monaco-1";
const MONACO_PREFIX = "/__monaco__/";
const MONACO_CDN = "https://cdn.jsdelivr.net/";
const MONACO_VER = "monaco-editor@0.52.0";

const PRECACHE_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/theme.css",
  "./css/app.css",
  "./js/app.js",
  "./js/db.js",
  "./js/crypto.js",
  "./js/fs.js",
  "./js/terminal.js",
  "./js/editor.js",
  "./js/runner.js",
  "./js/media-editor.js",
  "./js/html-visual.js",
  "./js/collab.js",
  "./js/python.js",
  "./js/monaco-settings.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
];

/** Core Monaco paths warmed on install when online (proxy URLs = same-origin) */
const MONACO_WARM = [
  "npm/" + MONACO_VER + "/min/vs/loader.js",
  "npm/" + MONACO_VER + "/min/vs/editor/editor.main.js",
  "npm/" + MONACO_VER + "/min/vs/editor/editor.main.css",
  "npm/" + MONACO_VER + "/min/vs/editor/editor.main.nls.js",
  "npm/" + MONACO_VER + "/min/vs/base/worker/workerMain.js",
  "npm/" + MONACO_VER + "/min/vs/basic-languages/javascript/javascript.js",
  "npm/" + MONACO_VER + "/min/vs/basic-languages/typescript/typescript.js",
  "npm/" + MONACO_VER + "/min/vs/basic-languages/html/html.js",
  "npm/" + MONACO_VER + "/min/vs/basic-languages/css/css.js",
  "npm/" + MONACO_VER + "/min/vs/basic-languages/python/python.js",
  "npm/" + MONACO_VER + "/min/vs/basic-languages/markdown/markdown.js",
  "npm/" + MONACO_VER + "/min/vs/basic-languages/shell/shell.js",
  "npm/" + MONACO_VER + "/min/vs/basic-languages/json/json.js",
  "npm/" + MONACO_VER + "/min/vs/language/json/jsonMode.js",
  "npm/" + MONACO_VER + "/min/vs/language/css/cssMode.js",
  "npm/" + MONACO_VER + "/min/vs/language/html/htmlMode.js",
  "npm/" + MONACO_VER + "/min/vs/language/typescript/tsMode.js",
  "npm/" + MONACO_VER + "/min/vs/language/typescript/tsWorker.js",
  "npm/" + MONACO_VER + "/min/vs/language/json/jsonWorker.js",
  "npm/" + MONACO_VER + "/min/vs/language/css/cssWorker.js",
  "npm/" + MONACO_VER + "/min/vs/language/html/htmlWorker.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.addAll(PRECACHE_SHELL).catch(() => shell.addAll(["./", "./index.html"]));
      try {
        await warmMonaco(MONACO_WARM);
      } catch (_) {}
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL && k !== MONACO).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

async function warmMonaco(paths) {
  const cache = await caches.open(MONACO);
  await Promise.all(
    paths.map(async (rel) => {
      const proxyUrl = self.location.origin + MONACO_PREFIX + rel;
      try {
        const res = await fetchMonacoFromCdn(rel);
        if (res && res.ok) await cache.put(proxyUrl, res);
      } catch (_) {}
    })
  );
}

async function fetchMonacoFromCdn(relPath) {
  const cdnUrl = MONACO_CDN + relPath.replace(/^\//, "");
  const res = await fetch(cdnUrl, {
    mode: "cors",
    credentials: "omit",
    cache: "reload",
  });
  if (!res.ok) return res;
  const buf = await res.arrayBuffer();
  const headers = new Headers(res.headers);
  headers.set("X-N3xn-Monaco-Cache", "1");
  if (relPath.endsWith(".js") && !(headers.get("Content-Type") || "").includes("javascript")) {
    headers.set("Content-Type", "application/javascript; charset=utf-8");
  }
  if (relPath.endsWith(".css")) {
    headers.set("Content-Type", "text/css; charset=utf-8");
  }
  return new Response(buf, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.startsWith(MONACO_PREFIX)) {
    event.respondWith(handleMonacoProxy(req, url));
    return;
  }

  // Cache Monaco CDN directly (first visit before proxy is used)
  if (
    (url.hostname === "cdn.jsdelivr.net" || url.hostname === "cdnjs.cloudflare.com") &&
    url.pathname.includes("monaco-editor")
  ) {
    event.respondWith(handleMonacoCdn(req));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/js/") || url.pathname.endsWith(".js")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

async function handleMonacoProxy(req, url) {
  const cache = await caches.open(MONACO);
  const cached = await cache.match(req);
  if (cached) return cached;

  const rel = url.pathname.slice(MONACO_PREFIX.length) + url.search;
  try {
    const res = await fetchMonacoFromCdn(rel);
    if (res.ok) {
      await cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    return new Response(
      "/* Monaco asset not cached yet — open n3xn online once to download editor files */\n",
      { status: 503, headers: { "Content-Type": "application/javascript" } }
    );
  }
}


async function handleMonacoCdn(req) {
  const cache = await caches.open(MONACO);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req, { mode: "cors", credentials: "omit" });
    if (!res.ok) return res;
    const buf = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    const stored = new Response(buf.slice(0), {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
    await cache.put(req, stored);
    try {
      const u = new URL(req.url);
      const rel = u.pathname.replace(/^\//, "") + u.search;
      const proxyUrl = self.location.origin + MONACO_PREFIX + rel;
      await cache.put(
        proxyUrl,
        new Response(buf.slice(0), { status: res.status, statusText: res.statusText, headers })
      );
    } catch (_) {}
    return new Response(buf, { status: res.status, statusText: res.statusText, headers });
  } catch (e) {
    const again = await cache.match(req);
    if (again) return again;
    return new Response("/* monaco offline miss */", {
      status: 503,
      headers: { "Content-Type": "application/javascript" },
    });
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "WARM_MONACO") {
    event.waitUntil(warmMonaco(event.data.paths || MONACO_WARM));
  }
});
