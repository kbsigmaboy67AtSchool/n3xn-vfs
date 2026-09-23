/**
 * n3xn DevTools integration (ES module)
 *
 * Host: loads standalone /devtools.js (ChromeOS-style bottom dock from git repo)
 * Blob / VFS HTML install: embeds the same standalone script into HTML files
 * No password gate (authenticate always true in standalone)
 */

const STANDALONE_SRC = "/devtools.js";
const CSS_SRC = "/css/devtools.css";

let hostScriptPromise = null;

/** Load full dock DevTools into the n3xn shell window */
export function mountHostDevtools() {
  if (typeof document === "undefined") return;
  if (window.__n3xn_devtools_host_loaded) return;
  window.__n3xn_devtools_host_loaded = true;

  if (!document.getElementById("n3xn_devtools_css_link")) {
    const link = document.createElement("link");
    link.id = "n3xn_devtools_css_link";
    link.rel = "stylesheet";
    link.href = CSS_SRC;
    link.onerror = () => {
      link.href =
        "https://cdn.jsdelivr.net/gh/kbsigmaboy67AtSchool/git@main/public/devtools.css";
    };
    document.head.appendChild(link);
  }

  if (!hostScriptPromise) {
    hostScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-n3xn-devtools-host]");
      if (existing) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = STANDALONE_SRC + "?v=" + Date.now();
      s.async = true;
      s.dataset.n3xnDevtoolsHost = "1";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load " + STANDALONE_SRC));
      document.head.appendChild(s);
    }).catch((e) => console.warn("[n3xn] DevTools host load", e));
  }
  return hostScriptPromise;
}

export function openDevtools() {
  mountHostDevtools();
  setTimeout(() => {
    try {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F12", bubbles: true })
      );
    } catch (_) {}
  }, 400);
}

export function closeDevtools() {
  try {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  } catch (_) {}
}

export async function getStandaloneScriptSource() {
  try {
    const res = await fetch(STANDALONE_SRC + "?inline=1");
    if (res.ok) return await res.text();
  } catch (_) {}
  try {
    const res = await fetch(
      "https://cdn.jsdelivr.net/gh/kbsigmaboy67AtSchool/git@main/public/devtools.js"
    );
    if (res.ok) return await res.text();
  } catch (_) {}
  throw new Error("Could not load standalone DevTools script");
}

export function injectIntoHtml(html, meta = {}) {
  const s = String(html || "");
  if (/data-n3xn-devtools=/.test(s)) return s;
  const headBits = `
<link rel="stylesheet" href="${CSS_SRC}" data-n3xn-devtools="css"
  onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/gh/kbsigmaboy67AtSchool/git@main/public/devtools.css'"/>
`;
  const boot = `
<script data-n3xn-devtools="1">
(function(){
  if(window.__n3xn_devtools_injected)return;
  window.__n3xn_devtools_injected=1;
  var s=document.createElement("script");
  s.src="${STANDALONE_SRC}";
  s.async=true;
  s.onerror=function(){
    s.onerror=null;
    s.src="https://cdn.jsdelivr.net/gh/kbsigmaboy67AtSchool/git@main/public/devtools.js";
  };
  document.documentElement.appendChild(s);
})();
</script>
`;
  let out = s;
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, headBits + "</head>");
  else out = headBits + out;
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, boot + "</body>");
  else out = out + boot;
  return out;
}

export async function injectIntoHtmlInline(html, meta = {}) {
  let script = await getStandaloneScriptSource();
  script = script.replace(
    /window\.prompt\(\s*["']n3xn DevTools password:["']\s*\)/g,
    "null"
  );
  const s = String(html || "");
  if (/data-n3xn-devtools-inline=/.test(s)) return s;
  const headBits = `
<link rel="stylesheet" href="${CSS_SRC}" data-n3xn-devtools="css"
  onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/gh/kbsigmaboy67AtSchool/git@main/public/devtools.css'"/>
`;
  const boot = `\n<script data-n3xn-devtools-inline="1">\n${script}\n</script>\n`;
  let out = s;
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, headBits + "</head>");
  else out = headBits + out;
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, boot + "</body>");
  else out = out + boot;
  return out;
}

export async function installToVfs(targets, opts = {}) {
  const fs = await import("./fs.js");
  const inline = !!opts.inline;
  const recursive = opts.recursive !== false;
  const results = [];

  async function walkDir(dir) {
    const entries = fs.ls(dir);
    for (const e of entries) {
      const p = (dir === "/" ? "" : dir) + "/" + e.name;
      if (e.type === "dir") {
        if (recursive) await walkDir(p);
      } else if (/\.html?$/i.test(e.name)) {
        await installOne(p);
      }
    }
  }

  async function installOne(path) {
    const f = await fs.readFile(path);
    if (!f) {
      results.push({ path, ok: false, error: "not found" });
      return;
    }
    let text = f.text();
    if (/data-n3xn-devtools/.test(text)) {
      results.push({ path, ok: true, skipped: true, note: "already installed" });
      return;
    }
    text = inline
      ? await injectIntoHtmlInline(text, { path })
      : injectIntoHtml(text, { path });
    await fs.writeFile(path, text, { mime: "text/html" });
    results.push({ path, ok: true, inline });
  }

  for (const raw of targets) {
    let path = String(raw).trim();
    if (!path.startsWith("/")) path = "/" + path.replace(/^\.\//, "");
    if (!fs.exists(path)) {
      results.push({ path, ok: false, error: "not found" });
      continue;
    }
    if (fs.isDir(path)) await walkDir(path);
    else await installOne(path);
  }
  return results;
}

export function parseInstallTargets(argStr, cwd = "/") {
  const s = String(argStr || "").trim();
  if (!s || s === "*" || s.toLowerCase() === "all") return [cwd === "/" ? "/" : cwd];
  return s
    .split(/[,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

if (typeof window !== "undefined") {
  const boot = () => {
    try {
      mountHostDevtools();
    } catch (e) {
      console.warn("[n3xn] DevTools", e);
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    setTimeout(boot, 0);
  }
  window.__n3xnOpenDevtools = openDevtools;
}
