/* n3xn VFS SW v8 — full offline CDN packs (Monaco, Pyodide, React, Babel, JSZip, Wasmoon, fonts, V0RT3X) */
const SHELL = "n3xn-shell-v12";
const MONACO = "n3xn-monaco-v5";
const PYODIDE_CACHE = "n3xn-pyodide-v1";
const CDN_CACHE = "n3xn-cdn-v2";

const PREFIX = "/__monaco__/";
const PY_PREFIX = "/__pyodide__/";
const CDN_PREFIX = "/__cdn__/";

const CDN = "https://cdn.jsdelivr.net/";
const VER = "monaco-editor@0.52.0";
const PY_VER = "v0.26.2";
const PY_CDN = "https://cdn.jsdelivr.net/pyodide/" + PY_VER + "/full/";

const VORTEX_GITHUB_URL =
  "https://cdn.jsdelivr.net/gh/kbsigmaboy67AtSchool/V0RT3X-C0D3S@main/index.html";

const MC_OFFLINE_FILE = "Xclounkit234X.wasm-gc.1.8.better.version.html";
const MC_OFFLINE_URL = (() => {
  const host = ["git", "hub", ".com"].join("");
  const user = ["kbsigmaboy", "67AtSchool"].join("");
  return "https://" + host + "/" + user + "/minecraft/releases/download/MINECRAFT/" + MC_OFFLINE_FILE;
})();

const N3XN_CHAT_SRC = (() => {
  return "https://cdn.jsdelivr.net/gh/kbsigmaboy67AtSchool/V0RT3X-C0D3S@main/index.html";
})();

const FLAGS_URL = self.location.origin + "/__n3xn_sw_flags__";

/* Offline ON by default — first install warms packs */
let offlinePyodide = true;
let offlineReact = true;
let offlineCdn = true;

