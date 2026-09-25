/**
 * n3xn language / multifile project runner
 * - Lua: Wasmoon (real WASM)
 * - C/C++/Rust/Go: multifile project packaging + diagnostics + optional WASM artifact run
 * - Shared in-file //!n3xn config + project discovery
 */

import * as fs from "./fs.js";
import { parseN3xnConfig, stripConfigLines } from "./n3xn-config.js";
import { createBlobFromText } from "./runner.js";

const EXT_LANG = {
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  rs: "rust",
  go: "go",
  lua: "lua",
  py: "python",
  js: "js",
  jsx: "react",
  ts: "js",
  tsx: "react",
  sql: "sql",
  scm: "scheme",
  ss: "scheme",
  bf: "bf",
  b: "bf",
};

function normalize(path) {
  let p = String(path || "").replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return "/" + parts.join("/");
}

function dirname(p) {
  const n = normalize(p);
  const i = n.lastIndexOf("/");
  return i <= 0 ? "/" : n.slice(0, i);
}

function extOf(p) {
  const n = (p || "").split("/").pop() || "";
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i + 1).toLowerCase() : "";
}

/** Discover project files around an entry */
export async function collectProject(entryPath, cfg = {}) {
  const entry = normalize(entryPath);
  const dir = cfg.cwd ? normalize(cfg.cwd) : dirname(entry);
  const lang = cfg.lang || EXT_LANG[extOf(entry)] || "text";
  const files = new Map();

  async function add(path) {
    const p = normalize(path.startsWith("/") ? path : dir + "/" + path);
    if (files.has(p)) return;
    const f = await fs.readFile(p);
    if (!f) return;
    let text = "";
    try {
      text = f.text();
    } catch {
      return;
    }
    files.set(p, { path: p, text, mime: f.mime });
  }

  await add(entry);
  for (const rel of cfg.files || []) await add(rel);

  // same-folder sources by language
  const exts = {
    c: [".c", ".h"],
    cpp: [".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"],
    rust: [".rs"],
    go: [".go"],
    lua: [".lua"],
  }[lang] || [];

  try {
    const listing = typeof fs.flatten === "function" ? fs.flatten(dir) : [];
    for (const e of listing) {
      if (e.type === "dir") continue;
      if (exts.some((x) => e.path.endsWith(x))) await add(e.path);
    }
  } catch (_) {}

  // n3xn.json / n3proj.json
  for (const name of ["n3xn.json", "n3proj.json", "project.n3xn.json"]) {
    const metaPath = normalize(dir + "/" + name);
    const mf = await fs.readFile(metaPath);
    if (!mf) continue;
    try {
      const meta = JSON.parse(mf.text());
      if (Array.isArray(meta.files)) {
        for (const rel of meta.files) await add(rel);
      }
      if (meta.entry) await add(meta.entry);
      Object.assign(cfg, parseN3xnConfig(""), meta);
    } catch (_) {}
  }

  return { entry, dir, lang, files, cfg };
}

let wasmoonReady = null;
async function ensureLua() {
  if (window.__n3xnLuaFactory) return window.__n3xnLuaFactory;
  if (wasmoonReady) return wasmoonReady;
  wasmoonReady = (async () => {
    // wasmoon UMD
    await new Promise((resolve, reject) => {
      if (window.Wasmoon || window.wasmoon) return resolve();
      const s = document.createElement("script");
      s.src = (navigator.serviceWorker?.controller
        ? "/__cdn__/jsdelivr/npm/wasmoon@1.16.0/dist/index.js"
        : "https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/dist/index.js");
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load Wasmoon (Lua)"));
      document.head.appendChild(s);
    });
    const factory =
      window.Wasmoon?.LuaFactory ||
      window.wasmoon?.LuaFactory ||
      window.LuaFactory;
    if (!factory) {
      // ESM dynamic fallback
      const mod = await import(
        navigator.serviceWorker?.controller
          ? "/__cdn__/jsdelivr/npm/wasmoon@1.16.0/+esm"
          : "https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/+esm"
      );
      window.__n3xnLuaFactory = mod.LuaFactory || mod.default?.LuaFactory || mod.default;
    } else {
      window.__n3xnLuaFactory = factory;
    }
    return window.__n3xnLuaFactory;
  })();
  return wasmoonReady;
}

