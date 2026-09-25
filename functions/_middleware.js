/**
 * n3xn Pages middleware
 *
 * /__proxy__/mc/<id-or-file>  — Minecraft assets (upstream mapped SERVER-SIDE only)
 * /__proxy__/skin/<file>      — skin PNGs
 * /__proxy__/$/domain/path    — generic allowlisted proxy (still JS-only)
 *
 * Navigation / missing X-N3xn-Proxy → 404
 * Clients never need github.com URLs.
 */

const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const ALLOWED_HOST_SUFFIXES = [
  "github.com",
  "githubusercontent.com",
  "github.io",
  "jsdelivr.net",
  "cdnjs.cloudflare.com",
  "esm.sh",
  "unpkg.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

/** Server-only catalog — not sent to clients as upstream URLs */
const MC_FILES = {
  "1.8-better": "Xclounkit234X.wasm-gc.1.8.better.version.html",
  "1.8": "Xclounkit234X.MINECRAFT.1.8.html",
  "1.12": "Xclounkit234X.MINECRAFT.1.12.html",
  "1.14": "Xclounkit234X.MINECRAFT.1.14.4.html",
  "1.16": "Xclounkit234X.MINECRAFT.1.16.html",
  "1.20.6": "Xclounkit234X.MINECRAFT.1.20.6.html",
  "1.21.11": "Xclounkit234X.MINECRAFT.1.21.11.html",
  "1.21.11-mobile": "1.21.11-mobile.html",
  "1.21.11-desktop": "1.21.11-desktop.html",
  "26.2": "26.2.html",
  "0.6.1-pe": "0.6.1-pe.html",
  "1.6.4-wasm": "1.6.4-modpack-wasm.html",
};

function releaseUrl(tag, file) {
  // Built only on the edge — never returned in JSON to the page
  const host = "github.com";
  const user = "kbsigmaboy67AtSchool";
  const repo = "minecraft";
  return `https://${host}/${user}/${repo}/releases/download/${tag}/${file}`;
}

function isAllowedHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h || h.includes("..")) return false;
  return ALLOWED_HOST_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
}

function isBrowserNavigation(request) {
  const mode = (request.headers.get("Sec-Fetch-Mode") || "").toLowerCase();
  const dest = (request.headers.get("Sec-Fetch-Dest") || "").toLowerCase();
  if (mode === "navigate") return true;
  if (["document", "iframe", "frame", "embed", "object"].includes(dest)) return true;
  return false;
}

function isAuthorizedJsClient(request) {
  if (request.headers.get("X-N3xn-Proxy") !== "1") return false;
  const site = (request.headers.get("Sec-Fetch-Site") || "").toLowerCase();
  // Allow same-origin and same-site; block cross-site
  if (site === "cross-site") return false;
  return true;
}

function corsHeaders(request) {
  const h = new Headers();
  const origin = request.headers.get("Origin") || "";
  try {
    if (origin) {
      const o = new URL(origin);
      const here = new URL(request.url);
      if (o.host === here.host) {
        h.set("Access-Control-Allow-Origin", origin);
        h.set("Vary", "Origin");
      }
    }
  } catch (_) {}
  h.set("Access-Control-Allow-Headers", "X-N3xn-Proxy, Content-Type, Accept");
  h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Cache-Control", "private, max-age=86400");
  return h;
}

function deny(status, msg, request) {
  const h = corsHeaders(request);
  h.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(msg || "Not Found", { status, headers: h });
}