const SHELL_URLS = [
  "./",
  "./index.html",
  "./V0RT3X_chat.html",
  "./n3xn-chat.html",
  "./manifest.webmanifest",
  "./css/theme.css",
  "./css/app.css",
  "./css/devtools.css",
  "./js/app.js",
  "./js/db.js",
  "./js/crypto.js",
  "./js/fs.js",
  "./js/editor.js",
  "./js/terminal.js",
  "./js/runner.js",
  "./js/python.js",
  "./js/react-runner.js",
  "./js/lang-runner.js",
  "./js/n3xn-devtools.js",
  "./devtools.js",
  "./devtools.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const MONACO_CORE = [
  // Core Loader & Main Editor
  "npm/" + VER + "/min/vs/loader.js",
  "npm/" + VER + "/min/vs/editor/editor.main.js",
  "npm/" + VER + "/min/vs/editor/editor.main.css",
  "npm/" + VER + "/min/vs/editor/editor.main.nls.js",
  "npm/" + VER + "/min/vs/base/worker/workerMain.js",

  // Core UI Font & Base Worker (Fixes icons & fallback worker services)
  "npm/" + VER + "/min/vs/base/browser/ui/codicons/codicon/codicon.ttf",
  "npm/" + VER + "/min/vs/editor/editor.worker.js",

  // Language Workers
  "npm/" + VER + "/min/vs/language/html/htmlWorker.js",
  "npm/" + VER + "/min/vs/language/css/cssWorker.js",
  "npm/" + VER + "/min/vs/language/json/jsonWorker.js",
  "npm/" + VER + "/min/vs/language/typescript/tsWorker.js",

  // Full Monaco Basic Language Suite
  "npm/" + VER + "/min/vs/basic-languages/abap/abap.js",
  "npm/" + VER + "/min/vs/basic-languages/apex/apex.js",
  "npm/" + VER + "/min/vs/basic-languages/azcli/azcli.js",
  "npm/" + VER + "/min/vs/basic-languages/bat/bat.js",
  "npm/" + VER + "/min/vs/basic-languages/bicep/bicep.js",
  "npm/" + VER + "/min/vs/basic-languages/cameligo/cameligo.js",
  "npm/" + VER + "/min/vs/basic-languages/clojure/clojure.js",
  "npm/" + VER + "/min/vs/basic-languages/coffeescript/coffeescript.js",
  "npm/" + VER + "/min/vs/basic-languages/cpp/cpp.js",
  "npm/" + VER + "/min/vs/basic-languages/csharp/csharp.js",
  "npm/" + VER + "/min/vs/basic-languages/csp/csp.js",
  "npm/" + VER + "/min/vs/basic-languages/css/css.js",
  "npm/" + VER + "/min/vs/basic-languages/cypher/cypher.js",
  "npm/" + VER + "/min/vs/basic-languages/dart/dart.js",
  "npm/" + VER + "/min/vs/basic-languages/dockerfile/dockerfile.js",
  "npm/" + VER + "/min/vs/basic-languages/ecl/ecl.js",
  "npm/" + VER + "/min/vs/basic-languages/elixir/elixir.js",
  "npm/" + VER + "/min/vs/basic-languages/flow9/flow9.js",
  "npm/" + VER + "/min/vs/basic-languages/freemarker2/freemarker2.js",
  "npm/" + VER + "/min/vs/basic-languages/fsharp/fsharp.js",
  "npm/" + VER + "/min/vs/basic-languages/go/go.js",
  "npm/" + VER + "/min/vs/basic-languages/graphql/graphql.js",
  "npm/" + VER + "/min/vs/basic-languages/handlebars/handlebars.js",
  "npm/" + VER + "/min/vs/basic-languages/hcl/hcl.js",
  "npm/" + VER + "/min/vs/basic-languages/html/html.js",
  "npm/" + VER + "/min/vs/basic-languages/ini/ini.js",
  "npm/" + VER + "/min/vs/basic-languages/java/java.js",
  "npm/" + VER + "/min/vs/basic-languages/javascript/javascript.js",
  "npm/" + VER + "/min/vs/basic-languages/julia/julia.js",
  "npm/" + VER + "/min/vs/basic-languages/kotlin/kotlin.js",
  "npm/" + VER + "/min/vs/basic-languages/less/less.js",
  "npm/" + VER + "/min/vs/basic-languages/lexon/lexon.js",
  "npm/" + VER + "/min/vs/basic-languages/liquid/liquid.js",
  "npm/" + VER + "/min/vs/basic-languages/lua/lua.js",
  "npm/" + VER + "/min/vs/basic-languages/m3/m3.js",
  "npm/" + VER + "/min/vs/basic-languages/markdown/markdown.js",
  "npm/" + VER + "/min/vs/basic-languages/mips/mips.js",
  "npm/" + VER + "/min/vs/basic-languages/msdax/msdax.js",
  "npm/" + VER + "/min/vs/basic-languages/mysql/mysql.js",
  "npm/" + VER + "/min/vs/basic-languages/objective-c/objective-c.js",
  "npm/" + VER + "/min/vs/basic-languages/pascal/pascal.js",
  "npm/" + VER + "/min/vs/basic-languages/pascaligo/pascaligo.js",
  "npm/" + VER + "/min/vs/basic-languages/perl/perl.js",
  "npm/" + VER + "/min/vs/basic-languages/pgsql/pgsql.js",
  "npm/" + VER + "/min/vs/basic-languages/php/php.js",
  "npm/" + VER + "/min/vs/basic-languages/pla/pla.js",
  "npm/" + VER + "/min/vs/basic-languages/postiats/postiats.js",
  "npm/" + VER + "/min/vs/basic-languages/powerquery/powerquery.js",
  "npm/" + VER + "/min/vs/basic-languages/powershell/powershell.js",
  "npm/" + VER + "/min/vs/basic-languages/protobuf/protobuf.js",
  "npm/" + VER + "/min/vs/basic-languages/pug/pug.js",
  "npm/" + VER + "/min/vs/basic-languages/python/python.js",
  "npm/" + VER + "/min/vs/basic-languages/qsharp/qsharp.js",
  "npm/" + VER + "/min/vs/basic-languages/r/r.js",
  "npm/" + VER + "/min/vs/basic-languages/razor/razor.js",
  "npm/" + VER + "/min/vs/basic-languages/redis/redis.js",
  "npm/" + VER + "/min/vs/basic-languages/redshift/redshift.js",
  "npm/" + VER + "/min/vs/basic-languages/reststructuredtext/reststructuredtext.js",
  "npm/" + VER + "/min/vs/basic-languages/ruby/ruby.js",
  "npm/" + VER + "/min/vs/basic-languages/rust/rust.js",
  "npm/" + VER + "/min/vs/basic-languages/sb/sb.js",
  "npm/" + VER + "/min/vs/basic-languages/scala/scala.js",
  "npm/" + VER + "/min/vs/basic-languages/scheme/scheme.js",
  "npm/" + VER + "/min/vs/basic-languages/scss/scss.js",
  "npm/" + VER + "/min/vs/basic-languages/shell/shell.js",
  "npm/" + VER + "/min/vs/basic-languages/sol/sol.js",
  "npm/" + VER + "/min/vs/basic-languages/sparql/sparql.js",
  "npm/" + VER + "/min/vs/basic-languages/sql/sql.js",
  "npm/" + VER + "/min/vs/basic-languages/st/st.js",
  "npm/" + VER + "/min/vs/basic-languages/swift/swift.js",
  "npm/" + VER + "/min/vs/basic-languages/systemverilog/systemverilog.js",
  "npm/" + VER + "/min/vs/basic-languages/tcl/tcl.js",
  "npm/" + VER + "/min/vs/basic-languages/twig/twig.js",
  "npm/" + VER + "/min/vs/basic-languages/typescript/typescript.js",
  "npm/" + VER + "/min/vs/basic-languages/vb/vb.js",
  "npm/" + VER + "/min/vs/basic-languages/wgsl/wgsl.js",
  "npm/" + VER + "/min/vs/basic-languages/xml/xml.js",
  "npm/" + VER + "/min/vs/basic-languages/yaml/yaml.js"
];