export async function runLua(entryPath, opts = {}) {
  const log = opts.log || (() => {});
  const f = await fs.readFile(normalize(entryPath));
  if (!f) throw new Error("Not found: " + entryPath);
  const raw = f.text();
  const cfg = parseN3xnConfig(raw, opts.cfg || {});
  const project = await collectProject(entryPath, cfg);
  const LuaFactory = await ensureLua();
  const factory = new LuaFactory();
  const lua = await factory.createEngine();
  const lines = [];
  const printFn = (...args) => {
    const s = args.map(String).join("\t");
    lines.push(s);
    log(s, "out");
  };
  // expose print
  try {
    lua.global.set("print", printFn);
  } catch (_) {}

  // load other lua modules as globals by filename
  for (const [path, file] of project.files) {
    if (!path.endsWith(".lua") || path === project.entry) continue;
    const name = path.split("/").pop().replace(/\.lua$/, "");
    try {
      await lua.doString(stripConfigLines(file.text));
      log("loaded module " + name, "out");
    } catch (e) {
      log("module " + name + ": " + e.message, "err");
    }
  }

  const main = stripConfigLines(project.files.get(project.entry)?.text || raw);
  try {
    await lua.doString(main);
  } catch (e) {
    log(String(e.message || e), "err");
    throw e;
  }

  return { lines, cfg, display: cfg.display || "terminal" };
}

/** Multifile compiled-lang project: analyze + present run plan (browser has no native toolchain) */
export async function runCompiledProject(entryPath, lang, opts = {}) {
  const log = opts.log || (() => {});
  const f = await fs.readFile(normalize(entryPath));
  if (!f) throw new Error("Not found: " + entryPath);
  const cfg = parseN3xnConfig(f.text(), { lang, ...(opts.cfg || {}) });
  const project = await collectProject(entryPath, cfg);

  log(`Project ${lang} · ${project.files.size} file(s) · entry ${project.entry}`, "ok");
  for (const p of project.files.keys()) log("  · " + p, "out");

  // If a .wasm sibling exists, run it as WASI-less instantiate (limited)
  const wasmPath = project.entry.replace(/\.\w+$/, ".wasm");
  const wasmFile = await fs.readFile(wasmPath);
  if (wasmFile) {
    log("Found " + wasmPath + " — instantiating WASM…", "ok");
    try {
      const result = await WebAssembly.instantiate(wasmFile.content, {
        env: {},
        wasi_snapshot_preview1: stubWasi(log),
      });
      const exp = result.instance.exports;
      if (typeof exp.main === "function") {
        const code = exp.main();
        log("main() → " + code, "ok");
      } else if (typeof exp._start === "function") {
        exp._start();
      } else {
        log("Exports: " + Object.keys(exp).join(", "), "out");
      }
      return { project, cfg, wasm: true };
    } catch (e) {
      log("WASM: " + e.message, "err");
    }
  }

  // Produce a project bundle report + optional downloadable archive listing
  const report = {
    lang,
    entry: project.entry,
    files: [...project.files.keys()],
    display: cfg.display,
    title: cfg.title,
    note:
      "Browser cannot fully compile " +
      lang +
      " without a toolchain. Place a prebuilt .wasm next to the entry to run, or use local clang/rustc/go build and import the wasm.",
  };

  if (cfg.display === "preview" || cfg.display === "iframe") {
    const html = `<!DOCTYPE html><html><body style="background:#0a0a0f;color:#e2e8f0;font:14px monospace;padding:16px">
<h2>${cfg.title || lang + " project"}</h2>
<pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>
<p>Add <code>//!n3xn display=terminal</code> and a sibling <code>.wasm</code> to execute.</p>
</body></html>`;
    const { url } = createBlobFromText(html, "text/html", "lang:" + lang);
    if (opts.open !== false) window.open(url, "_blank");
    return { project, cfg, url, report };
  }

  log(report.note, "out");
  log("Tip: //!n3xn files=a.c,b.c display=terminal", "out");
  log("Tip: compile to wasm and save as " + wasmPath, "out");
  return { project, cfg, report };
}

