/* n3xn VFS service worker — Monaco same-origin proxy + app shell */
const SHELL = "n3xn-shell-v3";
const MONACO = "n3xn-monaco-v3";
const PREFIX = "/__monaco__/";
const CDN = "https://cdn.jsdelivr.net/";
const VER = "monaco-editor@0.52.0";

const SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/theme.css",
  "./css/app.css",
  "./js/app.js",
  "./js/db.js",
  "./js/crypto.js",
  "./js/fs.js",
  "./js/editor.js",
  "./js/terminal.js",
  "./js/runner.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/devtools.js",
  "./devtools.js",
  "./css/devtools.css",
  "./devtools.css"
];

const MONACO_CORE = [
  // Core Worker & Main Scripts
  "npm/" + VER + "/min/vs/loader.js",
  "npm/" + VER + "/min/vs/editor/editor.main.js",
  "npm/" + VER + "/min/vs/editor/editor.main.css",
  "npm/" + VER + "/min/vs/editor/editor.main.nls.js",
  "npm/" + VER + "/min/vs/base/worker/workerMain.js",

  // Rich Language Workers (Full Intellisense / Diagnostics)
  "npm/" + VER + "/min/vs/language/html/htmlWorker.js",
  "npm/" + VER + "/min/vs/language/css/cssWorker.js",
  "npm/" + VER + "/min/vs/language/json/jsonWorker.js",
  "npm/" + VER + "/min/vs/language/typescript/tsWorker.js",

  // Basic Languages (Syntax Highlighting)
  "npm/" + VER + "/min/vs/basic-languages/javascript/javascript.js",
  "npm/" + VER + "/min/vs/basic-languages/typescript/typescript.js",
  "npm/" + VER + "/min/vs/basic-languages/html/html.js",
  "npm/" + VER + "/min/vs/basic-languages/css/css.js",
  "npm/" + VER + "/min/vs/basic-languages/scss/scss.js",
  "npm/" + VER + "/min/vs/basic-languages/json/json.js",
  "npm/" + VER + "/min/vs/basic-languages/python/python.js",
  "npm/" + VER + "/min/vs/basic-languages/markdown/markdown.js",
  "npm/" + VER + "/min/vs/basic-languages/shell/shell.js",
  "npm/" + VER + "/min/vs/basic-languages/cpp/cpp.js",
  "npm/" + VER + "/min/vs/basic-languages/csharp/csharp.js",
  "npm/" + VER + "/min/vs/basic-languages/java/java.js",
  "npm/" + VER + "/min/vs/basic-languages/go/go.js",
  "npm/" + VER + "/min/vs/basic-languages/rust/rust.js",
  "npm/" + VER + "/min/vs/basic-languages/php/php.js",
  "npm/" + VER + "/min/vs/basic-languages/xml/xml.js",
  "npm/" + VER + "/min/vs/basic-languages/yaml/yaml.js",
  "npm/" + VER + "/min/vs/basic-languages/sql/sql.js",
  "npm/" + VER + "/min/vs/basic-languages/dockerfile/dockerfile.js",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.all(
        SHELL_URLS.map((u) => cache.add(u).catch(() => null))
      );
      await warmMonaco();
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL && k !== MONACO)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

async function cdnFetch(rel) {
  const res = await fetch(CDN + rel, { mode: "cors", credentials: "omit" });
  if (!res.ok) return res;
  const buf = await res.arrayBuffer();
  const headers = new Headers();
  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (rel.endsWith(".css") || ct.includes("css")) {
    headers.set("Content-Type", "text/css; charset=utf-8");
  } else if (rel.endsWith(".js") || ct.includes("javascript") || ct.includes("ecmascript")) {
    headers.set("Content-Type", "application/javascript; charset=utf-8");
  } else if (ct) {
    headers.set("Content-Type", ct);
  } else {
    headers.set("Content-Type", "application/javascript; charset=utf-8");
  }
  headers.set("Cache-Control", "public, max-age=31536000");
  return new Response(buf, { status: 200, headers });
}

async function warmMonaco() {
  const cache = await caches.open(MONACO);
  await Promise.all(
    MONACO_CORE.map(async (rel) => {
      try {
        const res = await cdnFetch(rel);
        if (res.ok) {
          await cache.put(self.location.origin + PREFIX + rel, res.clone());
        }
      } catch (_) {}
    })
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Same-origin Monaco proxy
  if (url.origin === self.location.origin && url.pathname.startsWith(PREFIX)) {
    event.respondWith(monacoProxy(req, url));
    return;
  }

  // Direct CDN monaco → cache + serve (helps first paint)
  if (
    url.hostname === "cdn.jsdelivr.net" &&
    url.pathname.includes("monaco-editor")
  ) {
    event.respondWith(monacoCdn(req, url));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never treat non-JS as JS: if someone requests /sw.js and gets HTML, don't cache as shell forever
  if (url.pathname.endsWith("/sw.js") || url.pathname === "/sw.js") {
    event.respondWith(
      fetch(req).then(async (res) => {
        const ct = res.headers.get("Content-Type") || "";
        if (ct.includes("html")) {
          return new Response("/* sw.js missing on deploy */", {
            status: 500,
            headers: { "Content-Type": "application/javascript" },
          });
        }
        return res;
      })
    );
    return;
  }

  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      try {
        const net = await fetch(req);
        if (net.ok) cache.put(req, net.clone()).catch(() => {});
        return net;
      } catch {
        const hit = await cache.match(req);
        return hit || cache.match("./index.html");
      }
    })
  );
});

async function monacoProxy(req, url) {
  const cache = await caches.open(MONACO);
  const hit = await cache.match(req);
  if (hit) return hit;
  const rel = url.pathname.slice(PREFIX.length) + url.search;
  try {
    const res = await cdnFetch(rel);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch {
    return new Response("/* monaco offline miss: " + rel + " */", {
      status: 503,
      headers: { "Content-Type": "application/javascript" },
    });
  }
}

async function monacoCdn(req, url) {
  const cache = await caches.open(MONACO);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req, { mode: "cors", credentials: "omit" });
    if (!res.ok) return res;
    const buf = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    const out = new Response(buf.slice(0), { status: 200, headers });
    await cache.put(req, out.clone());
    const rel = url.pathname.replace(/^\//, "") + url.search;
    await cache.put(self.location.origin + PREFIX + rel, new Response(buf, { status: 200, headers }));
    return new Response(buf, { status: 200, headers });
  } catch {
    return (
      (await cache.match(req)) ||
      new Response("/* monaco cdn offline */", {
        status: 503,
        headers: { "Content-Type": "application/javascript" },
      })
    );
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "WARM_MONACO") {
    event.waitUntil(warmMonaco());
  }
});