const PYODIDE_CORE = [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
  "repodata.json",
];

/** Absolute URLs warmed into CDN_CACHE */
const EXTERNAL_CORE = [
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.5/babel.min.js",
  "https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/dist/index.js",
  "https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/dist/glue.wasm",
  "https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/+esm",
  "https://esm.sh/react@18.3.1",
  "https://esm.sh/react-dom@18.3.1/client",
  "https://esm.sh/react@18.3.1?dev",
  "https://cdn.jsdelivr.net/gh/kbsigmaboy67AtSchool/git@main/public/devtools.css",
  "https://cdn.jsdelivr.net/gh/kbsigmaboy67AtSchool/git@main/public/devtools.js",
  "https://fonts.googleapis.com/css2?family=Sixtyfour&family=JetBrains+Mono:wght@400;500;700&family=Share+Tech+Mono&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/loader.min.js",
  /* game / teaching packs — offline via /__cdn__/ */
  "https://cdn.jsdelivr.net/npm/kaboom@3000.1.17/dist/kaboom.js",
  "https://esm.sh/kaboom@3000.1.17",
  "https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js",
  "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.js",
  "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.min.js",
  "https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js",
  "https://cdn.jsdelivr.net/npm/p5@1.11.1/lib/p5.min.js",
  "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.js",
  "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.wasm",
  "https://cdn.jsdelivr.net/npm/biwascheme@0.8.0/release/biwascheme-min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await saveFlags();
      const cache = await caches.open(SHELL);
      await Promise.all(SHELL_URLS.map((u) => cache.add(u).catch(() => null)));
      await warmMonaco();
      await warmVortexChat();
      await warmN3xnChat();
      await warmMinecraftOffline();
      await warmExternal();
      await warmPyodide();
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, MONACO, PYODIDE_CACHE, CDN_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await loadFlags();
      await self.clients.claim();
    })()
  );
});

function mimeFor(path) {
  const p = String(path).split("?")[0].toLowerCase();
  if (p.endsWith(".wasm")) return "application/wasm";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json") || p.endsWith(".lock")) return "application/json";
  if (p.endsWith(".zip") || p.endsWith(".data")) return "application/octet-stream";
  if (p.endsWith(".mjs") || p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".woff2")) return "font/woff2";
  if (p.endsWith(".woff")) return "font/woff";
  if (p.endsWith(".ttf")) return "font/ttf";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function loadFlags() {
  try {
    const cache = await caches.open(SHELL);
    const res = await cache.match(FLAGS_URL);
    if (!res) return;
    const j = await res.json();
    if (typeof j.pyodide === "boolean") offlinePyodide = j.pyodide;
    if (typeof j.react === "boolean") offlineReact = j.react;
    if (typeof j.cdn === "boolean") offlineCdn = j.cdn;
  } catch (_) {}
}

