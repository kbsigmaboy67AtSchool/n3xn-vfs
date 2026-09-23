/**
 * n3xn xdebug v2 — advanced non-AI debugger
 * - Syntax + common logic smells (warn/info/hint)
 * - Live runtime probe (isolated iframe for JS/HTML)
 * - tryfix for recoverable syntax issues
 * - Overlays, folder/ZIP sweeps
 */

import * as fs from "./fs.js";

const lastFindings = []; // all severities
const MAX_FINDINGS = 80;

export function getLastErrors() {
  return lastFindings.filter((f) => f.severity === "error" || f.fatal);
}
export function getLastFindings() {
  return lastFindings.slice();
}

function remember(f) {
  lastFindings.push({ ...f, ts: Date.now() });
  while (lastFindings.length > MAX_FINDINGS) lastFindings.shift();
  return f;
}

function extOf(path) {
  const n = (path || "").split("/").pop() || "";
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i + 1).toLowerCase() : "";
}

function linesOf(text) {
  return String(text || "").split(/\r?\n/);
}

function lineAt(text, index) {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

function snippet(text, line1based, radius = 2, col = 0) {
  const lines = linesOf(text);
  const i = Math.max(0, (line1based || 1) - 1);
  const from = Math.max(0, i - radius);
  const to = Math.min(lines.length - 1, i + radius);
  const out = [];
  for (let j = from; j <= to; j++) {
    const num = String(j + 1).padStart(4);
    out.push(`${num} │ ${lines[j] ?? ""}`);
    if (j === i) out.push(`     ${" ".repeat(Math.max(0, col))}  ^`);
  }
  return out;
}

export function formatOverlay(err) {
  const width = 47;
  const bar = "─".repeat(width);
  const sev = (err.severity || (err.fatal ? "error" : "warn")).toUpperCase();
  const title =
    sev === "ERROR"
      ? "N3XN RUNTIME / ERROR"
      : sev === "WARN"
        ? "N3XN WARNING"
        : sev === "INFO"
          ? "N3XN INFO"
          : "N3XN HINT";
  const lines = [];
  lines.push(`┌${bar}┐`);
  lines.push(`│ ${title.padEnd(width - 1)}│`);
  lines.push(`├${bar}┤`);
  const loc = `${err.path || "?"}${err.line ? ":" + err.line : ""}${err.rule ? "  [" + err.rule + "]" : ""}`;
  lines.push(`│ ${loc.slice(0, width - 2).padEnd(width - 1)}│`);
  lines.push(`│${" ".repeat(width)}│`);
  wrap(err.message || "unknown", width - 2).forEach((m) =>
    lines.push(`│ ${m.padEnd(width - 1)}│`)
  );
  if (err.detail) {
    wrap(String(err.detail), width - 2).forEach((m) => lines.push(`│ ${m.padEnd(width - 1)}│`));
  }
  lines.push(`│${" ".repeat(width)}│`);
  (err.context || []).forEach((c) => lines.push(`│ ${c.slice(0, width - 2).padEnd(width - 1)}│`));
  if (err.fixable) {
    lines.push(`│ ${"[tryfix available]".padEnd(width - 1)}│`);
  }
  lines.push(`│ ${"[Open] [Copy] [Fix-prompt] [tryfix]".padEnd(width - 1)}│`);
  lines.push(`└${bar}┘`);
  return lines;
}

function wrap(s, w) {
  const out = [];
  let t = String(s);
  while (t.length > w) {
    out.push(t.slice(0, w));
    t = t.slice(w);
  }
  if (t || !out.length) out.push(t);
  return out;
}

function finding(partial) {
  return remember({
    severity: "warn",
    fatal: false,
    fixable: false,
    ...partial,
  });
}

/* ========== Advanced static rules (non-AI) ========== */

function analyzeJsSmells(path, text) {
  const findings = [];
  const lines = linesOf(text);

  lines.forEach((line, i) => {
    const n = i + 1;
    const t = line.trim();
    if (/\/\//.test(line) && t.startsWith("//")) return;

    // == instead of ===
    if (/[^=!]==[^=]/.test(line) && !/===/.test(line)) {
      findings.push(
        finding({
          path,
          line: n,
          severity: "warn",
          rule: "eqeqeq",
          message: "Use ===/!== instead of ==/!= (type coercion)",
          context: snippet(text, n),
        })
      );
    }
    // var usage
    if (/\bvar\s+\w+/.test(line)) {
      findings.push(
        finding({
          path,
          line: n,
          severity: "info",
          rule: "no-var",
          message: "Prefer let/const over var",
          context: snippet(text, n),
        })
      );
    }
    // empty catch
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line) || (t.startsWith("catch") && lines[i + 1]?.trim() === "}")) {
      findings.push(
        finding({
          path,
          line: n,
          severity: "warn",
          rule: "empty-catch",
          message: "Empty catch — errors will be swallowed",
          context: snippet(text, n),
        })
      );
    }
    // console.log left behind
    if (/\bconsole\.(log|debug|info)\s*\(/.test(line)) {
      findings.push(
        finding({
          path,
          line: n,
          severity: "hint",
          rule: "no-console",
          message: "console.log in production code?",
          context: snippet(text, n),
        })
      );
    }
    // debugger statement
    if (/\bdebugger\b/.test(line)) {
      findings.push(
        finding({
          path,
          line: n,
          severity: "warn",
          rule: "no-debugger",
          message: "debugger statement",
          context: snippet(text, n),
        })
      );
    }
    // eval
    if (/\beval\s*\(/.test(line)) {
      findings.push(
        finding({
          path,
          line: n,
          severity: "error",
          fatal: true,
          rule: "no-eval",
          message: "eval() is dangerous and hard to debug",
          context: snippet(text, n),
        })
      );
    }
    // == null intentional often — skip
    // floating promise: void fetch / somePromise( without await in async - soft
    if (/\b(fetch|axios)\s*\(/.test(line) && !/await/.test(line) && !/\.then\s*\(/.test(line) && !/void\s+/.test(line)) {
      findings.push(
        finding({
          path,
          line: n,
          severity: "info",
          rule: "floating-promise",
          message: "fetch/axios without await/.then — unhandled rejection risk",
          context: snippet(text, n),
        })
      );
    }
  });

  // Unused simple const/let (heuristic: declared once, never read)
  const decl = [...text.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)];
  for (const m of decl) {
    const name = m[1];
    if (name.startsWith("_")) continue;
    const re = new RegExp("\\b" + name + "\\b", "g");
    const count = (text.match(re) || []).length;
    if (count <= 1) {
      findings.push(
        finding({
          path,
          line: lineAt(text, m.index),
          severity: "hint",
          rule: "unused-var",
          message: `Possible unused variable '${name}'`,
          context: snippet(text, lineAt(text, m.index)),
        })
      );
    }
  }

  // React smells
  if (/\.(jsx|tsx)$/i.test(path) || /from\s+['"]react['"]/.test(text)) {
    if (/\.map\s*\(\s*\([^)]*\)\s*=>/.test(text) && !/key\s*=/.test(text)) {
      findings.push(
        finding({
          path,
          severity: "warn",
          rule: "react-key",
          message: "Array .map() may be missing key={...} on elements",
        })
      );
    }
    if (/componentDidMount|componentWillMount/.test(text) && /useState|useEffect/.test(text)) {
      findings.push(
        finding({
          path,
          severity: "info",
          rule: "react-mixed-mode",
          message: "Mix of class lifecycle and hooks in same file",
        })
      );
    }
    if (/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*fetch/.test(text) && !/return\s*\(\s*\)\s*=>/.test(text)) {
      findings.push(
        finding({
          path,
          severity: "info",
          rule: "useeffect-cleanup",
          message: "useEffect with fetch may need abort/cleanup",
        })
      );
    }
  }

  // Balance
  const pairs = [
    ["{", "}", "braces"],
    ["(", ")", "parens"],
    ["[", "]", "brackets"],
  ];
  for (const [a, b, name] of pairs) {
    const ca = (text.match(new RegExp("\\" + a, "g")) || []).length;
    const cb = (text.match(new RegExp("\\" + b, "g")) || []).length;
    if (ca !== cb) {
      findings.push(
        finding({
          path,
          severity: "error",
          fatal: true,
          fixable: true,
          rule: "balance-" + name,
          message: `Unbalanced ${name}: ${a}=${ca} ${b}=${cb}`,
          fixKind: "balance",
          fixData: { open: a, close: b, delta: ca - cb },
        })
      );
    }
  }

  return findings;
}

function analyzePythonSmells(path, text) {
  const findings = [];
  const lines = linesOf(text);
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/except\s*:/.test(line) || /except\s+Exception\s*:/.test(line) && !/as\s+/.test(line)) {
      if (/except\s*:/.test(line)) {
        findings.push(
          finding({
            path,
            line: n,
            severity: "warn",
            rule: "bare-except",
            message: "Bare except: — catches SystemExit/KeyboardInterrupt too",
            context: snippet(text, n),
          })
        );
      }
    }
    if (/def\s+\w+\s*\([^)]*=\s*(\[\]|\{\})/.test(line)) {
      findings.push(
        finding({
          path,
          line: n,
          severity: "error",
          fatal: false,
          rule: "mutable-default",
          message: "Mutable default argument (list/dict) — shared across calls",
          context: snippet(text, n),
        })
      );
    }
    if (/\bis\s+["']|\bis\s+\d/.test(line)) {
      findings.push(
        finding({
          path,
          line: n,
          severity: "warn",
          rule: "is-literal",
          message: "Use == for literals, not 'is'",
          context: snippet(text, n),
        })
      );
    }
  });
  if (text.includes("\t") && /^ {2,}/m.test(text)) {
    findings.push(
      finding({
        path,
        severity: "warn",
        rule: "mixed-indent",
        message: "Mixed tabs and spaces",
      })
    );
  }
  return findings;
}

function analyzeHtmlSmells(path, text) {
  const findings = [];
  if (/<script[^>]*src=/i.test(text) && /http:\/\//i.test(text)) {
    findings.push(
      finding({
        path,
        severity: "warn",
        rule: "mixed-content",
        message: "HTTP script src on HTTPS pages may be blocked",
      })
    );
  }
  if (/onclick\s*=/i.test(text)) {
    findings.push(
      finding({
        path,
        severity: "hint",
        rule: "inline-handler",
        message: "Inline onclick= — prefer addEventListener",
      })
    );
  }
  if (!/charset/i.test(text) && /<html/i.test(text)) {
    findings.push(
      finding({
        path,
        severity: "info",
        rule: "charset",
        message: "Missing <meta charset>",
      })
    );
  }
  return findings;
}

/* ========== Core type checkers ========== */

async function checkJson(path, text) {
  const findings = [];
  try {
    JSON.parse(text);
  } catch (e) {
    let line = 1;
    const m = String(e.message).match(/position\s+(\d+)/i);
    if (m) line = lineAt(text, parseInt(m[1], 10));
    findings.push(
      finding({
        path,
        line,
        severity: "error",
        fatal: true,
        fixable: true,
        rule: "json-parse",
        message: e.message,
        context: snippet(text, line),
        fixKind: "json",
      })
    );
  }
  return pack(path, findings, ["JSON"]);
}

async function checkJs(path, text) {
  let findings = analyzeJsSmells(path, text);
  if (window.Babel) {
    try {
      window.Babel.transform(text, {
        filename: path,
        presets: [
          ["react", { runtime: "classic" }],
          ["typescript", { isTSX: /\.tsx?$/i.test(path), allExtensions: true }],
        ],
        sourceType: "module",
      });
    } catch (e) {
      const line = e.loc?.line || 1;
      findings.push(
        finding({
          path,
          line,
          severity: "error",
          fatal: true,
          fixable: true,
          rule: "babel",
          message: e.message || String(e),
          context: snippet(text, line),
          fixKind: "babel-syntax",
          fixData: { original: e },
        })
      );
    }
  }
  return pack(path, findings, ["JS/JSX static", window.Babel ? "Babel" : "Babel skipped"]);
}

async function checkHtml(path, text) {
  const findings = analyzeHtmlSmells(path, text);
  try {
    const doc = new DOMParser().parseFromString(text, "text/html");
    if (doc.querySelector("parsererror")) {
      findings.push(
        finding({
          path,
          severity: "error",
          fatal: true,
          rule: "html-parse",
          message: "HTML parsererror",
          detail: doc.querySelector("parsererror").textContent.slice(0, 160),
        })
      );
    }
  } catch (e) {
    findings.push(finding({ path, severity: "error", fatal: true, message: e.message }));
  }
  const o = (text.match(/<script/gi) || []).length;
  const c = (text.match(/<\/script>/gi) || []).length;
  if (o !== c) {
    findings.push(
      finding({
        path,
        severity: "error",
        fatal: true,
        fixable: true,
        rule: "script-tags",
        message: `Unbalanced script tags open=${o} close=${c}`,
        fixKind: "html-script",
      })
    );
  }
  return pack(path, findings, ["HTML"]);
}

async function checkCss(path, text) {
  const findings = [];
  const o = (text.match(/\{/g) || []).length;
  const c = (text.match(/\}/g) || []).length;
  if (o !== c) {
    findings.push(
      finding({
        path,
        severity: "error",
        fatal: true,
        fixable: true,
        rule: "css-braces",
        message: `CSS brace mismatch {=${o} }=${c}`,
        fixKind: "balance",
        fixData: { open: "{", close: "}", delta: o - c },
      })
    );
  }
  if (/!important/g.test(text) && (text.match(/!important/g) || []).length > 5) {
    findings.push(
      finding({
        path,
        severity: "hint",
        rule: "important-spam",
        message: "Many !important flags — specificity issues?",
      })
    );
  }
  return pack(path, findings, ["CSS"]);
}

async function checkPython(path, text) {
  return pack(path, analyzePythonSmells(path, text), ["Python static"]);
}

async function checkImage(path, bytes, mime) {
  const findings = [];
  try {
    const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(blob);
      findings.push(
        finding({
          path,
          severity: "info",
          rule: "image-ok",
          message: `Image OK ${bmp.width}×${bmp.height}`,
        })
      );
      bmp.close?.();
    } else {
      await new Promise((res, rej) => {
        const u = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(u);
          res();
        };
        img.onerror = () => {
          URL.revokeObjectURL(u);
          rej(new Error("Invalid image data"));
        };
        img.src = u;
      });
    }
  } catch (e) {
    findings.push(
      finding({
        path,
        severity: "error",
        fatal: true,
        rule: "image-decode",
        message: e.message || "Image decode failed",
      })
    );
  }
  return pack(path, findings, ["Image"]);
}

