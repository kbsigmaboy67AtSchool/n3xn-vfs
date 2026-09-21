/**
 * In-file n3xn run/display configuration
 *
 * Forms (any of):
 *   //!n3xn key=value
 *   // n3xn: key=value
 *   # n3xn: key=value
 *   -- n3xn: key=value
 *   block comment form also supported
 *
 * Common keys:
 *   run=entry|main|file.ext
 *   display=terminal|preview|iframe|canvas|none
 *   title=My App
 *   args=one two
 *   cwd=/project
 *   files=a.c,b.c,lib.h
 *   lang=c|cpp|rust|go|lua|python|js
 *   timeout=5000
 */

const LINE_RE =
  /^\s*(?:\/\/[!/]?\s*|\/\*\s*|#\s*|--\s*)n3xn\s*:?\s*(.+?)(?:\*\/)?\s*$/im;
const ALL_RE =
  /^\s*(?:\/\/[!/]?\s*|\/\*\s*|#\s*|--\s*)n3xn\s*:?\s*(.+?)(?:\*\/)?\s*$/gim;

export function parseN3xnConfig(source, defaults = {}) {
  const cfg = {
    run: null,
    display: "terminal",
    title: null,
    args: [],
    cwd: null,
    files: [],
    lang: null,
    timeout: 8000,
    ...defaults,
  };
  const text = String(source || "");
  let m;
  const re = new RegExp(ALL_RE.source, "gim");
  while ((m = re.exec(text))) {
    const body = m[1].trim();
    for (const part of splitPairs(body)) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const key = part.slice(0, eq).trim().toLowerCase();
      let val = part.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      applyKey(cfg, key, val);
    }
  }
  return cfg;
}

function splitPairs(body) {
  // key=value pairs separated by ; or ,
  const out = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) {
      if (c === q) q = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (c === ";" || c === ",") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function applyKey(cfg, key, val) {
  switch (key) {
    case "run":
    case "entry":
    case "main":
      cfg.run = val;
      break;
    case "display":
    case "out":
    case "output":
      cfg.display = val.toLowerCase();
      break;
    case "title":
      cfg.title = val;
      break;
    case "args":
      cfg.args = val.split(/\s+/).filter(Boolean);
      break;
    case "cwd":
    case "dir":
      cfg.cwd = val.startsWith("/") ? val : "/" + val;
      break;
    case "files":
    case "sources":
      cfg.files = val.split(/[,;\s]+/).filter(Boolean);
      break;
    case "lang":
    case "language":
      cfg.lang = val.toLowerCase();
      break;
    case "timeout":
      cfg.timeout = parseInt(val, 10) || cfg.timeout;
      break;
    default:
      cfg[key] = val;
  }
}

export function stripConfigLines(source) {
  return String(source || "")
    .split(/\r?\n/)
    .filter((l) => !LINE_RE.test(l))
    .join("\n");
}