async function saveFlags() {
  try {
    const cache = await caches.open(SHELL);
    await cache.put(
      FLAGS_URL,
      new Response(
        JSON.stringify({
          pyodide: offlinePyodide,
          react: offlineReact,
          cdn: offlineCdn,
          ts: Date.now(),
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
  } catch (_) {}
}

async function cdnFetch(rel) {
  const res = await fetch(CDN + rel, { mode: "cors", credentials: "omit" });
  if (!res.ok) return res;
  const buf = await res.arrayBuffer();
  const headers = new Headers();
  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (rel.endsWith(".css") || ct.includes("css")) headers.set("Content-Type", "text/css; charset=utf-8");
  else if (rel.endsWith(".js") || ct.includes("javascript") || ct.includes("ecmascript"))
    headers.set("Content-Type", "application/javascript; charset=utf-8");
  else if (ct) headers.set("Content-Type", ct);
  else headers.set("Content-Type", "application/javascript; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=31536000, no-transform");
  return new Response(buf, { status: 200, headers });
}

async function putBoth(cache, localUrl, remoteUrl, buf, contentType) {
  const headers = new Headers({
    "Content-Type": contentType || mimeFor(localUrl),
    "Cache-Control": "public, max-age=31536000, no-transform",
  });
  const out = new Response(buf.slice(0), { status: 200, headers });
  await cache.put(localUrl, out.clone());
  if (remoteUrl) await cache.put(remoteUrl, out.clone());
  return out;
}

async function warmMonaco() {
  const cache = await caches.open(MONACO);
  await Promise.all(
    MONACO_CORE.map(async (rel) => {
      try {
        const res = await cdnFetch(rel);
        if (res.ok) await cache.put(self.location.origin + PREFIX + rel, res.clone());
      } catch (_) {}
    })
  );
}

async function warmMinecraftOffline() {
  const cache = await caches.open(SHELL);
  const candidates = [
    self.location.origin + "/github-assets/MINECRAFT/" + MC_OFFLINE_FILE,
    self.location.origin + "/mc-source.html",
  ];
  try { candidates.push(MC_OFFLINE_URL); } catch (_) {}
  for (const url of candidates) {
    try {
      const res = await fetch(url, { credentials: "omit", redirect: "follow" });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 1000000) continue;
      const sample = new TextDecoder().decode(buf.slice(0, 4000)).toLowerCase();
      if (sample.includes("n3xn virtual") || sample.includes("minecraft not cached")) continue;
      const html = new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
          "X-N3xn-Mc": "1",
        },
      });
      await cache.put(self.location.origin + "/mc.html", html.clone());
      await cache.put("/mc.html", html.clone());
      console.info("[n3xn sw] mc.html cached", buf.byteLength, "bytes");
      return;
    } catch (err) {
      console.warn("[n3xn sw] mc try", String(err && err.message || err).slice(0, 100));
    }
  }
  const tip = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Minecraft setup</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0a0a0f;color:#e2e8f0;padding:1.5rem;line-height:1.5}.box{max-width:420px;border:1px solid #334155;border-radius:12px;padding:1.5rem;background:#0d1117}h1{margin:0 0 .5rem;font-size:1.25rem;color:#00f3ff}p{margin:.5rem 0;color:#94a3b8;font-size:.9rem}code{background:#1e293b;padding:2px 6px;border-radius:4px;font-size:.8rem}button,label.btn{display:inline-block;margin-top:.75rem;padding:.65rem 1rem;border:0;border-radius:8px;background:#00f3ff;color:#000;font-weight:700;cursor:pointer;font-size:.9rem}button.secondary{background:#1e293b;color:#e2e8f0;margin-left:.5rem}#status{margin-top:1rem;font-size:.85rem;color:#a5f3fc;white-space:pre-wrap}</style></head><body><div class="box"><h1>Minecraft not cached yet</h1><p>Browsers cannot auto-fetch the release (CORS). Do this once:</p><p><strong>1.</strong> Download the HTML (Chrome / Files app).<br><strong>2.</strong> Import it below — seeds <code>/mc.html</code> on this device.</p><label class="btn"><input type="file" id="f" accept=".html,text/html" hidden>Import Minecraft .html</label><button type="button" class="secondary" id="reload">Retry open</button><p style="margin-top:1rem">Or in n3xn terminal: <code>minecraft get 1.8-better</code> then <code>minecraft import</code></p><div id="status"></div><script>const status = document.getElementById("status");function log(m){ status.textContent = m; }document.getElementById("f").onchange = async (e) => {  const file = e.target.files && e.target.files[0];  if (!file) return;  log("Reading " + file.name + "…");  try {    const buf = await file.arrayBuffer();    if (buf.byteLength < 500000) throw new Error("File too small (" + buf.byteLength + " bytes) — pick the full game HTML");    const names = ["n3xn-shell-v12","n3xn-shell-v11","n3xn-shell-v10","n3xn-shell-v9","n3xn-shell-v8"];    for (const name of names) {      try {        const cache = await caches.open(name);        const res = new Response(buf.slice(0), {          status: 200,          headers: {            "Content-Type": "text/html; charset=utf-8",            "X-N3xn-Mc": "1",            "Cache-Control": "public, max-age=31536000"          }        });        await cache.put(location.origin + "/mc.html", res.clone());        await cache.put("/mc.html", res.clone());      } catch (err) { console.warn(err); }    }    log("Cached " + Math.round(buf.byteLength/1048576) + " MB. Reloading…");    location.reload();  } catch (err) {    log(String(err.message || err));  }};;document.getElementById("reload").onclick = () => location.reload();</script></div></body></html>`;
  const html = new Response(tip, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-N3xn-Mc": "0" },
  });
  const existing = await cache.match("/mc.html");
  if (existing) {
    const x = existing.headers.get("X-N3xn-Mc");
    if (x === "1") return;
    const b = await existing.clone().arrayBuffer();
    if (b.byteLength > 1000000) return;
  }
  await cache.put(self.location.origin + "/mc.html", html.clone());
  await cache.put("/mc.html", html);
}