async function checkNexc(path, text) {
  const findings = [];
  try {
    const nexc = await import("./nexc.js");
    const parsed = nexc.parseNexc(text);
    findings.push(
      finding({
        path,
        severity: "info",
        rule: "nexc-ok",
        message: `${parsed.meta.name} modules=[${Object.keys(parsed.modules).join(",")}]`,
      })
    );
    if (!parsed.permissions.length) {
      findings.push(
        finding({
          path,
          severity: "warn",
          rule: "nexc-perms",
          message: "No [permissions] section",
        })
      );
    }
  } catch (e) {
    findings.push(
      finding({ path, severity: "error", fatal: true, rule: "nexc-parse", message: e.message })
    );
  }
  return pack(path, findings, ["nexc"]);
}

async function checkN3Site(path, text) {
  const findings = [];
  const re = /_;:\(([^)]*)\)\[([^\]]*)\]\{([^}]*)\}(blob|data)?/gi;
  const base = path.replace(/\/[^/]+$/, "") || "/";
  for (const m of text.matchAll(re)) {
    const ref = m[3].trim();
    let resolved = ref.startsWith("/") ? ref : `${base}/${ref}`;
    const parts = [];
    for (const seg of resolved.replace(/\\/g, "/").split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    resolved = "/" + parts.join("/");
    const f = await fs.readFile(resolved);
    if (!f) {
      findings.push(
        finding({
          path,
          severity: "error",
          fatal: true,
          rule: "n3site-asset",
          message: `Missing asset ${ref} → ${resolved}`,
        })
      );
    }
  }
  const htmlRes = await checkHtml(path, text.replace(re, ""));
  return pack(path, findings.concat(htmlRes.findings || []), ["n3-site"]);
}