function stubWasi(log) {
  const noop = () => 0;
  return new Proxy(
    {},
    {
      get: () => noop,
    }
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


export function detectLang(path) {
  return EXT_LANG[extOf(path)] || null;
}


/* ========== Extra offline languages ========== */

let sqlJsReady = null;
export async function ensureSqlJs() {
  if (window.initSqlJs && sqlJsReady) return sqlJsReady;
  sqlJsReady = (async () => {
    if (!window.initSqlJs) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = navigator.serviceWorker?.controller
          ? "/__cdn__/jsdelivr/npm/sql.js@1.11.0/dist/sql-wasm.js"
          : "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("sql.js load failed"));
        document.head.appendChild(s);
      });
    }
    const base = navigator.serviceWorker?.controller
      ? "/__cdn__/jsdelivr/npm/sql.js@1.11.0/dist/"
      : "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/";
    return window.initSqlJs({ locateFile: (f) => base + f });
  })();
  return sqlJsReady;
}

export async function runSql(path, opts = {}) {
  const log = opts.log || console.log;
  const f = await fs.readFile(path);
  const sql = f.text();
  log("SQL (sql.js WASM)…", "out");
  const SQL = await ensureSqlJs();
  const db = new SQL.Database();
  try {
    const result = db.exec(sql);
    for (const r of result) {
      log((r.columns || []).join("\t"), "ok");
      for (const row of r.values || []) log(row.join("\t"), "out");
    }
    if (!result.length) log("(no result sets)", "out");
  } finally {
    db.close();
  }
  return { ok: true };
}

let biwaReady = null;
export async function ensureBiwa() {
  if (window.BiwaScheme) return window.BiwaScheme;
  if (biwaReady) return biwaReady;
  biwaReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = navigator.serviceWorker?.controller
      ? "/__cdn__/jsdelivr/npm/biwascheme@0.8.0/release/biwascheme-min.js"
      : "https://cdn.jsdelivr.net/npm/biwascheme@0.8.0/release/biwascheme-min.js";
    s.onload = () => resolve(window.BiwaScheme);
    s.onerror = () => reject(new Error("BiwaScheme load failed"));
    document.head.appendChild(s);
  });
  return biwaReady;
}

export async function runScheme(path, opts = {}) {
  const log = opts.log || console.log;
  const code = (await fs.readFile(path)).text();
  log("Scheme (BiwaScheme)…", "out");
  const Biwa = await ensureBiwa();
  const interpreter = new Biwa.Interpreter((ar) => log(String(ar), "out"));
  await new Promise((resolve, reject) => {
    try {
      interpreter.evaluate(code, resolve);
    } catch (e) {
      reject(e);
    }
  });
  return { ok: true };
}

export function runBrainfuck(code, opts = {}) {
  const log = opts.log || console.log;
  const tape = new Uint8Array(30000);
  let ptr = 0;
  let ip = 0;
  let out = "";
  const stack = [];
  const jumps = {};
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "[") stack.push(i);
    if (code[i] === "]") {
      const s = stack.pop();
      jumps[s] = i;
      jumps[i] = s;
    }
  }
  let steps = 0;
  const LIMIT = 10_000_000;
  while (ip < code.length && steps++ < LIMIT) {
    const c = code[ip];
    if (c === ">") ptr = (ptr + 1) % tape.length;
    else if (c === "<") ptr = (ptr - 1 + tape.length) % tape.length;
    else if (c === "+") tape[ptr] = (tape[ptr] + 1) & 255;
    else if (c === "-") tape[ptr] = (tape[ptr] - 1) & 255;
    else if (c === ".") out += String.fromCharCode(tape[ptr]);
    else if (c === "[") {
      if (tape[ptr] === 0) ip = jumps[ip];
    } else if (c === "]") {
      if (tape[ptr] !== 0) ip = jumps[ip];
    }
    ip++;
  }
  if (out) log(out, "ok");
  else log("(no output)", "out");
  if (steps >= LIMIT) log("BF step limit", "err");
  return { ok: true, out };
}

export async function runLanguageFile(path, opts = {}) {
  const ext = extOf(path);
  const lang = EXT_LANG[ext] || opts.lang;
  if (lang === "lua") return runLua(path, opts);
  if (["c", "cpp", "rust", "go"].includes(lang)) {
    return runCompiledProject(path, lang, opts);
  }
  if (lang === "sql" || ext === "sql") return runSql(path, opts);
  if (lang === "scheme" || ext === "scm" || ext === "ss") return runScheme(path, opts);
  if (lang === "bf" || ext === "bf" || ext === "b") {
    const code = (await fs.readFile(path)).text();
    return runBrainfuck(code, opts);
  }
  throw new Error("No lang runner for " + (lang || ext));
}