async function warmN3xnChat() {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(N3XN_CHAT_SRC || VORTEX_GITHUB_URL, { mode: "cors" });
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    const html = new Response(buf, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    await cache.put(self.location.origin + "/n3xn-chat.html", html.clone());
    await cache.put("/n3xn-chat.html", html.clone());
    await cache.put(self.location.origin + "/V0RT3X_chat.html", html.clone());
  } catch (err) {
    console.warn("[n3xn sw] n3xn-chat", err);
  }
}

async function warmVortexChat() {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(VORTEX_GITHUB_URL, { mode: "cors" });
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    await cache.put(
      self.location.origin + "/V0RT3X_chat.html",
      new Response(buf, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })
    );
  } catch (err) {
    console.error("[n3xn sw] V0RT3X", err);
  }
}

async function warmPyodide() {
  if (!offlinePyodide) return;
  const cache = await caches.open(PYODIDE_CACHE);
  for (const f of PYODIDE_CORE) {
    const remote = PY_CDN + f;
    const local = self.location.origin + PY_PREFIX + PY_VER + "/full/" + f;
    try {
      if (await cache.match(local)) continue;
      const res = await fetch(remote, { mode: "cors", credentials: "omit" });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      await putBoth(cache, local, remote, buf, mimeFor(f));
    } catch (_) {}
  }
}