function pack(path, findings, checks) {
  const errors = findings.filter((f) => f.severity === "error");
  return {
    ok: errors.length === 0,
    path,
    checks,
    findings,
    errors,
    warnings: findings.filter((f) => f.severity === "warn"),
    infos: findings.filter((f) => f.severity === "info" || f.severity === "hint"),
  };
}

/* ========== Live runtime probe ========== */

export async function liveProbe(path, text, { timeoutMs = 2500 } = {}) {
  const findings = [];
  const ext = extOf(path);
  const isHtml = ext === "html" || ext === "htm" || ext === "n3-site";
  const isJs = ["js", "jsx", "mjs"].includes(ext);

  let html;
  if (isHtml) {
    html = text;
  } else if (isJs) {
    html = `<!DOCTYPE html><html><body><script type="module">
${text}
</script></body></html>`;
  } else {
    return findings;
  }

  // Instrument: wrap to catch errors
  const probeHtml = html.replace(
    "</head>",
    `<script>
window.__n3xnLiveErrors=[];
window.addEventListener('error',function(e){
  window.__n3xnLiveErrors.push({type:'error',msg:e.message,file:e.filename,line:e.lineno,col:e.colno});
});
window.addEventListener('unhandledrejection',function(e){
  window.__n3xnLiveErrors.push({type:'rejection',msg:String(e.reason&&e.reason.message||e.reason)});
});
var c=console;
['log','warn','error'].forEach(function(k){
  var o=c[k].bind(c);
  c[k]=function(){
    window.__n3xnLiveErrors.push({type:'console-'+k,msg:[].slice.call(arguments).join(' ')});
    return o.apply(null,arguments);
  };
});
</script></head>`
  );
  if (!probeHtml.includes("__n3xnLiveErrors")) {
    // no head — prepend
    html = probeHtml;
  } else {
    html = probeHtml;
  }

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  await new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-scripts";
    iframe.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0";
    iframe.src = url;
    const done = () => {
      try {
        const errs = iframe.contentWindow?.__n3xnLiveErrors || [];
        for (const e of errs) {
          if (e.type === "console-log") continue;
          findings.push(
            finding({
              path,
              line: e.line || undefined,
              severity: e.type === "console-warn" ? "warn" : e.type === "console-error" || e.type === "error" || e.type === "rejection" ? "error" : "info",
              fatal: e.type === "error" || e.type === "rejection",
              rule: "live-" + e.type,
              message: e.msg || "live error",
              detail: e.file ? `at ${e.file}` : undefined,
            })
          );
        }
      } catch (_) {
        /* cross-origin sandbox ok */
      }
      iframe.remove();
      URL.revokeObjectURL(url);
      resolve();
    };
    iframe.onload = () => setTimeout(done, Math.min(timeoutMs, 800));
    iframe.onerror = () => done();
    document.body.appendChild(iframe);
    setTimeout(done, timeoutMs);
  });

  return findings;
}

