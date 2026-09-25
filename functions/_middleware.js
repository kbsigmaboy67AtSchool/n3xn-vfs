/**
 * n3xn Pages middleware
 * - /__proxy__/$/domain/path…  → JS-only fetch proxy (navigation → 404)
 * - everything else → context.next() (static site)
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
  if (site === "cross-site") return false;
  return true;
}

function parseDollarTarget(pathname) {
  // /__proxy__/$/github.com/user/repo/...
  const parts = pathname.split("/").filter(Boolean);
  const i = parts.indexOf("$");
  if (i < 0) return null;
  const targetName = parts[i + 1];
  if (!targetName) return null;
  const remaining = parts.slice(i + 2);
  const targetPath = remaining.length ? "/" + remaining.join("/") : "/";
  return { targetName, targetPath };
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
  h.set("Cache-Control", "private, max-age=3600");
  return h;
}

function deny(status, msg, request) {
  const h = corsHeaders(request);
  h.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(msg || "Not Found", { status, headers: h });
}

async function handleProxy(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  // Top-level navigation / iframe → look like missing file
  if (isBrowserNavigation(request)) {
    return deny(404, "Not Found", request);
  }

  if (!ALLOWED_METHODS.has(request.method)) {
    return deny(405, "Method Not Allowed", request);
  }

  if (!isAuthorizedJsClient(request)) {
    return deny(404, "Not Found", request);
  }

  const parsed = parseDollarTarget(url.pathname);
  if (!parsed) {
    return deny(404, "Not Found", request);
  }

  const { targetName, targetPath } = parsed;

  if (!targetName.includes(".")) {
    return deny(400, "Domain target required", request);
  }
  if (
    !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(
      targetName
    )
  ) {
    return deny(400, "Invalid domain", request);
  }
  if (!isAllowedHost(targetName)) {
    return deny(403, "Host not allowed", request);
  }

  const target = new URL("https://" + targetName);
  target.pathname = targetPath;
  target.search = url.search;

  const headers = new Headers();
  const ua = request.headers.get("User-Agent");
  if (ua) headers.set("User-Agent", ua);
  headers.set("Accept", request.headers.get("Accept") || "*/*");
  const range = request.headers.get("Range");
  if (range) headers.set("Range", range);

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      redirect: "follow",
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
  } catch (_) {
    return deny(502, "Upstream fetch failed", request);
  }

  const outHeaders = corsHeaders(request);
  const ct = upstream.headers.get("Content-Type");
  if (ct) outHeaders.set("Content-Type", ct);
  const cl = upstream.headers.get("Content-Length");
  if (cl) outHeaders.set("Content-Length", cl);
  const cr = upstream.headers.get("Content-Range");
  if (cr) outHeaders.set("Content-Range", cr);
  outHeaders.set("X-N3xn-Proxy-Upstream", target.hostname);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (url.pathname === "/__proxy__" || url.pathname.startsWith("/__proxy__/")) {
    return handleProxy(request);
  }

  // Static app + assets
  return context.next();
}