async function warmExternal() {
  if (!offlineCdn && !offlineReact) return;
  const cache = await caches.open(CDN_CACHE);
  for (const u of EXTERNAL_CORE) {
    try {
      if (await cache.match(u)) continue;
      const res = await fetch(u, { mode: "cors", credentials: "omit", redirect: "follow" });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const ct = res.headers.get("Content-Type") || mimeFor(u);
      await putBoth(cache, u, null, buf, ct);
      let proxied = null;
      if (u.startsWith("https://cdn.jsdelivr.net/"))
        proxied = self.location.origin + CDN_PREFIX + "jsdelivr/" + u.slice("https://cdn.jsdelivr.net/".length);
      else if (u.startsWith("https://esm.sh/"))
        proxied = self.location.origin + CDN_PREFIX + "esm/" + u.slice("https://esm.sh/".length);
      else if (u.startsWith("https://cdnjs.cloudflare.com/"))
        proxied = self.location.origin + CDN_PREFIX + "cdnjs/" + u.slice("https://cdnjs.cloudflare.com/".length);
      else if (u.startsWith("https://fonts.googleapis.com/"))
        proxied = self.location.origin + CDN_PREFIX + "gfonts/" + u.slice("https://fonts.googleapis.com/".length);
      if (proxied) await putBoth(cache, proxied, null, buf, ct);
    } catch (_) {}
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Offline Minecraft — never fall through to SPA index.html
  if (url.origin === self.location.origin && url.pathname === "/mc.html") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        let hit = (await cache.match(req)) || (await cache.match("/mc.html"));
        if (hit) {
          try {
            const buf = await hit.clone().arrayBuffer();
            if (buf.byteLength < 500000) {
              const sample = new TextDecoder().decode(buf.slice(0, 1500)).toLowerCase();
              if (sample.includes("n3xn virtual") || sample.includes("<div id=\"app\"")) {
                await cache.delete("/mc.html");
                await cache.delete(self.location.origin + "/mc.html");
                hit = null;
              }
            }
          } catch (_) {}
        }
        if (!hit) {
          await warmMinecraftOffline();
          hit = (await cache.match("/mc.html")) || (await cache.match(self.location.origin + "/mc.html"));
        }
        if (hit) return hit;
        return new Response("mc.html not available — run: minecraft get 1.8-better", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })()
    );
    return;
  }

  // Internal JS-only proxy — network only, never SPA
  if (url.origin === self.location.origin && url.pathname.startsWith("/__proxy__/")) {
    event.respondWith(fetch(req));
    return;
  }

  // Proxy path: let network handle /github-assets
  if (url.origin === self.location.origin && url.pathname.startsWith("/github-assets/")) {
    event.respondWith(
      fetch(req).catch(
        () => new Response("github-assets proxy failed", { status: 502 })
      )
    );
    return;
  }

  // n3xn chat (+ legacy V0RT3X path)
  if (
    url.origin === self.location.origin &&
    (url.pathname === "/n3xn-chat.html" || url.pathname === "/V0RT3X_chat.html")
  ) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit =
          (await cache.match(req)) ||
          (await cache.match("/n3xn-chat.html")) ||
          (await cache.match("/V0RT3X_chat.html"));
        if (hit) return hit;
        await warmN3xnChat();
        return (
          (await cache.match("/n3xn-chat.html")) ||
          (await cache.match("/V0RT3X_chat.html")) ||
          cache.match("./index.html")
        );
      })
    );
    return;
  }

  // Monaco proxy
  if (url.origin === self.location.origin && url.pathname.startsWith(PREFIX)) {
    event.respondWith(monacoProxy(req, url));
    return;
  }

  // Pyodide proxy
  if (url.origin === self.location.origin && url.pathname.startsWith(PY_PREFIX)) {
    event.respondWith(pyodideProxy(req, url));
    return;
  }

  // Generic CDN proxy
  if (url.origin === self.location.origin && url.pathname.startsWith(CDN_PREFIX)) {
    event.respondWith(genericCdnProxy(req, url));
    return;
  }

  // Monaco jsDelivr
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("monaco-editor")) {
    event.respondWith(monacoCdn(req, url));
    return;
  }

  // Pyodide CDN
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("/pyodide/")) {
    event.respondWith(cacheThenNetwork(PYODIDE_CACHE, req, url, offlinePyodide));
    return;
  }

  // Other jsdelivr / esm / cdnjs / google fonts
  if (
    url.hostname === "cdn.jsdelivr.net" ||
    url.hostname === "esm.sh" ||
    url.hostname === "cdnjs.cloudflare.com" ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(cacheThenNetwork(CDN_CACHE, req, url, offlineCdn || offlineReact));
    return;
  }

  if (url.origin !== self.location.origin) return;

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
      const isAsset =
        /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|css|js|mjs|json|webmanifest|map|wasm)$/i.test(
          url.pathname
        );
      try {
        const net = await fetch(req);
        const ct = (net.headers.get("Content-Type") || "").toLowerCase();
        if (net.ok && !(isAsset && ct.includes("text/html"))) {
          cache.put(req, net.clone()).catch(() => {});
          return net;
        }
        if (net.ok && isAsset && ct.includes("text/html")) {
          return (await cache.match(req)) || new Response("/* asset missing */", { status: 404 });
        }
        return net;
      } catch {
        const hit = await cache.match(req);
        if (hit) return hit;
        if (isAsset || req.destination === "image" || req.destination === "font") {
          return new Response("", { status: 404 });
        }
        return (await cache.match("./index.html")) || new Response("offline", { status: 503 });
      }
    })
  );
});