/* ========== tryfix (deterministic, non-AI) ========== */

export async function tryFix(path, text, findings) {
  let out = text;
  const applied = [];
  const list = findings || getLastFindings().filter((f) => f.path === path || f.path?.startsWith(path));

  for (const f of list) {
    if (!f.fixable && f.fixKind !== "balance" && f.fixKind !== "json") continue;

    if (f.fixKind === "balance" && f.fixData) {
      const { close, delta } = f.fixData;
      if (delta > 0 && delta < 20) {
        out = out + "\n" + close.repeat(delta);
        applied.push(`Appended ${delta} closing '${close}'`);
      }
    }
    if (f.fixKind === "json" || f.rule === "json-parse") {
      // trailing comma fix
      const fixed = out.replace(/,\s*([}\]])/g, "$1");
      if (fixed !== out) {
        try {
          JSON.parse(fixed);
          out = fixed;
          applied.push("Removed trailing commas");
        } catch (_) {}
      }
    }
    if (f.rule === "eqeqeq" && f.line) {
      const lines = linesOf(out);
      const i = f.line - 1;
      if (lines[i]) {
        const nl = lines[i].replace(/([^=!])==([^=])/g, "$1===$2").replace(/!=([^=])/g, "!==$1");
        if (nl !== lines[i]) {
          lines[i] = nl;
          out = lines.join("\n");
          applied.push(`Line ${f.line}: == → ===`);
        }
      }
    }
  }

  // Generic: unmatched braces at EOF
  const o = (out.match(/\{/g) || []).length;
  const c = (out.match(/\}/g) || []).length;
  if (o > c && o - c < 15) {
    out = out + "\n" + "}".repeat(o - c);
    applied.push(`EOF: added ${o - c} '}'`);
  }

  return { text: out, applied, changed: out !== text };
}