async function fetchUpstream(targetUrl, request) {
  const headers = new Headers();
  const ua = request.headers.get("User-Agent");
  if (ua) headers.set("User-Agent", ua);
  headers.set("Accept", request.headers.get("Accept") || "*/*");
  const range = request.headers.get("Range");
  if (range) headers.set("Range", range);

  return fetch(targetUrl, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers,
    redirect: "follow",
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
}

function pipeUpstream(upstream, request, extraHeaders = {}) {
  const outHeaders = corsHeaders(request);
  const ct = upstream.headers.get("Content-Type");
  if (ct) outHeaders.set("Content-Type", ct);
  const cl = upstream.headers.get("Content-Length");
  if (cl) outHeaders.set("Content-Length", cl);
  const cr = upstream.headers.get("Content-Range");
  if (cr) outHeaders.set("Content-Range", cr);
  for (const [k, v] of Object.entries(extraHeaders)) outHeaders.set(k, v);
  // Never leak upstream URL to client
  outHeaders.set("X-N3xn-Proxy", "1");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

async function handleMcProxy(request, url) {
  // /__proxy__/mc/<id>  or  /__proxy__/mc/file/<filename>
  const parts = url.pathname.split("/").filter(Boolean);
  // ["__proxy__", "mc", ...]
  const rest = parts.slice(2);
  if (!rest.length) return deny(400, "Missing id", request);

  let file;
  let tag = "MINECRAFT";
  if (rest[0] === "file" && rest[1]) {
    file = decodeURIComponent(rest.slice(1).join("/"));
  } else {
    const id = decodeURIComponent(rest[0]).toLowerCase();
    file = MC_FILES[id];
    if (!file) {
      // allow direct filename as id if it looks like our asset
      const raw = decodeURIComponent(rest[0]);
      if (/\.html?$/i.test(raw)) file = raw;
    }
  }
  if (!file) return deny(404, "Unknown build id", request);

  const target = releaseUrl(tag, file);
  let upstream;
  try {
    upstream = await fetchUpstream(target, request);
  } catch (_) {
    return deny(502, "Upstream failed", request);
  }
  return pipeUpstream(upstream, request, { "X-N3xn-Mc-Id": rest[0] });
}

async function handleSkinProxy(request, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const file = decodeURIComponent(parts.slice(2).join("/"));
  if (!file || file.includes("..")) return deny(400, "Bad skin", request);
  const target = releaseUrl("minecraft_skins", file);
  let upstream;
  try {
    upstream = await fetchUpstream(target, request);
  } catch (_) {
    return deny(502, "Upstream failed", request);
  }
  return pipeUpstream(upstream, request);
}

async function handleDollarProxy(request, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("$");
  if (i < 0) return deny(404, "Not Found", request);
  const targetName = parts[i + 1];
  if (!targetName || !targetName.includes(".")) return deny(400, "Domain required", request);
  if (
    !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(
      targetName
    )
  ) {
    return deny(400, "Invalid domain", request);
  }
  if (!isAllowedHost(targetName)) return deny(403, "Host not allowed", request);

  const remaining = parts.slice(i + 2);
  const targetPath = remaining.length ? "/" + remaining.join("/") : "/";
  const target = new URL("https://" + targetName);
  target.pathname = targetPath;
  target.search = url.search;

  let upstream;
  try {
    upstream = await fetchUpstream(target.toString(), request);
  } catch (_) {
    return deny(502, "Upstream failed", request);
  }
  return pipeUpstream(upstream, request);
}

async function handleProxy(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (isBrowserNavigation(request)) return deny(404, "Not Found", request);
  if (!ALLOWED_METHODS.has(request.method)) return deny(405, "Method Not Allowed", request);
  if (!isAuthorizedJsClient(request)) return deny(404, "Not Found", request);

  const path = url.pathname;
  if (path.startsWith("/__proxy__/mc/") || path === "/__proxy__/mc") {
    return handleMcProxy(request, url);
  }
  if (path.startsWith("/__proxy__/skin/")) {
    return handleSkinProxy(request, url);
  }
  if (path.includes("/$/")) {
    return handleDollarProxy(request, url);
  }
  return deny(404, "Not Found", request);
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  if (url.pathname === "/__proxy__" || url.pathname.startsWith("/__proxy__/")) {
    return handleProxy(request);
  }
  return context.next();
}