async function cacheThenNetwork(cacheName, req, url, shouldCache) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req, { mode: "cors", credentials: "omit", redirect: "follow" });
    if (!res.ok) return res;
    if (!shouldCache) return res;
    const buf = await res.arrayBuffer();
    const headers = new Headers({
      "Content-Type": res.headers.get("Content-Type") || mimeFor(url.pathname),
      "Cache-Control": "public, max-age=31536000, no-transform",
    });
    const out = new Response(buf, { status: 200, headers });
    await cache.put(req, out.clone());
    return out;
  } catch {
    return (await cache.match(req)) || new Response("/* offline miss */", { status: 503 });
  }
}

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

async function pyodideProxy(req, url) {
  const rel = url.pathname.slice(PY_PREFIX.length);
  const remote = "https://cdn.jsdelivr.net/pyodide/" + rel + url.search;
  const cache = await caches.open(PYODIDE_CACHE);
  const hit = (await cache.match(req)) || (await cache.match(remote));
  if (hit) return hit;
  try {
    const res = await fetch(remote, { mode: "cors", credentials: "omit" });
    if (!res.ok) return res;
    const buf = await res.arrayBuffer();
    const out = await putBoth(cache, req.url, remote, buf, mimeFor(rel));
    return out;
  } catch {
    return (
      (await cache.match(req)) ||
      new Response("/* pyodide offline miss */", {
        status: 503,
        headers: { "Content-Type": "application/javascript" },
      })
    );
  }
}

async function genericCdnProxy(req, url) {
  const rest = url.pathname.slice(CDN_PREFIX.length);
  let remote;
  if (rest.startsWith("jsdelivr/")) remote = "https://cdn.jsdelivr.net/" + rest.slice(9) + url.search;
  else if (rest.startsWith("esm/")) remote = "https://esm.sh/" + rest.slice(4) + url.search;
  else if (rest.startsWith("cdnjs/")) remote = "https://cdnjs.cloudflare.com/" + rest.slice(6) + url.search;
  else if (rest.startsWith("gfonts/")) remote = "https://fonts.googleapis.com/" + rest.slice(7) + url.search;
  else if (rest.startsWith("gstatic/")) remote = "https://fonts.gstatic.com/" + rest.slice(8) + url.search;
  else return new Response("bad __cdn__ path", { status: 400 });

  const cache = await caches.open(CDN_CACHE);
  const hit = (await cache.match(req)) || (await cache.match(remote));
  if (hit) return hit;
  try {
    const res = await fetch(remote, { mode: "cors", credentials: "omit", redirect: "follow" });
    if (!res.ok) return res;
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("Content-Type") || mimeFor(remote);
    return putBoth(cache, req.url, remote, buf, ct);
  } catch {
    return (await cache.match(req)) || new Response("/* cdn offline */", { status: 503 });
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "WARM_MONACO") event.waitUntil(warmMonaco());
  if (data.type === "WARM_PYODIDE") {
    offlinePyodide = true;
    event.waitUntil(saveFlags().then(() => warmPyodide()));
  }
  if (data.type === "WARM_REACT" || data.type === "WARM_CDN") {
    offlineReact = true;
    offlineCdn = true;
    event.waitUntil(saveFlags().then(() => warmExternal()));
  }
  if (data.type === "WARM_ALL") {
    offlinePyodide = offlineReact = offlineCdn = true;
    event.waitUntil(
      saveFlags().then(() =>
        Promise.all([
          warmMonaco(),
          warmPyodide(),
          warmExternal(),
          warmVortexChat(),
          warmN3xnChat(),
          warmMinecraftOffline(),
        ])
      )
    );
  }
  if (data.type === "N3XN_SW_CONFIG") {
    if (typeof data.pyodide === "boolean") offlinePyodide = data.pyodide;
    if (typeof data.react === "boolean") offlineReact = data.react;
    if (typeof data.cdn === "boolean") offlineCdn = data.cdn;
    event.waitUntil(
      (async () => {
        await saveFlags();
        if (offlinePyodide) await warmPyodide();
        if (offlineReact || offlineCdn) await warmExternal();
        event.source?.postMessage?.({
          type: "N3XN_SW_CONFIG_OK",
          pyodide: offlinePyodide,
          react: offlineReact,
          cdn: offlineCdn,
        });
      })()
    );
  }
  if (data.type === "N3XN_SW_STATUS") {
    event.waitUntil(
      (async () => {
        await loadFlags();
        event.source?.postMessage?.({
          type: "N3XN_SW_STATUS",
          pyodide: offlinePyodide,
          react: offlineReact,
          cdn: offlineCdn,
        });
      })()
    );
  }
});