/* ========== Public API ========== */

export async function xdebugBuffer(path, bytes, text, mime, opts = {}) {
  const ext = extOf(path);
  const isImg =
    (mime || "").startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"].includes(ext);

  let result;
  if (isImg) result = await checkImage(path, bytes, mime);
  else if (ext === "json") result = await checkJson(path, text);
  else if (["js", "jsx", "ts", "tsx", "mjs"].includes(ext)) result = await checkJs(path, text);
  else if (ext === "html" || ext === "htm") result = await checkHtml(path, text);
  else if (ext === "css") result = await checkCss(path, text);
  else if (ext === "py") result = await checkPython(path, text);
  else if (ext === "nexc") result = await checkNexc(path, text);
  else if (ext === "n3-site") result = await checkN3Site(path, text);
  else if (ext === "zip") result = await checkZip(path, bytes);
  else {
    result = pack(path, [], [`generic ${mime || ext}`]);
  }

  if (opts.live && (["html", "htm", "js", "mjs"].includes(ext) || (ext === "jsx" && window.Babel))) {
    try {
      let liveText = text;
      if (ext === "jsx" && window.Babel) {
        liveText = window.Babel.transform(text, {
          presets: ["react"],
          filename: path,
        }).code;
      }
      const live = await liveProbe(path, liveText, { timeoutMs: opts.liveTimeout || 2500 });
      result.findings = (result.findings || []).concat(live);
      result.errors = result.findings.filter((f) => f.severity === "error");
      result.warnings = result.findings.filter((f) => f.severity === "warn");
      result.ok = result.errors.length === 0;
      result.checks = (result.checks || []).concat(["live-probe"]);
    } catch (e) {
      result.findings.push(
        finding({ path, severity: "warn", rule: "live-fail", message: "Live probe: " + e.message })
      );
    }
  }

  return result;
}

async function checkZip(path, bytes) {
  const findings = [];
  try {
    if (!window.JSZip) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const zip = await JSZip.loadAsync(bytes);
    const children = [];
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir) continue;
      const data = await zip.files[name].async("uint8array");
      let text = "";
      try {
        text = new TextDecoder().decode(data);
      } catch {}
      const r = await xdebugBuffer(path + "#" + name, data, text, null, { live: false });
      children.push(r);
    }
    return {
      ok: children.every((c) => c.ok),
      path,
      checks: [`zip ${children.length} files`],
      findings,
      children,
      errors: [],
      warnings: [],
    };
  } catch (e) {
    findings.push(finding({ path, severity: "error", fatal: true, message: "ZIP: " + e.message }));
    return pack(path, findings, ["zip"]);
  }
}

export async function xdebugPath(path, opts = {}) {
  if (path == null || path === "") {
    throw new Error("xdebug: no path (open a file or pass a VFS path)");
  }
  path = String(path);
  path = path.startsWith("/") ? path : "/" + path;
  if (typeof fs.isDir === "function" && fs.isDir(path)) {
    return xdebugDir(path, opts);
  }
  try {
    if (fs.ls?.(path)?.length >= 0 && !fs.readFile) {
      /* noop */
    }
  } catch {}
  // dir detection via ls
  try {
    const entries = fs.ls?.(path);
    if (entries && !await fs.readFile(path)) {
      return xdebugDir(path, opts);
    }
  } catch {}

  const f = await fs.readFile(path);
  if (!f) {
    // maybe directory
    try {
      const entries = fs.ls(path);
      if (entries) return xdebugDir(path, opts);
    } catch {}
    throw new Error("Not found: " + path);
  }
  let text = "";
  try {
    text = f.text();
  } catch {}
  return xdebugBuffer(path, f.content, text, f.mime, opts);
}

export async function xdebugDir(path, opts = {}) {
  const all = typeof fs.flatten === "function" ? fs.flatten(path) : [];
  const files = all.filter((e) => e.type !== "dir");
  const children = [];
  for (const e of files) {
    try {
      children.push(await xdebugPath(e.path, { ...opts, live: false }));
    } catch (err) {
      children.push(
        pack(e.path, [finding({ path: e.path, severity: "error", fatal: true, message: err.message })], [])
      );
    }
  }
  return {
    ok: children.every((c) => c.ok),
    path,
    checks: [`dir ${files.length} files`],
    findings: [],
    children,
    errors: [],
    warnings: [],
  };
}

export function formatReport(result, path) {
  const lines = [];
  lines.push("XDEBUG " + (path || result.path || ""));
  lines.push("────────────────────────");
  (result.checks || []).forEach((c) => lines.push("✓ " + c));

  const all = collectFindings(result);
  const order = { error: 0, warn: 1, info: 2, hint: 3 };
  all.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  const counts = { error: 0, warn: 0, info: 0, hint: 0 };
  for (const f of all) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
    if (f.severity === "error" || f.severity === "warn") {
      formatOverlay(f).forEach((l) => lines.push(l));
    } else {
      lines.push(`${f.severity === "hint" ? "·" : "ℹ"} [${f.rule || ""}] ${f.message}`);
    }
  }
  lines.push("");
  lines.push(
    `Summary: ${counts.error} error(s), ${counts.warn} warn(s), ${counts.info} info, ${counts.hint} hint(s)`
  );
  if (all.some((f) => f.fixable)) {
    lines.push("Tip: xdebug tryfix <file>  — apply safe syntax fixes");
  }
  return lines;
}

function collectFindings(result) {
  let all = [...(result.findings || [])];
  if (result.children) {
    for (const ch of result.children) all = all.concat(collectFindings(ch));
  }
  return all;
}

export function fixPrompt(err) {
  return (
    `Fix this in ${err.path || "file"}` +
    (err.line ? `:${err.line}` : "") +
    ` [${err.rule || "error"}]\n${err.message}\n` +
    (err.context ? err.context.join("\n") : "")
  );
}


/** Bridge to n3xn DevTools panel */
export async function openDevtools() {
  const dt = await import("./n3xn-devtools.js");
  dt.mountHostDevtools();
  dt.openDevtools();
}
