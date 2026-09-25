/**
 * n3xn VFS v2 — Terminal with bash-like commands + custom command system
 */

import * as fs from "./fs.js";
import * as db from "./db.js";
import * as runner from "./runner.js";

const outputEl = () => document.getElementById("terminal-output");
const inputEl = () => document.getElementById("terminal-input");

let cwd = "/";
let history = [];
let histIdx = -1;
let customCommands = {}; // user-defined: name -> { code, desc }
let aliases = {}; // name -> expansion string
const fileUndo = new Map(); // path -> { stack, redo }
const MAX_UNDO = 30;

async function loadCollab() {
  return import("./collab.js");
}
async function loadPython() {
  return import("./python.js");
}
async function loadGithub() {
  return import("./github.js");
}
async function loadStorage() {
  return import("./storage-backends.js");
}

function maybeNewsTip() {
  try {
    if (Math.random() > 0.3) return;
    print('you should try this! run "minecraft" to open chromebook Minecraft!! also try "n3xn-chat" to open n3xn chat app!!', "ok");
  } catch (_) {}
}

export function initTerminal() {
  loadAliases().catch(() => {});

  const input = inputEl();
  input.addEventListener("keydown", onKey);
  print("n3xn Virtual FileSystem v2 — Terminal", "ok");
  print("help · python · wss · logs on|off|copy|clear", "out");
  maybeNewsTip();
  loadCollab()
    .then((collab) => collab.setLogger((msg, cls) => print(msg, cls || "out")))
    .catch((e) => print("collab module unavailable: " + e.message, "err"));
  installConsoleBridge();
  loadCustomCommands();
}

let consoleBridgeOn = true;
let _origConsole = null;

function installConsoleBridge() {
  if (_origConsole) return;
  _origConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };
  const bridge = (level, args) => {
    _origConsole[level](...args);
    if (!consoleBridgeOn) return;
    const msg = args
      .map((a) => {
        try {
          return typeof a === "object" ? JSON.stringify(a) : String(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
    const cls = level === "error" ? "err" : level === "warn" ? "err" : "out";
    print(`[${level}] ${msg}`, cls);
  };
  console.log = (...a) => bridge("log", a);
  console.warn = (...a) => bridge("warn", a);
  console.error = (...a) => bridge("error", a);
  console.info = (...a) => bridge("info", a);
  window.addEventListener("error", (e) => {
    if (consoleBridgeOn) print(`[error] ${e.message} @ ${e.filename}:${e.lineno}`, "err");
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (consoleBridgeOn) print(`[reject] ${e.reason}`, "err");
  });
}

function print(text, cls = "out") {
  const el = outputEl();
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function printHtml(html) {
  const el = outputEl();
  const line = document.createElement("div");
  line.innerHTML = html;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

async function onKey(e) {
  // Ctrl+R — reverse history search
  if (e.ctrlKey && (e.key === "r" || e.key === "R")) {
    e.preventDefault();
    const q = prompt("History search:");
    if (!q) return;
    const hit = [...history].reverse().find((h) => h.toLowerCase().includes(q.toLowerCase()));
    if (hit) inputEl().value = hit;
    else print("No history match for: " + q, "err");
    return;
  }
  // Ctrl+Shift+F — fullscreen terminal
  if (e.ctrlKey && e.shiftKey && (e.key === "F" || e.key === "f")) {
    e.preventDefault();
    toggleTerminalFullscreen();
    return;
  }
  if (e.key === "Enter") {
    const cmd = inputEl().value.trim();
    inputEl().value = "";
    if (!cmd) return;
    history.push(cmd);
    histIdx = history.length;
    print(`n3xn@vfs:${cwd}$ ${cmd}`, "cmd");
    await run(cmd);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (histIdx > 0) {
      histIdx--;
      inputEl().value = history[histIdx];
    }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (histIdx < history.length - 1) {
      histIdx++;
      inputEl().value = history[histIdx];
    } else {
      histIdx = history.length;
      inputEl().value = "";
    }
  }
}

window.__n3xnExecTerm = run;
async function run(line) {
  let parts = parseArgs(line);
  let cmd = parts[0];
  let args = parts.slice(1);

  // Expand alias (simple: first word only; supports "$1" etc via join rest)
  if (aliases[cmd]) {
    const exp = aliases[cmd];
    const expanded = exp.includes("$")
      ? exp.replace(/\$(\d+)/g, (_, n) => args[Number(n) - 1] ?? "").replace(/\$@/g, args.join(" "))
      : exp + (args.length ? " " + args.join(" ") : "");
    parts = parseArgs(expanded);
    cmd = parts[0];
    args = parts.slice(1);
  }

  try {
    if (customCommands[cmd]) {
      await runCustom(cmd, args);
      return;
    }

    switch (cmd) {
      case "help":
        showHelp(args);
        break;
      case "clear":
      case "cls":
        outputEl().innerHTML = "";
        break;
      case "pwd":
        print(cwd);
        break;
      case "cd":
        await cmdCd(args[0] || "/");
        break;
      case "ls":
      case "dir":
        await cmdLs(args);
        break;
      case "cat":
      case "type":
        await cmdCat(args);
        break;
      case "mkdir":
        await cmdMkdir(args);
        break;
      case "touch":
        await cmdTouch(args);
        break;
      case "rm":
        await cmdRm(args);
        break;
      case "mv":
      case "rename":
        await cmdMv(args[0], args[1]);
        break;
      case "cp":
        await cmdCp(args[0], args[1]);
        break;
      case "find":
        await cmdFind(args[0] || "*");
        break;
      case "echo":
        print(args.join(" "));
        break;
      case "whoami":
        print(db.getCurrentUser() || "guest");
        break;
      case "export":
        await cmdExport(args);
        break;
      case "stat":
        await cmdStat(args[0]);
        break;
      case "tree":
        await cmdTree(args[0] || cwd);
        break;
      case "cmd":
      case "command":
        await cmdCommand(args);
        break;
      case "patch":
        await cmdPatch(args);
        break;
      case "run":
      case "preview":
      case "open":
        await cmdRun(args);
        break;
      case "blobs":
      case "blob":
        await cmdBlobs(args);
        break;
      case "webfile":
      case "wf":
        await cmdWebfile(args);
        break;
      case "curl":
      case "fetch":
        await cmdWebfile(["get", ...args]);
        break;
      case "presence":
      case "cursor-style":
        await cmdPresence(args);
        break;
      case "wss":
      case "collab":
      case "room":
        await cmdWss(args);
        break;
      case "share":
        await cmdWss(["share", ...args]);
        break;
      case "python":
      case "py":
        await cmdPython(args);
        break;
      case "logs":
      case "console":
        await cmdLogs(args);
        break;
      case "gh":
      case "github":
        await cmdGithub(args);
        break;
      case "n3link":
      case "n3-site":
      case "n3site":
        await cmdN3Site(args);
        break;
      case "react":
      case "jsx":
        await cmdReact(args);
        break;
      case "grep":
        await cmdGrep(args);
        break;
      case "head":
        await cmdHead(args);
        break;
      case "tail":
        await cmdTail(args);
        break;
      case "wc":
        await cmdWc(args);
        break;
      case "du":
        await cmdDu(args);
        break;
      case "file":
        await cmdFile(args);
        break;
      case "basename":
        print(basenameArg(args[0] || cwd));
        break;
      case "dirname":
        print(dirnameArg(args[0] || cwd));
        break;
      case "which":
        await cmdWhich(args);
        break;
      case "sort":
        await cmdSort(args);
        break;
      case "uniq":
        await cmdUniq(args);
        break;
      case "history":
        await cmdHistory(args);
        break;
      case "alias":
        await cmdAlias(args);
        break;
      case "unalias":
        if (!args[0]) throw new Error("Usage: unalias <name>");
        delete aliases[args[0]];
        await saveAliases();
        print("Removed alias " + args[0], "ok");
        break;
      case "append":
        await cmdAppend(args, "append");
        break;
      case "prepend":
        await cmdAppend(args, "prepend");
        break;
      case "replace":
        await cmdReplace(args);
        break;
      case "insert":
        await cmdInsert(args);
        break;
      case "delete":
      case "delline":
        await cmdDelLine(args);
        break;
      case "undo":
        await cmdUndo(args);
        break;
      case "redo":
        await cmdRedo(args);
        break;
      case "diff":
        await cmdDiff(args);
        break;
      case "project":
        await cmdProject(args);
        break;
      case "debug":
        await cmdDebug(args);
        break;
      case "web":
        await cmdWeb(args);
        break;
      case "terminal":
        await cmdTerminalUi(args);
        break;
      case "storage":
      case "idb":
      case "opfs":
        await cmdStorage(args);
        break;
      case "perf":
      case "performance":
        await cmdPerf(args);
        break;
      case "nexc":
        await cmdNexc(args);
        break;
      case "xdebug":
        await cmdXdebug(args);
        break;
      case "lang":
        await cmdLang(args);
        break;
      case "chat":
      case "sidebar":
        await cmdChatEngine(args);
        break;
      case "devtools":
      case "dt":
        await cmdDevtools(args);
        break;
      case "sw":
        await cmdSwOffline(args);
        break;
      case "minecraft":
      case "mc":
        await cmdMinecraft(args);
        break;
      case "n3xn-chat":
      case "n3xnchat":
        await cmdN3xnChat(args);
        break;
      default:
        print(`Command not found: ${cmd}. Type "help".`, "err");
    }
  } catch (err) {
    print(String(err.message || err), "err");
  }
}

function parseArgs(line) {
  // Simple parser supporting quotes
  const result = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === quoteChar) inQuote = false;
      else current += c;
    } else if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
    } else if (c === " " || c === "\t") {
      if (current) {
        result.push(current);
        current = "";
      }
    } else {
      current += c;
    }
  }
  if (current) result.push(current);
  return result;
}

function resolve(path) {
  if (!path) return cwd || "/";
  let raw = String(path).replace(/\\/g, "/").trim();
  if (!raw) return cwd || "/";
  // absolute
  let parts;
  if (raw.startsWith("/")) {
    parts = raw.split("/").filter(Boolean);
  } else {
    const base = (cwd || "/").split("/").filter(Boolean);
    parts = base.concat(raw.split("/").filter(Boolean));
  }
  const out = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length) out.pop();
      continue;
    }
    out.push(seg);
  }
  return "/" + out.join("/");
}

async function cmdCd(path) {
  const target = resolve(path);
  if (!fs.exists(target)) throw new Error("No such directory");
  if (!fs.isDir(target)) throw new Error("Not a directory");
  cwd = target === "/" ? "/" : target.replace(/\/$/, "");
  document.getElementById("current-path").textContent = cwd;
}

async function cmdLs(args) {
  const path = resolve(args.find((a) => !a.startsWith("-")) || cwd);
  const long = args.includes("-l") || args.includes("-la") || args.includes("-al");
  const entries = fs.ls(path);
  if (entries.length === 0) {
    print("(empty)");
    return;
  }
  for (const e of entries) {
    if (long) {
      const type = e.type === "dir" ? "d" : "-";
      const size = String(e.size).padStart(10);
      const date = e.modified ? new Date(e.modified).toLocaleString() : "";
      print(`${type} ${size}  ${date}  ${e.name}${e.type === "dir" ? "/" : ""}`);
    } else {
      print(e.name + (e.type === "dir" ? "/" : ""));
    }
  }
}

async function cmdCat(argsOrPath) {
  const args = Array.isArray(argsOrPath) ? argsOrPath : [argsOrPath];
  const numbered = args.includes("-n");
  const path = args.find((a) => a && !a.startsWith("-"));
  if (!path) throw new Error("Usage: cat [-n] <file>");
  const f = await fs.readFile(resolve(path));
  if (!f) throw new Error("No such file");
  let text = f.text();
  if (text.length > 100000) {
    text = text.slice(0, 100000) + "\n\n... [truncated — file is " + f.size + " bytes]";
  }
  if (numbered) {
    text = text.split("\n").map((l, i) => String(i + 1).padStart(6) + "  " + l).join("\n");
  }
  print(text);
}

async function cmdMkdir(args) {
  const parents = args.includes("-p") || args.includes("--parents");
  for (const a of args) {
    if (a.startsWith("-")) continue;
    await fs.mkdir(resolve(a), { parents });
    print("Created: " + resolve(a), "ok");
  }
}

async function cmdTouch(args) {
  for (const a of args) {
    if (a.startsWith("-")) continue;
    const p = resolve(a);
    if (p === "/") throw new Error("Cannot touch root");
    if (!fs.exists(p)) {
      await fs.writeFile(p, "");
      print("Created: " + p, "ok");
    } else if (fs.isDir(p)) {
      print("Directory exists: " + p);
    } else {
      // update mtime via rewrite
      try {
        const f = await fs.readFile(p);
        await fs.writeFile(p, f.content, { mime: f.mime });
      } catch {
        await fs.writeFile(p, "");
      }
      print("Touched: " + p, "ok");
    }
  }
}

async function cmdRm(args) {
  const recursive = args.includes("-r") || args.includes("-rf") || args.includes("-fr");
  for (const a of args) {
    if (a.startsWith("-")) continue;
    const p = resolve(a);
    if (recursive) {
      await fs.removeRecursive(p);
    } else {
      await fs.remove(p);
    }
    print("Removed: " + p, "ok");
  }
  // Refresh tree if UI available
  if (window.refreshTree) window.refreshTree();
}

async function cmdMv(src, dest) {
  if (!src || !dest) throw new Error("Usage: mv <src> <dest>");
  src = resolve(src);
  dest = resolve(dest);
  const f = await fs.readFile(src);
  if (!f) throw new Error("Source not found");
  await fs.writeFile(dest, f.content, { mime: f.mime });
  await fs.remove(src);
  print(`Moved ${src} → ${dest}`, "ok");
  if (window.refreshTree) window.refreshTree();
}

async function cmdCp(src, dest) {
  if (!src || !dest) throw new Error("Usage: cp <src> <dest>");
  src = resolve(src);
  dest = resolve(dest);
  const f = await fs.readFile(src);
  if (!f) throw new Error("Source not found");
  await fs.writeFile(dest, f.content, { mime: f.mime });
  print(`Copied ${src} → ${dest}`, "ok");
  if (window.refreshTree) window.refreshTree();
}

async function cmdFind(pattern) {
  const all = fs.flatten("/");
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
  const matches = all.filter((f) => regex.test(f.name) || regex.test(f.path));
  if (matches.length === 0) print("No matches");
  else matches.forEach((m) => print(m.path + (m.type === "dir" ? "/" : "")));
}

async function cmdExport(args) {
  const what = args[0] || "fs";
  if (what === "fs" || what === "all") {
    const data = await db.exportEverything(true);
    downloadJSON(data, `n3xn-export-${db.getCurrentUser()}-${Date.now()}.n3xn.json`);
    print("Exported encrypted full filesystem + accounts", "ok");
  } else {
    const blob = await fs.exportZip(resolve(what));
    downloadBlob(blob, `n3xn-${what.replace(/\//g, "_")}.zip`);
    print("Exported ZIP", "ok");
  }
}

async function cmdStat(path) {
  path = resolve(path || cwd);
  const node = fs.getTree(); // simplified
  if (!fs.exists(path)) throw new Error("Not found");
  if (fs.isDir(path)) {
    const entries = fs.ls(path);
    print(`Directory: ${path}`);
    print(`Entries: ${entries.length}`);
  } else {
    const f = await fs.readFile(path);
    print(`File: ${path}`);
    print(`Size: ${f.size} bytes`);
    print(`MIME: ${f.mime}`);
    print(`Modified: ${new Date(f.modified).toLocaleString()}`);
  }
}

async function cmdTree(path) {
  path = resolve(path);
  function walk(p, prefix) {
    const entries = fs.ls(p);
    entries.forEach((e, i) => {
      const last = i === entries.length - 1;
      const branch = last ? "└── " : "├── ";
      print(prefix + branch + e.name + (e.type === "dir" ? "/" : ""));
      if (e.type === "dir") {
        const next = p === "/" ? "/" + e.name : p + "/" + e.name;
        walk(next, prefix + (last ? "    " : "│   "));
      }
    });
  }
  print(path);
  walk(path, "");
}

/* Custom commands — user can create scripts that run on the VFS */
async function cmdCommand(args) {
  const sub = args[0];
  if (sub === "list") {
    const names = Object.keys(customCommands);
    if (names.length === 0) print("No custom commands");
    else names.forEach((n) => print(`${n} — ${customCommands[n].desc || ""}`));
  } else if (sub === "add" || sub === "create") {
    const name = args[1];
    if (!name) throw new Error("Usage: cmd add <name> <description>");
    // Open a simple editor modal or use prompt for code
    const desc = args.slice(2).join(" ") || "Custom command";
    const code = prompt("Enter JavaScript code for the command.\nAvailable: fs, db, print, args, cwd\nExample: print('Hello ' + args[0])");
    if (code) {
      customCommands[name] = { code, desc };
      await saveCustomCommands();
      print(`Command "${name}" created`, "ok");
    }
  } else if (sub === "rm" || sub === "remove") {
    delete customCommands[args[1]];
    await saveCustomCommands();
    print("Removed", "ok");
  } else {
    print("Usage: cmd list | cmd add <name> [desc] | cmd rm <name>");
  }
}

async function runCustom(name, args) {
  const cmd = customCommands[name];
  // Safe-ish eval in a limited context
  const fn = new Function("fs", "db", "print", "args", "cwd", "resolve", cmd.code);
  await fn(fs, db, print, args, cwd, resolve);
}

async function cmdPatch(args) {
  // Simple find-and-replace across files
  // Usage: patch <pattern> <search> <replace> [--dry]
  if (args.length < 3) {
    print("Usage: patch <file-pattern> <search> <replace> [--dry]");
    print('Example: patch "*.js" "oldText" "newText"');
    return;
  }
  const pattern = args[0];
  const search = args[1];
  const replace = args[2];
  const dry = args.includes("--dry");

  const all = fs.flatten("/");
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$", "i");
  let count = 0;
  for (const f of all) {
    if (f.type !== "file") continue;
    if (!regex.test(f.name) && !regex.test(f.path)) continue;
    const file = await fs.readFile(f.path);
    const text = file.text();
    if (text.includes(search)) {
      if (dry) {
        print(`[dry] would patch ${f.path}`);
      } else {
        const newText = text.split(search).join(replace);
        await fs.writeFile(f.path, newText, { mime: file.mime });
        print(`Patched ${f.path}`, "ok");
      }
      count++;
    }
  }
  print(`Done. ${count} file(s) ${dry ? "would be " : ""}affected.`);
}

async function cmdRun(args) {
  // run [type] <file>
  // run [type] -c <code|url>
  // run <file>
  const modes = [
    "html", "html-window", "js", "python", "py", "lua", "c", "cpp", "rust", "go",
    "sql", "scheme", "bf", "brainfuck", "kaboom", "phaser", "pixi", "three", "matter", "p5", "game",
    "image", "markdown", "md", "json", "css",
    "text", "dataurl", "blob-open", "react", "n3-site", "auto",
  ];

  async function resolveCodeArg(raw) {
    let s = String(raw || "");
    // strip surrounding quotes
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1);
    }
    const looksUrl =
      /^(https?|data|blob):/i.test(s) ||
      /^\/\//.test(s) ||
      (/^[\w.-]+\.[a-z]{2,}/i.test(s) && !/\s/.test(s) && s.includes("/"));
    if (looksUrl) {
      let url = s;
      if (!/^(https?|data|blob):/i.test(url)) {
        if (url.startsWith("//")) url = "https:" + url;
        else url = "https://" + url.replace(/^\/+/, "");
      }
      print("Fetching code from URL…", "out");
      const res = await fetch(url, { credentials: "omit", redirect: "follow" });
      if (!res.ok) throw new Error("Fetch failed " + res.status);
      return await res.text();
    }
    return s;
  }

  if (!args.length) {
    const path = window.__n3xnActivePath;
    if (!path) throw new Error("Usage: run [type] <file> | run [type] -c <code|url>");
    print(`Running ${path}…`);
    await runner.run(path);
    print("Done", "ok");
    return;
  }

  let mode = null;
  let rest = args.slice();
  if (modes.includes(rest[0]?.toLowerCase())) {
    mode = rest.shift().toLowerCase();
    if (mode === "auto") mode = undefined;
    if (mode === "brainfuck") mode = "bf";
    if (mode === "py") mode = "python";
  }

  if (rest[0] === "-c" || rest[0] === "--code") {
    const codeRaw = rest.slice(1).join(" ");
    if (!codeRaw) throw new Error("Usage: run [type] -c <code|url>");
    const code = await resolveCodeArg(codeRaw);
    const type = mode || "js";
    print(`Running -c as ${type} (${code.length} chars)…`);
    // write temp and run
    const tmp = `/tmp/run-${type}-${Date.now()}.${type === "python" ? "py" : type === "lua" ? "lua" : type === "sql" ? "sql" : type === "scheme" ? "scm" : type === "bf" ? "bf" : type === "c" ? "c" : type === "cpp" ? "cpp" : type === "rust" ? "rs" : type === "go" ? "go" : "js"}`;
    await fs.mkdir("/tmp", { parents: true }).catch(() => {});
    await fs.writeFile(tmp, code);
    await runner.run(tmp, type);
    print("Done", "ok");
    return;
  }

  const path = resolve(rest[0] || window.__n3xnActivePath);
  if (!path) throw new Error("Usage: run [type] <file> | run [type] -c <code|url>");
  // optional second mode token
  if (!mode && rest[1] && modes.includes(rest[1])) mode = rest[1];
  print(`Running ${path}${mode ? " as " + mode : ""}…`);
  await runner.run(path, mode);
  print("Done", "ok");
}

async function cmdBlobs(args) {
  const sub = args[0];
  const list = runner.listBlobs();

  if (sub === "clear" || sub === "revoke") {
    list.forEach((b) => runner.revokeBlob(b.url));
    print(`Revoked ${list.length} blob(s)`, "ok");
    return;
  }

  if (sub === "make" || sub === "gen" || sub === "create") {
    const filePath = resolve(args[1] || window.__n3xnActivePath);
    if (!filePath) throw new Error("Usage: blob make <file>");
    const { url, mime, size } = await runner.createBlobFromPath(filePath);
    print(`Blob ready (${mime}, ${size}b)`, "ok");
    print(`Open: ${url}`, "ok");
    return;
  }

  if (sub === "open" && args[1] !== undefined) {
    const idx = parseInt(args[1], 10);
    const b = list[idx];
    if (!b) throw new Error("No blob at index " + args[1]);
    window.open(b.url, "_blank");
    print(`Opened blob [${idx}] ${b.path}`, "ok");
    return;
  }

  if (sub === "watch") {
    // Generate blob immediately for listed files and print
    const files = args.slice(1);
    if (files.length === 0 && window.__n3xnActivePath) files.push(window.__n3xnActivePath);
    if (files.length === 0) throw new Error("Usage: blob watch <file…>");
    for (const f of files) {
      const p = resolve(f);
      await runner.createBlobFromPath(p);
    }
    print(`Watch blobs generated for ${files.length} file(s)`, "ok");
    return;
  }

  // default: list all
  if (list.length === 0) {
    print("No active blob URLs. Use: blob make <file>  or  run <file>");
    return;
  }
  print(`— ${list.length} blob(s) —`);
  list.forEach((b, i) => {
    print(`[${i}] ${b.path} · ${b.mime} · ${b.size}b · ${new Date(b.created).toLocaleTimeString()}`);
    print(`    blob:  ${b.url}`, "ok");
    print(`    tip:   blob open ${i}   |   open in about:blank via browser`);
  });
}

/** webfile get|sync|put|headers <url> [vfs-path] */
async function cmdWebfile(args) {
  const sub = (args[0] || "get").toLowerCase();
  const url = args[1];
  if (!url && sub !== "help") {
    print("Usage:");
    print("  webfile get <url> [vfs-path]     — download URL into VFS");
    print("  webfile sync <vfs-path> <url>    — overwrite file with URL body");
    print("  webfile headers <url>            — show response headers");
    print("  webfile put <vfs-path> <url>     — POST file body to URL (experimental)");
    return;
  }

  if (sub === "headers") {
    const res = await fetch(url, { method: "HEAD", mode: "cors" }).catch(() =>
      fetch(url, { method: "GET", mode: "cors" })
    );
    print(`${res.status} ${res.statusText}`);
    res.headers.forEach((v, k) => print(`  ${k}: ${v}`));
    return;
  }

  if (sub === "get" || sub === "sync") {
    let dest, fetchUrl;
    if (sub === "sync") {
      dest = resolve(args[1]);
      fetchUrl = args[2];
      if (!dest || !fetchUrl) throw new Error("Usage: webfile sync <vfs-path> <url>");
    } else {
      fetchUrl = url;
      dest = args[2] ? resolve(args[2]) : resolve(cwd + "/" + (fetchUrl.split("/").pop() || "download.bin").split("?")[0]);
    }

    print(`Fetching ${fetchUrl}…`);
    const res = await fetch(fetchUrl, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || "application/octet-stream";

    // ensure parent dirs
    const parts = dest.split("/").filter(Boolean);
    parts.pop();
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      if (!fs.exists(cur)) await fs.mkdir(cur);
    }

    await fs.writeFile(dest, buf, { mime: mime.split(";")[0].trim() });
    print(`Saved ${buf.length} bytes → ${dest} (${mime})`, "ok");
    const { url: blobUrl } = await runner.createBlobFromPath(dest);
    print(`Blob: ${blobUrl}`, "ok");
    if (window.refreshTree) window.refreshTree();
    return;
  }

  if (sub === "put") {
    const filePath = resolve(args[1]);
    const postUrl = args[2];
    if (!filePath || !postUrl) throw new Error("Usage: webfile put <vfs-path> <url>");
    const f = await fs.readFile(filePath);
    if (!f) throw new Error("File not found");
    const res = await fetch(postUrl, {
      method: "POST",
      body: f.content,
      headers: { "Content-Type": f.mime || "application/octet-stream" },
      mode: "cors",
    });
    print(`${res.status} ${res.statusText}`, res.ok ? "ok" : "err");
    const text = await res.text().catch(() => "");
    if (text) print(text.slice(0, 500));
    return;
  }

  print("Unknown webfile subcommand. Try: webfile get|sync|headers|put");
}

/**
 * wss connect <url> [roomPassword]
 * wss disconnect | status | chat <msg> | share <path> | pull <path>
 * wss collab <path> | leave | ping
 *
 * Room password is E2E only (relay never sees plaintext).
 * URL example: wss://your-worker.workers.dev/my-room
 */
async function cmdWss(args) {
  const collab = await loadCollab();
  const sub = (args[0] || "status").toLowerCase();

  if (sub === "help" || sub === "-h") {
    print("Encrypted WSS over your CF Universal Relay:");
    print("  wss connect <wss-url> [roomPassword]");
    print("  wss disconnect | status | chat <msg> | share|unshare <path> | pull <path>");
    print("  wss collabfs | cfs | shares  — open Collab FS of live shared files");
    print("  wss collab <path>  — same as share (Collab FS)");
    print("  wss leave | ping");
    print("  wss pmsg <recipients> <markdown…>   — private message (Alice,Bob & Charlie)");
    print("  wss pmsgimg <recipients> <markdown> — pick up to 4 images then send");
    print("  wss reply|.r <markdown…>            — reply to last incoming PM");
    print("  wss vcreq|vcinvite <recipients> [msg] — P2P voice invite");
    print("  wss vidreq|vidinvite <recipients> [msg] — P2P video invite");
    print("  wss vcaccept|vidaccept [id] | vcmute|vcunmute | vcleave | vcstatus");
    print("  Recipients: Alice, Bob & Charlie | * | all");
    print("Room password encrypts ALL app payloads (chat, pmsg, VC signaling, files).");
    return;
  }

  if (sub === "connect") {
    const url = args[1];
    if (!url) throw new Error("Usage: wss connect <wss://host/room> [roomPassword]");
    let pass = args[2];
    if (!pass) pass = prompt("Room E2E password (shared with teammates):");
    if (!pass) throw new Error("Room password required");
    await collab.connect(url, pass);
    print("Connected. Use: chat · share · pull · collab", "ok");
    return;
  }

  if (sub === "disconnect" || sub === "close") {
    await collab.disconnect();
    return;
  }

  if (sub === "status") {
    const s = collab.getStatus();
    print(JSON.stringify(s, null, 2));
    return;
  }

  if (sub === "chat") {
    const text = args.slice(1).join(" ");
    if (!text) throw new Error("Usage: wss chat <message>");
    await collab.chat(text);
    return;
  }

  if (sub === "share") {
    const path = resolve(args[1] || window.__n3xnActivePath);
    if (!path) throw new Error("Usage: wss share <path>");
    await collab.shareFile(path);
    return;
  }
  if (sub === "unshare") {
    const path = resolve(args[1] || window.__n3xnActivePath);
    if (!path) throw new Error("Usage: wss unshare <path>");
    await collab.unshareFile(path);
    return;
  }
  if (sub === "collabfs" || sub === "cfs" || sub === "shares") {
    const list = collab.openCollabFs();
    if (!list.length) print("(no shared files in Collab FS)");
    else list.forEach((f) => print(`${f.status.padEnd(10)} ${f.key}  (${f.size || 0}b)`));
    return;
  }

  if (sub === "pull") {
    const path = resolve(args[1]);
    if (!path) throw new Error("Usage: wss pull <path>");
    await collab.pullFile(path);
    return;
  }

  if (sub === "collab" || sub === "join") {
    // Same as share → Collab FS; also join live edit/cursors on that path
    const path = resolve(args[1] || window.__n3xnActivePath);
    if (!path) throw new Error("Usage: wss collab <path>  (same as share + live cursors)");
    await collab.shareFile(path);
    try {
      await collab.collabJoin(path);
    } catch (_) {}
    print("Collab FS + live session: " + path, "ok");
    collab.openCollabFs();
    return;
  }

  if (sub === "leave") {
    collab.collabLeave();
    return;
  }

  
  if (sub === "pmsg") {
    if (args.length < 3) throw new Error("Usage: wss pmsg <recipients> <markdown…>");
    const recipients = args[1];
    const text = args.slice(2).join(" ");
    await collab.sendPmsg(recipients, text);
    return;
  }
  if (sub === "pmsgimg" || sub === "pmsg-img") {
    if (args.length < 2) throw new Error("Usage: wss pmsgimg <recipients> [markdown]");
    const recipients = args[1];
    const text = args.slice(2).join(" ") || "";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    const files = await new Promise((resolve) => {
      input.onchange = () => resolve([...(input.files || [])]);
      input.click();
    });
    if (files.length > 4) throw new Error("Too many images. Maximum is 4 per message.");
    const images = [];
    for (const f of files.slice(0, 4)) {
      try {
        images.push(await collab.fileToImageAttachment(f));
      } catch (e) {
        print(String(e.message || e), "err");
      }
    }
    if (!images.length && !text) throw new Error("No images attached");
    await collab.sendPmsg(recipients, text, { images });
    return;
  }
  if (sub === "reply" || sub === ".r" || sub === "r") {
    const text = args.slice(1).join(" ");
    if (!text) throw new Error("Usage: wss reply|.r <markdown…>");
    await collab.replyPmsg(text);
    return;
  }
  if (sub === "vcreq" || sub === "vcinvite" || sub === "vc-req") {
    if (!args[1]) throw new Error("Usage: wss vcreq <recipients> [message]");
    await collab.vcRequest(args[1], args.slice(2).join(" "));
    return;
  }
  if (sub === "vcaccept" || sub === "vc-accept") {
    await collab.vcAccept(args[1] || null);
    return;
  }
  if (sub === "vcmute") { collab.vcMute(); return; }
  if (sub === "vcunmute") { collab.vcUnmute(); return; }
  if (sub === "vcleave") { await collab.vcLeave(); return; }
  if (sub === "vcstatus") {
    print(JSON.stringify(collab.vcStatus(), null, 2));
    return;
  }
if (sub === "ping") {
    await collab.ping();
    return;
  }

  print('Unknown wss subcommand. Try: wss help');
}

async function cmdPython(args) {
  let python;
  try {
    python = await loadPython();
  } catch (e) {
    throw new Error("Python module failed to load (is js/python.js deployed?): " + e.message);
  }
  python.setPythonLogger((msg, cls) => print(msg, cls || "out"));
  if (args[0] === "canvas") {
    python.showGameCanvas();
    print("Game canvas shown", "ok");
    return;
  }
  if (args[0] === "hide") {
    python.hideGameCanvas();
    return;
  }
  if (args[0] === "-c") {
    const code = args.slice(1).join(" ");
    await python.runPython(code, { showCanvas: /canvas|arcade/i.test(code) });
    return;
  }
  const path = resolve(args[0] || window.__n3xnActivePath);
  if (!path) throw new Error("Usage: python <file.py> | python -c <code> | python canvas");
  await python.runPythonFile(path, (p) => fs.readFile(p));
}

async function cmdLogs(args) {
  const sub = (args[0] || "status").toLowerCase();
  if (sub === "on") {
    consoleBridgeOn = true;
    print("Console → terminal ON", "ok");
  } else if (sub === "off") {
    consoleBridgeOn = false;
    print("Console → terminal OFF", "ok");
  } else if (sub === "copy") {
    const el = outputEl();
    const text = el ? el.innerText : "";
    await navigator.clipboard.writeText(text);
    print("Logs copied to clipboard", "ok");
  } else if (sub === "clear") {
    outputEl().innerHTML = "";
  } else {
    print(`Console bridge: ${consoleBridgeOn ? "ON" : "OFF"}`);
    print("Usage: logs on|off|copy|clear");
  }
}

function showHelp(args) {
  const HELP_PAGES = [
    [
      "n3xn help — page 1/3 (core FS)",
      "  help [page|command…]     paginated or per-command help",
      "  clear, pwd, cd, ls [-l], cat [-n], mkdir [-p], touch,",
      "  rm [-r], mv, cp, find, grep [-ril] [-C n], head, tail, wc,",
      "  du, file, basename, dirname, which, sort, uniq,",
      "  history, alias, unalias, tree, stat, echo, whoami",
    ],
    [
      "n3xn help — page 2/3 (edit / run / project)",
      "  append|prepend|replace|insert|delline|undo|redo|diff",
      "  patch, export, project stats|tree|files",
      "  run [mode] <file> | web run | blob | webfile",
      "  python | react | n3site | nexc | debug | xdebug [--live]",
      "  lang lua|c|cpp|rust|go <entry>   multifile + //!n3xn config",
      "  storage | perf | terminal fullscreen",
    ],
    [
      "n3xn help — page 3/3 (collab / WSS)",
      "  wss connect|disconnect|status|chat|share|pull|collab",
      "  wss pmsg|… | vcreq|vidreq|vcaccept|vidaccept (*|all ok)",
    "  chat open|local|join|send|mic|video|vc  — sidebar chat engine",
      "  gh …  | logs on|off|copy",
      "  In-file config: //!n3xn display=terminal run=main.lua files=a.lua,b.lua",
      "  Compiled langs: place sibling .wasm to execute in-browser",
    ],
  ];

  const CMD_HELP = {
    grep: ["grep [-ril] [-C n] <pattern> [path]", "  Recursive content search in VFS"],
    xdebug: ["xdebug <path> [--live] | tryfix | last | open | copy | fix", "  Advanced non-AI diagnostics"],
    nexc: ["nexc list|run|remote <file.nexc> [module]", "  Package modules, parallel, wait, permissions"],
    storage: ["storage list|use|info|ls|cat|put|rm|meta", "  IDB/OPFS/cache/memory backends"],
    wss: ["wss help — collab, pmsg, voice, share (encrypted)"],
    lang: [
      "lang lua <entry.lua>     — Wasmoon WASM Lua, multifile",
      "lang c|cpp|rust|go <entry> — project scan + optional .wasm run",
      "  //!n3xn display=terminal|preview files=a.c,b.c cwd=/src",
    ],
    run: ["run [mode] <file>", "  modes: html, js, image, markdown, json, css, react, lua, …"],
    help: ["help [page number | command name…]", "  Examples: help 2 | help grep xdebug lang"],
  };

  const a = args || [];
  if (!a.length) {
    HELP_PAGES[0].forEach((l) => print(l));
    print("  (help 2 | help 3 | help <command>)");
    return;
  }

  // page number?
  if (a.length === 1 && /^\d+$/.test(a[0])) {
    const page = Math.max(1, Math.min(HELP_PAGES.length, parseInt(a[0], 10))) - 1;
    HELP_PAGES[page].forEach((l) => print(l));
    return;
  }

  for (const name of a) {
    const key = name.toLowerCase().replace(/^-+/, "");
    if (/^\d+$/.test(key)) {
      const page = Math.max(1, Math.min(HELP_PAGES.length, parseInt(key, 10))) - 1;
      HELP_PAGES[page].forEach((l) => print(l));
      continue;
    }
    const lines = CMD_HELP[key];
    if (lines) lines.forEach((l) => print(l));
    else print("No detailed help for '" + name + "'. Try: help | help 1|2|3", "err");
  }
}

async function loadCustomCommands() {
  try {
    const raw = await db.getMeta("custom_commands");
    if (raw) customCommands = raw;
  } catch {}
}

async function saveCustomCommands() {
  await db.setMeta("custom_commands", customCommands);
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function clearTerminal() {
  outputEl().innerHTML = "";
}

export { print, cwd };


async function cmdGithub(args) {
  const gh = await loadGithub();
  const storage = await loadStorage();
  gh.setLogger((msg, cls) => print(msg, cls || "out"));
  const sub = (args[0] || "help").toLowerCase();

  if (sub === "help" || sub === "-h") {
    print(gh.tokenHelp());
    return;
  }
  if (sub === "auth" || sub === "login" || sub === "token") {
    let tok = args[1];
    if (!tok) tok = prompt("GitHub classic PAT (ghp_…):");
    if (!tok) throw new Error("Token required");
    await gh.setToken(tok);
    print("Token saved encrypted with your n3xn password", "ok");
    return;
  }
  if (sub === "whoami" || sub === "me") {
    const u = gh.getUser() || (await gh.loadSavedToken());
    print(u ? JSON.stringify({ login: u.login, name: u.name, html_url: u.html_url }, null, 2) : "Not authed");
    return;
  }
  if (sub === "logout" || sub === "clear") {
    await gh.clearToken();
    return;
  }
  if (sub === "rate") {
    const r = await gh.rateLimit();
    print(JSON.stringify(r.rate || r, null, 2));
    return;
  }
  if (sub === "storage") {
    if (!args[1]) {
      print("Active: " + storage.getBackendId());
      print(storage.listBackends().map((b) => b.id + " — " + b.label).join("\n"));
      return;
    }
    storage.setBackend(args[1]);
    print("Storage backend: " + storage.getBackendId(), "ok");
    return;
  }
  if (sub === "repos") {
    const repos = await gh.listRepos();
    repos.slice(0, 40).forEach((r) => print(`${r.private ? "🔒" : "🌎"} ${r.full_name}  (${r.default_branch})`));
    print(`(${repos.length} total)`, "ok");
    return;
  }
  if (sub === "use") {
    const spec = args[1];
    if (!spec || !spec.includes("/")) throw new Error("Usage: gh use owner/repo [branch]");
    const [owner, repo] = spec.split("/");
    await gh.setRepo(owner, repo, args[2]);
    return;
  }
  if (sub === "create-repo") {
    const name = args[1];
    if (!name) throw new Error("Usage: gh create-repo <name> [--private]");
    const priv = args.includes("--private");
    const r = await gh.createRepo(name, { private: priv });
    print(`Created ${r.full_name}`, "ok");
    await gh.setRepo(r.owner.login, r.name);
    return;
  }
  if (sub === "branches") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    const b = await gh.listBranches(cr.owner, cr.repo);
    b.forEach((x) => print(x.name + (x.name === cr.branch ? " *" : "")));
    return;
  }
  if (sub === "pull") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    const path = args[1];
    if (path) {
      const local = await gh.pullFile(cr.owner, cr.repo, path, cr.branch);
      print("Saved " + local, "ok");
    } else {
      print("Use gh pull-tree for full tree, or gh pull path/to/file");
    }
    if (window.refreshTree) window.refreshTree();
    return;
  }
  if (sub === "pull-tree" || sub === "clone") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    await gh.pullTree(cr.owner, cr.repo, cr.branch, { maxFiles: parseInt(args[1], 10) || 500 });
    if (window.refreshTree) window.refreshTree();
    return;
  }
  if (sub === "commit") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    const path = args[1];
    if (!path) throw new Error("Usage: gh commit <path> [message words…]");
    const msg = args.slice(2).join(" ") || undefined;
    const f = await gh.readLocalGh(cr.owner, cr.repo, path);
    if (!f) throw new Error("Local file missing — pull or write first: " + path);
    await gh.commitFile(cr.owner, cr.repo, path, f.content, msg, cr.branch);
    return;
  }
  if (sub === "push-paths" || sub === "commit-many") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    const mi = args.indexOf("-m");
    let message = "n3xn multi-file commit";
    let paths = args.slice(1);
    if (mi >= 0) {
      message = args.slice(mi + 1).join(" ");
      paths = args.slice(1, mi);
    }
    if (!paths.length) throw new Error("Usage: gh push-paths file1 file2 -m msg");
    await gh.pushLocalChanges(cr.owner, cr.repo, paths, message, cr.branch);
    return;
  }
  if (sub === "branch") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    if (!args[1]) throw new Error("Usage: gh branch <name>");
    await gh.createBranch(cr.owner, cr.repo, args[1], cr.branch);
    print("Branch created " + args[1], "ok");
    return;
  }
  if (sub === "prs") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    const prs = await gh.listPulls(cr.owner, cr.repo);
    prs.forEach((p) => print(`#${p.number} ${p.title} (${p.head.ref}→${p.base.ref})`));
    return;
  }
  if (sub === "pr") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    const title = args[1], head = args[2], base = args[3] || cr.branch;
    if (!title || !head) throw new Error("Usage: gh pr <title> <head-branch> [base]");
    const pr = await gh.createPull(cr.owner, cr.repo, title, head, base);
    print(`PR #${pr.number} ${pr.html_url}`, "ok");
    return;
  }
  if (sub === "issues") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    const issues = await gh.listIssues(cr.owner, cr.repo);
    issues.forEach((i) => print(`#${i.number} ${i.title}`));
    return;
  }
  if (sub === "issue") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    const title = args.slice(1).join(" ");
    if (!title) throw new Error("Usage: gh issue <title>");
    const i = await gh.createIssue(cr.owner, cr.repo, title);
    print(`Issue #${i.number}`, "ok");
    return;
  }
  if (sub === "gist") {
    const path = args[1] || window.__n3xnActivePath;
    if (!path) throw new Error("Usage: gh gist <local-path>");
    const f = await fs.readFile(path);
    if (!f) throw new Error("File not found");
    const name = path.split("/").pop();
    const g = await gh.createGist({ [name]: { content: f.text() } }, "n3xn gist", false);
    print(g.html_url, "ok");
    return;
  }
  if (sub === "search") {
    const q = args.slice(1).join(" ");
    if (!q) throw new Error("Usage: gh search <query>");
    const r = await gh.searchRepos(q);
    (r.items || []).slice(0, 15).forEach((x) => print(`${x.full_name} ★${x.stargazers_count}`));
    return;
  }
  if (sub === "star") {
    const spec = args[1];
    if (!spec?.includes("/")) throw new Error("Usage: gh star owner/repo");
    const [o, r] = spec.split("/");
    await gh.starRepo(o, r);
    return;
  }
  if (sub === "rm" || sub === "delete") {
    const cr = gh.getCurrentRepo();
    if (!cr) throw new Error("gh use owner/repo first");
    const path = args[1];
    if (!path) throw new Error("Usage: gh rm <path>");
    await gh.deleteRemoteFile(cr.owner, cr.repo, path, args.slice(2).join(" ") || undefined, cr.branch);
    print("Deleted remote " + path, "ok");
    return;
  }
  print('Unknown gh command. Try: gh help');
}


async function cmdN3Site(args) {
  const site = await import("./n3-site.js");
  const sub = (args[0] || "help").toLowerCase();
  if (sub === "help" || sub === "-h") {
    print("n3-site multi-file HTML");
    print("  Directive: _;:(content-type)[kind]{vfs-path}blob|data");
    print("  kinds: script, script-module, stylesheet|css, link");
    print("  n3link <path> [blob|data] [mime]");
    print("  n3site expand|run <file.n3-site> | n3site list [prefix]");
    return;
  }
  if (sub === "list") {
    const list = await site.listVfs(args[1] || "/");
    list.forEach((p) => print(p));
    print(list.length + " files", "ok");
    return;
  }
  if (sub === "expand") {
    const path = resolve(args[1] || window.__n3xnActivePath);
    const f = await fs.readFile(path);
    if (!f) throw new Error("not found");
    const { html, assets } = await site.expandN3Site(f.text(), path);
    assets.forEach((a) => print((a.error ? "ERR " : "OK  ") + (a.path || "") + " " + (a.url || a.error || "")));
    print("expanded HTML length " + html.length, "ok");
    return;
  }
  if (sub === "run") {
    const path = resolve(args[1] || window.__n3xnActivePath);
    const { url, assets } = await site.runN3Site(path);
    assets.forEach((a) => print((a.url || a.error) + " <- " + a.path));
    print("Opened " + url, "ok");
    return;
  }
  let path = sub;
  let method = args[1] || "blob";
  let mime = args[2];
  if (sub === "link" || sub === "make") {
    path = args[1];
    method = args[2] || "blob";
    mime = args[3];
  }
  path = resolve(path);
  if (!path) throw new Error("Usage: n3link <path> [blob|data] [mime]");
  const link = await site.makeLink(path, { method, mime });
  print(link.method + " " + link.mime + " " + link.size + "b");
  print(link.url, "ok");
}


async function cmdReact(args) {
  const rr = await import("./react-runner.js");
  const sub = (args[0] || "run").toLowerCase();
  if (sub === "help") {
    print("react run [entry.jsx]  — Babel JSX/TSX + VFS imports + React 18 CDN");
    print("  Entry default: active file or main.jsx / index.jsx / App.jsx nearby");
    print("  import React from 'react' resolves to esm.sh");
    print("  import './App.jsx' and import './app.css' resolve from VFS");
    print("  Not full Vite (no Node/HMR); Vite-style multi-file React apps yes");
    return;
  }
  let path = sub === "run" ? args[1] : args[0];
  path = resolve(path || window.__n3xnActivePath);
  if (!path) throw new Error("Usage: react run <entry.jsx>");
  const entry = await rr.detectReactEntry(path);
  print("entry " + entry);
  const result = await rr.runReact(entry, { log: (m, c) => print(m, c || "out") });
  print(result.moduleCount + " modules → " + result.url, "ok");
}


/* ========== Quick-win utilities ========== */

function basenameArg(p) {
  const n = resolve(p || "");
  const parts = n.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}
function dirnameArg(p) {
  const n = resolve(p || "");
  if (n === "/") return "/";
  const parts = n.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/") || "/";
}

async function pushUndo(path, text) {
  path = resolve(path);
  if (!fileUndo.has(path)) fileUndo.set(path, { stack: [], redo: [] });
  const u = fileUndo.get(path);
  u.stack.push(text);
  if (u.stack.length > MAX_UNDO) u.stack.shift();
  u.redo = [];
}

async function cmdGrep(args) {
  let recursive = false, inv = false, ignoreCase = false, filesOnly = false, context = 0;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-r" || a === "-R") recursive = true;
    else if (a === "-i") ignoreCase = true;
    else if (a === "-v") inv = true;
    else if (a === "-l") filesOnly = true;
    else if (a === "-n") { /* always show lines */ }
    else if (a === "-C" && args[i + 1]) { context = parseInt(args[++i], 10) || 0; }
    else if (a.startsWith("-")) continue;
    else pos.push(a);
  }
  const pattern = pos[0];
  const target = resolve(pos[1] || cwd);
  if (!pattern) throw new Error("Usage: grep [-ril] [-C n] <pattern> [path]");
  const re = new RegExp(pattern, ignoreCase ? "i" : "");
  let files = [];
  if (fs.isDir(target) || recursive) {
    const all = fs.flatten(fs.isDir(target) ? target : cwd);
    files = all.filter((f) => f.type !== "dir").map((f) => f.path);
    if (!recursive && fs.isDir(target)) {
      files = fs.ls(target).filter((e) => e.type !== "dir").map((e) => (target === "/" ? "/" + e.name : target + "/" + e.name));
    }
  } else {
    files = [target];
  }
  let hits = 0;
  for (const path of files) {
    const f = await fs.readFile(path);
    if (!f) continue;
    let text;
    try { text = f.text(); } catch { continue; }
    const lines = text.split("\n");
    let fileHit = false;
    for (let i = 0; i < lines.length; i++) {
      const ok = re.test(lines[i]);
      if (inv ? !ok : ok) {
        fileHit = true;
        if (filesOnly) break;
        if (context > 0) {
          const from = Math.max(0, i - context);
          const to = Math.min(lines.length - 1, i + context);
          for (let j = from; j <= to; j++) {
            print(`${path}:${j + 1}:${lines[j]}`);
          }
          print("--");
        } else {
          print(`${path}:${i + 1}:${lines[i]}`);
        }
        hits++;
      }
    }
    if (filesOnly && fileHit) {
      print(path);
      hits++;
    }
  }
  if (!hits) print("No matches");
  else print(`${hits} match(es)`, "ok");
}

async function cmdHead(args) {
  let n = 10;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-n" && args[i + 1]) n = parseInt(args[++i], 10) || 10;
    else if (/^-(\d+)$/.test(args[i])) n = parseInt(args[i].slice(1), 10);
    else if (!args[i].startsWith("-")) pos.push(args[i]);
  }
  const path = resolve(pos[0] || window.__n3xnActivePath);
  const f = await fs.readFile(path);
  if (!f) throw new Error("No such file");
  print(f.text().split("\n").slice(0, n).join("\n"));
}

async function cmdTail(args) {
  let n = 10;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-n" && args[i + 1]) n = parseInt(args[++i], 10) || 10;
    else if (/^-(\d+)$/.test(args[i])) n = parseInt(args[i].slice(1), 10);
    else if (!args[i].startsWith("-")) pos.push(args[i]);
  }
  const path = resolve(pos[0] || window.__n3xnActivePath);
  const f = await fs.readFile(path);
  if (!f) throw new Error("No such file");
  const lines = f.text().split("\n");
  print(lines.slice(Math.max(0, lines.length - n)).join("\n"));
}

async function cmdWc(args) {
  const path = resolve(args.find((a) => !a.startsWith("-")) || window.__n3xnActivePath);
  const f = await fs.readFile(path);
  if (!f) throw new Error("No such file");
  const text = f.text();
  const lines = text ? text.split("\n").length : 0;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  print(`${lines} ${words} ${chars} ${path}`);
}

async function cmdDu(args) {
  const path = resolve(args[0] || cwd);
  const all = fs.flatten(path);
  let total = 0;
  for (const e of all) {
    if (e.type === "dir") continue;
    total += e.size || 0;
    if (args.includes("-a")) print(`${e.size || 0}\t${e.path}`);
  }
  print(`${total}\t${path}`, "ok");
}

async function cmdFile(args) {
  const path = resolve(args[0] || window.__n3xnActivePath);
  if (!fs.exists(path)) throw new Error("Not found");
  if (fs.isDir(path)) {
    print(`${path}: directory`);
    return;
  }
  const f = await fs.readFile(path);
  print(`${path}: ${f.mime || "unknown"} (${f.size} bytes)`);
}

async function cmdWhich(args) {
  const name = args[0];
  if (!name) throw new Error("Usage: which <command>");
  if (aliases[name]) {
    print(`${name}: aliased to ${aliases[name]}`);
    return;
  }
  if (customCommands[name]) {
    print(`${name}: custom command`);
    return;
  }
  // built-ins — if we got here switch would handle it
  const builtins = ["help","clear","pwd","cd","ls","cat","grep","find","run","python","react","gh","wss","debug","web","project"];
  if (builtins.includes(name) || true) {
    print(`${name}: n3xn shell builtin / runtime`);
  }
}

async function cmdSort(args) {
  const path = resolve(args.find((a) => !a.startsWith("-")) || window.__n3xnActivePath);
  const f = await fs.readFile(path);
  if (!f) throw new Error("No such file");
  let lines = f.text().split("\n");
  lines.sort((a, b) => (args.includes("-n") ? (parseFloat(a) - parseFloat(b)) : a.localeCompare(b)));
  if (args.includes("-r")) lines.reverse();
  print(lines.join("\n"));
}

async function cmdUniq(args) {
  const path = resolve(args.find((a) => !a.startsWith("-")) || window.__n3xnActivePath);
  const f = await fs.readFile(path);
  if (!f) throw new Error("No such file");
  const lines = f.text().split("\n");
  const out = [];
  for (const l of lines) {
    if (!out.length || out[out.length - 1] !== l) out.push(l);
  }
  print(out.join("\n"));
}

async function cmdHistory(args) {
  if (args[0] === "clear") {
    history = [];
    histIdx = 0;
    print("History cleared", "ok");
    return;
  }
  if (args[0] === "search" || args[0] === "-s") {
    const q = (args[1] || "").toLowerCase();
    history.filter((h) => h.toLowerCase().includes(q)).forEach((h, i) => print(`${i}  ${h}`));
    return;
  }
  history.forEach((h, i) => print(`${String(i).padStart(4)}  ${h}`));
}

async function loadAliases() {
  try {
    const raw = await db.getMeta("shell_aliases");
    if (raw && typeof raw === "object") aliases = raw;
  } catch {}
}
async function saveAliases() {
  await db.setMeta("shell_aliases", aliases);
}

async function cmdAlias(args) {
  if (!args.length) {
    Object.keys(aliases).forEach((k) => print(`alias ${k}='${aliases[k]}'`));
    return;
  }
  const joined = args.join(" ");
  const eq = joined.indexOf("=");
  if (eq < 0) {
    if (aliases[args[0]]) print(`alias ${args[0]}='${aliases[args[0]]}'`);
    else print("No alias: " + args[0]);
    return;
  }
  const name = joined.slice(0, eq).trim();
  let val = joined.slice(eq + 1).trim();
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.slice(1, -1);
  }
  aliases[name] = val;
  await saveAliases();
  print(`alias ${name}='${val}'`, "ok");
}

async function cmdAppend(args, mode) {
  const path = resolve(args[0]);
  const text = args.slice(1).join(" ");
  if (!path || text === undefined) throw new Error(`Usage: ${mode} <file> <text…>`);
  const f = await fs.readFile(path);
  const prev = f ? f.text() : "";
  await pushUndo(path, prev);
  const next = mode === "prepend" ? text + (prev ? "\n" + prev : "") : (prev ? prev + "\n" : "") + text;
  await fs.writeFile(path, next);
  print(`${mode} → ${path}`, "ok");
}

async function cmdReplace(args) {
  // replace <file> <search> <replace>
  if (args.length < 3) throw new Error("Usage: replace <file> <search> <replacement>");
  const path = resolve(args[0]);
  const search = args[1];
  const rep = args.slice(2).join(" ");
  const f = await fs.readFile(path);
  if (!f) throw new Error("No such file");
  const prev = f.text();
  await pushUndo(path, prev);
  const next = prev.split(search).join(rep);
  await fs.writeFile(path, next);
  print(`replace done (${(prev.length - next.length) * -1} bytes Δ)`, "ok");
}

async function cmdInsert(args) {
  // insert <file> <lineNo> <text>
  if (args.length < 3) throw new Error("Usage: insert <file> <line> <text…>");
  const path = resolve(args[0]);
  const lineNo = parseInt(args[1], 10);
  const text = args.slice(2).join(" ");
  const f = await fs.readFile(path);
  if (!f) throw new Error("No such file");
  const prev = f.text();
  await pushUndo(path, prev);
  const lines = prev.split("\n");
  const idx = Math.max(0, Math.min(lines.length, lineNo - 1));
  lines.splice(idx, 0, text);
  await fs.writeFile(path, lines.join("\n"));
  print(`inserted at line ${lineNo}`, "ok");
}

async function cmdDelLine(args) {
  if (args.length < 2) throw new Error("Usage: delline <file> <line>");
  const path = resolve(args[0]);
  const lineNo = parseInt(args[1], 10);
  const f = await fs.readFile(path);
  if (!f) throw new Error("No such file");
  const prev = f.text();
  await pushUndo(path, prev);
  const lines = prev.split("\n");
  if (lineNo < 1 || lineNo > lines.length) throw new Error("Line out of range");
  lines.splice(lineNo - 1, 1);
  await fs.writeFile(path, lines.join("\n"));
  print(`deleted line ${lineNo}`, "ok");
}

async function cmdUndo(args) {
  const path = resolve(args[0] || window.__n3xnActivePath);
  const u = fileUndo.get(path);
  if (!u || !u.stack.length) throw new Error("Nothing to undo for " + path);
  const f = await fs.readFile(path);
  const cur = f ? f.text() : "";
  u.redo.push(cur);
  const prev = u.stack.pop();
  await fs.writeFile(path, prev);
  print("undo → " + path, "ok");
  if (window.__n3xnActivePath === path && window.__n3xnEditor) {
    try { window.__n3xnEditor.setValue(prev); } catch {}
  }
}

async function cmdRedo(args) {
  const path = resolve(args[0] || window.__n3xnActivePath);
  const u = fileUndo.get(path);
  if (!u || !u.redo.length) throw new Error("Nothing to redo for " + path);
  const f = await fs.readFile(path);
  const cur = f ? f.text() : "";
  u.stack.push(cur);
  const next = u.redo.pop();
  await fs.writeFile(path, next);
  print("redo → " + path, "ok");
  if (window.__n3xnActivePath === path && window.__n3xnEditor) {
    try { window.__n3xnEditor.setValue(next); } catch {}
  }
}

async function cmdDiff(args) {
  if (args.length < 2) throw new Error("Usage: diff <fileA> <fileB>");
  const a = await fs.readFile(resolve(args[0]));
  const b = await fs.readFile(resolve(args[1]));
  if (!a || !b) throw new Error("Both files required");
  const la = a.text().split("\n");
  const lb = b.text().split("\n");
  const max = Math.max(la.length, lb.length);
  let n = 0;
  for (let i = 0; i < max; i++) {
    if (la[i] !== lb[i]) {
      print(`${i + 1}: - ${la[i] ?? ""}`);
      print(`${i + 1}: + ${lb[i] ?? ""}`);
      n++;
      if (n > 200) {
        print("… diff truncated");
        break;
      }
    }
  }
  if (!n) print("Files identical", "ok");
}

async function cmdProject(args) {
  const sub = (args[0] || "stats").toLowerCase();
  const root = resolve(args[1] || "/");
  const all = fs.flatten(root);
  const files = all.filter((f) => f.type !== "dir");
  if (sub === "tree") {
    await cmdTree(root);
    return;
  }
  if (sub === "files") {
    files.forEach((f) => print(f.path));
    return;
  }
  if (sub === "info" || sub === "stats") {
    const byExt = {};
    let total = 0;
    for (const f of files) {
      const ext = (f.path.split(".").pop() || "none").toLowerCase();
      byExt[ext] = (byExt[ext] || 0) + 1;
      total += f.size || 0;
    }
    print(`Project ${root}`);
    print(`Files: ${files.length}  Dirs: ${all.length - files.length}`);
    print(`Total size: ${total} bytes`);
    Object.entries(byExt)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => print(`  .${k}: ${v}`));
    return;
  }
  print("Usage: project stats|tree|files|info [path]");
}

async function cmdDebug(args) {
  const path = resolve(args[0] || window.__n3xnActivePath);
  if (!path) throw new Error("Usage: debug <file>");
  const f = await fs.readFile(path);
  if (!f) throw new Error("No such file");
  const text = f.text();
  const ext = (path.split(".").pop() || "").toLowerCase();
  print("N3XN DEBUGGER");
  print("────────────────────────");
  print("File: " + path);
  print("Type: " + (f.mime || ext));
  print("Size: " + f.size + " bytes");
  const warnings = [];
  const errors = [];
  if (ext === "json") {
    try {
      JSON.parse(text);
      print("✓ JSON parse");
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (["js", "jsx", "ts", "tsx"].includes(ext)) {
    const opens = (text.match(/\{/g) || []).length;
    const closes = (text.match(/\}/g) || []).length;
    if (opens !== closes) warnings.push(`Brace mismatch { ${opens} vs } ${closes}`);
    if (ext === "jsx" || ext === "tsx") {
      if (!/from\s+['"]react['"]|require\(['"]react['"]\)/.test(text) && /<\w/.test(text)) {
        warnings.push("JSX-like tags but no react import found");
      }
      try {
        const Babel = window.Babel;
        if (Babel) {
          Babel.transform(text, { presets: ["react"], filename: path });
          print("✓ Babel transform");
        } else {
          print("· Babel not loaded (run a react file once to load)");
        }
      } catch (e) {
        errors.push("Babel: " + (e.message || e));
      }
    }
  }
  if (ext === "py") {
    if (text.includes("\t") && text.includes("    ")) warnings.push("Mixed tabs and spaces");
  }
  if (ext === "html" || ext === "n3-site") {
    if ((text.match(/<html/gi) || []).length && !(text.match(/<\/html>/gi) || []).length) {
      warnings.push("Unclosed <html>");
    }
  }
  if (!warnings.length && !errors.length) print("✓ No static issues detected", "ok");
  if (warnings.length) {
    print("Warnings:");
    warnings.forEach((w) => print("⚠ " + w));
  }
  if (errors.length) {
    print("Errors:");
    errors.forEach((e) => print("✗ " + e, "err"));
  }
}

async function cmdWeb(args) {
  const sub = (args[0] || "run").toLowerCase();
  if (sub === "run" || sub === "preview" || sub === "open") {
    let path = resolve(args[1] || window.__n3xnActivePath || "");
    if (!path || path === cwd) {
      for (const name of ["index.html", "index.n3-site", "main.jsx", "App.jsx", "src/main.jsx"]) {
        const cand = resolve(name);
        if (fs.exists(cand)) {
          path = cand;
          break;
        }
      }
    }
    if (!path || !fs.exists(path)) throw new Error("No entry found (index.html / main.jsx / open a file)");
    print("web → " + path);
    await runner.run(path);
    return;
  }
  if (sub === "stop") {
    print("Close preview panel / blob tabs manually (browser)", "out");
    return;
  }
  print("Usage: web run|preview|open|stop [path]");
}

function toggleTerminalFullscreen() {
  const panel = document.getElementById("terminal-panel");
  if (!panel) return;
  const on = panel.classList.toggle("n3xn-term-fullscreen");
  if (on) {
    panel.style.cssText =
      (panel.style.cssText || "") +
      ";position:fixed;inset:0;z-index:99990;width:100%;height:100%;max-height:100%;";
    print("Terminal fullscreen ON (Ctrl+Shift+F to exit)", "ok");
  } else {
    panel.style.position = "";
    panel.style.inset = "";
    panel.style.zIndex = "";
    panel.style.width = "";
    panel.style.height = "";
    panel.style.maxHeight = "";
    print("Terminal fullscreen OFF", "ok");
  }
}

async function cmdTerminalUi(args) {
  const sub = (args[0] || "fullscreen").toLowerCase();
  if (sub === "fullscreen" || sub === "fs") {
    toggleTerminalFullscreen();
    return;
  }
  print("Usage: terminal fullscreen");
}


/* ========== Storage backends / perf / nexc ========== */

async function cmdStorage(args) {
  const storage = await import("./storage-backends.js");
  const sub = (args[0] || "info").toLowerCase();

  if (sub === "list" || sub === "backends") {
    storage.listBackends().forEach((b) => {
      const mark = b.id === storage.getBackendId() ? " *" : "";
      print(b.id + mark + " — " + b.label);
    });
    return;
  }
  if (sub === "use" || sub === "set") {
    if (!args[1]) throw new Error("Usage: storage use idb|opfs|cache|memory");
    storage.setBackend(args[1]);
    print("Active backend: " + storage.getBackendId(), "ok");
    return;
  }
  if (sub === "info") {
    const info = await storage.storageInfo();
    print(JSON.stringify(info, null, 2));
    return;
  }
  if (sub === "ls") {
    const be = storage.getBackend();
    const prefix = args[1] || "";
    let items = [];
    try {
      items = await be.list();
    } catch (e) {
      // fallback idb
      items = await storage.idbListFiles();
    }
    items
      .filter((x) => !prefix || (x.path || x.key || "").includes(prefix))
      .forEach((x) => {
        const p = x.path || x.key;
        const sys = storage.isSystemPath(p) ? " [SYSTEM]" : "";
        print(`${p}${sys}  ${x.size != null ? x.size + "b" : ""}`);
      });
    return;
  }
  if (sub === "meta") {
    const keys = await storage.idbGetMetaKeys();
    keys.forEach((k) => print(`${k.key}${k.system ? " [SYSTEM]" : ""}`));
    return;
  }
  if (sub === "cat" || sub === "view") {
    const path = resolve(args[1] || "");
    if (!path) throw new Error("Usage: storage cat <path>");
    if (storage.isSystemPath(path)) {
      print("⚠ SYSTEM path — sensitive (secrets / settings). Proceed with care.", "err");
    }
    const be = storage.getBackend();
    let f = await be.get(path);
    if (!f) f = await db.getFile(path);
    if (!f) throw new Error("Not found in active backend / IDB");
    const text = typeof f.text === "function" ? f.text() : new TextDecoder().decode(f.content);
    print(text.length > 80000 ? text.slice(0, 80000) + "\n… truncated" : text);
    return;
  }
  if (sub === "put" || sub === "write") {
    const path = resolve(args[1] || "");
    const content = args.slice(2).join(" ");
    if (!path) throw new Error("Usage: storage put <path> <text…>");
    if (storage.isSystemPath(path)) {
      if (!confirm("⚠ SYSTEM path: " + path + "\nModify anyway?")) {
        print("Aborted", "err");
        return;
      }
    }
    const be = storage.getBackend();
    const bytes = new TextEncoder().encode(content);
    await be.put(path, bytes, { mime: "text/plain" });
    print("Wrote " + path + " via " + be.id, "ok");
    return;
  }
  if (sub === "rm" || sub === "delete") {
    const path = resolve(args[1] || "");
    if (!path) throw new Error("Usage: storage rm <path>");
    if (storage.isSystemPath(path)) {
      if (!confirm("⚠ DELETE SYSTEM path: " + path + "\nAre you sure?")) {
        print("Aborted", "err");
        return;
      }
    }
    const be = storage.getBackend();
    await be.del(path);
    print("Deleted " + path, "ok");
    return;
  }
  if (sub === "experimental-patch") {
    const on = args[1] === "on" || args[1] === "1" || args[1] === "true";
    storage.setExperimentalPatch(on);
    print("Experimental large-file patch: " + (storage.getExperimentalPatch() ? "ON" : "OFF"), "ok");
    return;
  }
  print("Usage: storage list|use|info|ls|meta|cat|put|rm|experimental-patch on|off");
}

async function cmdPerf(args) {
  const perf = await import("./performance.js");
  const sub = (args[0] || "report").toLowerCase();
  if (sub === "json") {
    print(JSON.stringify(await perf.collectReport(), null, 2));
    return;
  }
  const r = await perf.collectReport();
  print(perf.formatReport(r));
}

async function cmdNexc(args) {
  const nexc = await import("./nexc.js");
  const sub = (args[0] || "help").toLowerCase();
  if (sub === "help" || sub === "-h") {
    print(`.nexc packages
  nexc list <file.nexc>
  nexc modules <file.nexc>
  nexc run <file.nexc> [module]
  nexc --r <file.nexc> [module]     (same as run)
  nexc remote <url> [module]        (confirm permissions)

Example file:
  [nexc]
  name = demo
  default = build
  [permissions]
  terminal
  vfs.write
  [module build]
  echo hello
  parallel
    echo a
    echo b
  wait 100ms
  echo done`);
    return;
  }

  async function loadLocal(path) {
    const f = await fs.readFile(resolve(path));
    if (!f) throw new Error("Not found: " + path);
    return nexc.parseNexc(f.text());
  }

  if (sub === "list" || sub === "modules") {
    const parsed = await loadLocal(args[1]);
    print(`${parsed.meta.name} v${parsed.meta.version} default=${parsed.meta.default}`);
    print("permissions: " + (parsed.permissions.join(", ") || "(none)"));
    print("modules:");
    Object.keys(parsed.modules).forEach((m) => print("  • " + m + (m === parsed.meta.default ? " (default)" : "")));
    return;
  }

  if (sub === "run" || sub === "--r" || sub === "-r") {
    const path = args[1];
    const mod = args[2];
    if (!path) throw new Error("Usage: nexc run <file.nexc> [module]");
    const parsed = await loadLocal(path);
    const ok = await nexc.confirmPermissions(parsed.permissions, { source: path });
    if (!ok) {
      print("Aborted", "err");
      return;
    }
    await nexc.runNexc(parsed, mod, {
      runLine: (line) => run(line),
      log: (m, c) => print(m, c || "out"),
    });
    return;
  }

  if (sub === "remote") {
    const url = args[1];
    const mod = args[2];
    if (!url) throw new Error("Usage: nexc remote <url> [module]");
    const { parsed } = await nexc.loadNexcFromUrl(url);
    const ok = await nexc.confirmPermissions(parsed.permissions, { remote: true, source: url });
    if (!ok) {
      print("Aborted", "err");
      return;
    }
    await nexc.runNexc(parsed, mod, {
      runLine: (line) => run(line),
      log: (m, c) => print(m, c || "out"),
    });
    return;
  }

  // nexc file.nexc  shorthand
  if (args[0] && (args[0].endsWith(".nexc") || args[0].includes("/"))) {
    const parsed = await loadLocal(args[0]);
    const ok = await nexc.confirmPermissions(parsed.permissions, { source: args[0] });
    if (!ok) return;
    await nexc.runNexc(parsed, args[1], {
      runLine: (line) => run(line),
      log: (m, c) => print(m, c || "out"),
    });
    return;
  }

  print("Usage: nexc help|list|run|remote …");
}


async function cmdXdebug(args) {
  const xd = await import("./xdebug.js");
  const sub = (args[0] || "").toLowerCase();
  const live = args.includes("--live") || args.includes("-l");

  if (sub === "help" || !args.length) {
    print(`xdebug v2 — advanced non-AI debugger
  xdebug <file|dir|zip> [--live]   static + smells; --live = runtime iframe probe
  xdebug last                      last error/warn overlays
  xdebug open | copy | fix         last finding actions
  xdebug tryfix [file]             apply safe syntax fixes (=== , braces, JSON commas)
  xdebug rules export|import|show|reset   shareable fix packs
  xdebug live <file>               force live probe

Rules include: eqeqeq, no-eval, empty-catch, unused-var, react-key,
  floating-promise, bare-except, mutable-default, image-decode, n3site assets…`);
    if (!args.length) return;
  }

  if (sub === "last") {
    const errs = xd.getLastFindings().filter((f) => f.severity === "error" || f.severity === "warn");
    if (!errs.length) return print("No findings yet");
    errs.slice(-8).forEach((e) => xd.formatOverlay(e).forEach((l) => print(l, e.severity === "error" ? "err" : "out")));
    return;
  }
  if (sub === "open") {
    const errs = xd.getLastFindings();
    const e = [...errs].reverse().find((x) => x.path);
    if (!e) throw new Error("No finding path");
    const path = e.path.split("#")[0];
    if (window.__n3xnOpenFile) await window.__n3xnOpenFile(path);
    else print("Open: " + path);
    return;
  }
  if (sub === "copy") {
    const errs = xd.getLastFindings().filter((f) => f.severity === "error" || f.severity === "warn");
    const e = errs[errs.length - 1];
    if (!e) throw new Error("No finding");
    await navigator.clipboard.writeText(xd.formatOverlay(e).join("\n"));
    print("Copied", "ok");
    return;
  }
  if (sub === "fix") {
    const errs = xd.getLastFindings();
    const e = [...errs].reverse().find((x) => x.severity === "error") || errs[errs.length - 1];
    if (!e) throw new Error("No finding");
    const text = xd.fixPrompt(e);
    await navigator.clipboard.writeText(text);
    print("Fix prompt copied", "ok");
    return;
  }
  if (sub === "rules") {
    const a = (args[1] || "show").toLowerCase();
    if (a === "export") {
      const { pack, url, filename } = xd.exportRulesPack();
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      print("Exported " + filename + " · fixes=" + (pack.fixes || []).length, "ok");
      return;
    }
    if (a === "import") {
      const pasted = args.slice(2).join(" ");
      if (pasted.trim().startsWith("{")) {
        const pack = await xd.importRulesPack(pasted);
        print("Imported " + (pack.name || "pack") + " · fixes=" + (pack.fixes || []).length, "ok");
        return;
      }
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json,.n3xn-xdebug.json";
      input.onchange = async () => {
        try {
          const text = await input.files[0].text();
          const pack = await xd.importRulesPack(text);
          print("Imported " + (pack.name || "pack") + " · fixes=" + (pack.fixes || []).length, "ok");
        } catch (e) {
          print(String(e.message || e), "err");
        }
      };
      input.click();
      print("Pick a rules JSON file…", "out");
      return;
    }
    if (a === "reset") {
      xd.resetRulesPack();
      print("Rules reset to default", "ok");
      return;
    }
    const pack = xd.loadRulesPack();
    print(JSON.stringify({ name: pack.name, version: pack.version, fixes: pack.fixes }, null, 2));
    return;
  }

  if (sub === "tryfix") {
    const path = resolve(args[1] || window.__n3xnActivePath);
    if (!path) throw new Error("Usage: xdebug tryfix <file>");
    const f = await fs.readFile(path);
    if (!f) throw new Error("Not found");
    let text = "";
    if (typeof f === "string") text = f;
    else if (typeof f.text === "function") text = f.text();
    else if (f.content instanceof Uint8Array) text = new TextDecoder().decode(f.content);
    else if (typeof f.content === "string") text = f.content;
    else text = String(f);

    const report = await xd.xdebugPath(path, { live: false });
    const findings = report?.findings || report?.errors || xd.getLastFindings?.() || [];
    const result = await xd.tryFix(path, text, findings);
    if (!result.changed) {
      print("No safe automatic fixes applied", "out");
      (result.applied || []).forEach((a) => print("  · " + a));
      return;
    }
    print("Applied:", "ok");
    (result.applied || []).forEach((a) => print("  ✓ " + a, "ok"));
    if (!confirm("Write fixed content to " + path + "?")) {
      print("Aborted (preview only). Re-run and confirm to save.", "err");
      print(result.text.slice(0, 2000));
      return;
    }
    await fs.writeFile(path, result.text);
    print("Saved " + path, "ok");
    if (window.__n3xnActivePath === path && window.__n3xnEditor) {
      try { window.__n3xnEditor.setValue(result.text); } catch {}
    }
    const again = await xd.xdebugPath(path, { live: false });
    xd.formatReport(again, path).forEach((l) => print(l));
    return;
  }

  const pathArg = ["live", "tryfix", "last", "open", "copy", "fix", "help", "rules"].includes(sub)
    ? args[1]
    : args[0];
  const path = resolve(pathArg || window.__n3xnActivePath);
  if (!path) throw new Error("Usage: xdebug <path> [--live]");
  const useLive = live || sub === "live";
  print(`xdebug → ${path}${useLive ? " (live)" : ""} …`);
  const result = await xd.xdebugPath(path, { live: useLive });
  xd.formatReport(result, path).forEach((l) => {
    if (l.includes("ERROR") || l.startsWith("✗")) print(l, "err");
    else if (l.includes("WARNING") || l.startsWith("⚠")) print(l, "err");
    else if (l.startsWith("✓")) print(l, "ok");
    else print(l);
  });
}



async function cmdLang(args) {
  const lr = await import("./lang-runner.js");
  const sub = (args[0] || "help").toLowerCase();
  if (sub === "help" || sub === "-h") {
    print("lang lua <entry.lua>");
    print("lang c|cpp|rust|go <entry>   — multifile project + //!n3xn config");
    print("  //!n3xn display=terminal files=main.c,util.c");
    print("  //!n3xn display=preview title=MyApp");
    print("  Prebuilt <entry>.wasm runs via WebAssembly.instantiate");
    return;
  }
  const lang = ["lua", "c", "cpp", "rust", "go"].includes(sub) ? sub : null;
  const path = resolve(lang ? args[1] : args[0] || window.__n3xnActivePath);
  if (!path) throw new Error("Usage: lang <lua|c|cpp|rust|go> <entry>");
  print("lang → " + path);
  await lr.runLanguageFile(path, {
    lang: lang || undefined,
    log: (m, c) => print(m, c || "out"),
  });
}


async function cmdChatEngine(args) {
  const chat = await import("./chat.js");
  const sub = (args[0] || "open").toLowerCase();
  if (sub === "help" || sub === "-h") {
    print("chat / sidebar — full chat engine (text, VC, video, rooms)");
    print("  chat open | close | toggle     — sidebar");
    print("  chat local [room]              — BroadcastChannel, no WSS");
    print("  chat join <relayBase> [room]   — public encrypted rooms");
    print("  chat leave | send <msg> | rooms | peers | status");
    print("  chat mic | video               — toggle");
    print("  chat vc                        — join VC mesh with peers");
    print("Rooms: global-text | global-vc | global-hangout");
    print("Works without Collab; better with WSS + wss vidreq/vcreq");
    return;
  }
  if (sub === "open") {
    chat.openChatSidebar();
    print("Chat sidebar open", "ok");
    return;
  }
  if (sub === "close") {
    chat.closeChatSidebar();
    return;
  }
  if (sub === "toggle") {
    const on = chat.toggleChatSidebar();
    print(on ? "Sidebar open" : "Sidebar closed", "ok");
    return;
  }
  if (sub === "local") {
    const room = args[1] || "global-text";
    chat.setChatHandlers({
      log: (m, c) => print(m, c || "out"),
      message: () => {},
      presence: () => {},
    });
    await chat.chatConnectLocal(room);
    chat.openChatSidebar();
    print("Local room " + room + " — open another tab to chat", "ok");
    return;
  }
  if (sub === "join") {
    const relay = args[1];
    const room = args[2] || "global-text";
    if (!relay) throw new Error("Usage: chat join <wss-relay-base> [room]");
    chat.setChatHandlers({
      log: (m, c) => print(m, c || "out"),
      message: () => {},
      presence: () => {},
    });
    await chat.chatConnect(relay, room);
    chat.openChatSidebar();
    return;
  }
  if (sub === "leave") {
    await chat.chatDisconnect();
    return;
  }
  if (sub === "send") {
    await chat.sendChat(args.slice(1).join(" "));
    return;
  }
  if (sub === "rooms") {
    chat.getPublicRooms().forEach((r) => print(`${r.id} — ${r.name} (${r.kind})`));
    return;
  }
  if (sub === "peers" || sub === "status") {
    print(JSON.stringify(chat.getChatStatus(), null, 2));
    return;
  }
  if (sub === "mic") {
    const on = await chat.toggleMic();
    print(on ? "Mic on" : "Mic off", "ok");
    return;
  }
  if (sub === "video") {
    const st = chat.getChatStatus();
    await chat.setVideo(!st.video);
    print((!st.video ? "Video on" : "Video off"), "ok");
    return;
  }
  if (sub === "vc") {
    await chat.joinVcMesh();
    return;
  }
  // default open
  chat.openChatSidebar();
  print("Chat sidebar open — try: chat help", "ok");
}


async function cmdDevtools(args) {
  const dt = await import("./n3xn-devtools.js");
  const sub = (args[0] || "open").toLowerCase();
  if (sub === "help" || sub === "-h") {
    print("devtools | dt — n3xn DevTools (ChromeOS-style dock)");
    print("  devtools open | close");
    print("  devtools install <path|dir|all> [,path2…]   — embed into HTML files");
    print("  devtools install-inline <path|dir|all>      — fully inline script (offline blobs)");
    print("  F12 / Ctrl+Shift+I also toggles. No password.");
    print("  Tabs: Elements, Console, Sources, Network, Application, Clicker, Persist, Settings");
    return;
  }
  if (sub === "close") {
    dt.closeDevtools();
    print("DevTools closed", "ok");
    return;
  }
  if (sub === "install" || sub === "install-inline" || sub === "inject") {
    const inline = sub === "install-inline" || args.includes("--inline");
    const rest = args.slice(1).filter((a) => a !== "--inline").join(" ");
    const targets = dt.parseInstallTargets(rest || "all", cwd);
    // resolve relative
    const resolved = targets.map((p) => (p.startsWith("/") ? p : resolve(p)));
    print("Installing DevTools into: " + resolved.join(", ") + (inline ? " (inline)" : ""), "out");
    const results = await dt.installToVfs(resolved, { inline, recursive: true });
    for (const r of results) {
      if (r.skipped) print("  skip " + r.path + " (" + (r.note || "") + ")");
      else if (r.ok) print("  ok   " + r.path, "ok");
      else print("  fail " + r.path + " — " + (r.error || ""), "err");
    }
    print("Done: " + results.filter((x) => x.ok && !x.skipped).length + " installed", "ok");
    return;
  }
  dt.mountHostDevtools();
  dt.openDevtools();
  print("n3xn DevTools open (F12)", "ok");
}


async function cmdSwOffline(args) {
  const sub = (args[0] || "status").toLowerCase();
  if (sub === "help") {
    print("sw — service worker offline packs");
    print("  sw status");
    print("  Offline packs ON by default after SW install (Monaco, Pyodide, React, JSZip, Wasmoon…).");
    print("  sw pyodide on|off");
    print("  sw react on|off");
    print("  sw cdn on|off         — jsdelivr/esm/cdnjs/fonts intercept");
    print("  sw warm pyodide|react|cdn|all");
    print("  Proxies: /__monaco__/ /__pyodide__/ /__cdn__/");
    return;
  }
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
    print("No active service worker (register SW / reload first)", "err");
    return;
  }
  const ctl = navigator.serviceWorker.controller;

  function ask(type, extra = {}) {
    return new Promise((resolve) => {
      const onMsg = (e) => {
        if (!e.data || (e.data.type !== "N3XN_SW_CONFIG_OK" && e.data.type !== "N3XN_SW_STATUS")) return;
        navigator.serviceWorker.removeEventListener("message", onMsg);
        resolve(e.data);
      };
      navigator.serviceWorker.addEventListener("message", onMsg);
      ctl.postMessage({ type, ...extra });
      setTimeout(() => {
        navigator.serviceWorker.removeEventListener("message", onMsg);
        resolve(null);
      }, 8000);
    });
  }

  if (sub === "status") {
    const st = await ask("N3XN_SW_STATUS");
    if (!st) print("SW did not respond (update sw.js and reload)", "err");
    else print("pyodide offline: " + st.pyodide + " · react offline: " + st.react, "ok");
    return;
  }

  if (sub === "pyodide" || sub === "react" || sub === "cdn") {
    const on = ["on", "1", "true", "yes"].includes((args[1] || "").toLowerCase());
    const off = ["off", "0", "false", "no"].includes((args[1] || "").toLowerCase());
    if (!on && !off) {
      print("Usage: sw " + sub + " on|off");
      return;
    }
    const payload = { type: "N3XN_SW_CONFIG" };
    payload[sub] = on;
    print("Setting " + sub + " offline = " + on + (on ? " (warming cache…)" : ""), "out");
    const st = await ask("N3XN_SW_CONFIG", payload);
    if (st) print("ok — pyodide:" + st.pyodide + " react:" + st.react, "ok");
    else print("Sent; if no reply, hard-reload after deploy", "out");
    return;
  }

  if (sub === "warm") {
    const what = (args[1] || "all").toLowerCase();
    if (what === "pyodide" || what === "all") {
      ctl.postMessage({ type: "WARM_PYODIDE" });
      print("Warming Pyodide cache…", "out");
    }
    if (what === "react" || what === "cdn" || what === "all") {
      ctl.postMessage({ type: what === "cdn" ? "WARM_CDN" : "WARM_REACT" });
      print("Warming React/Babel/CDN cache…", "out");
    }
    if (what === "all") {
      ctl.postMessage({ type: "WARM_ALL" });
    }
    return;
  }

  print('Unknown. Try "sw help"', "err");
}


async function cmdMinecraft(args) {
  const mc = await import("./minecraft.js");
  const sub = (args[0] || "help").toLowerCase();

  if (sub === "help" || sub === "-h") {
    print("minecraft | mc — Chromebook Minecraft");
    print("  Browsers cannot fetch release files (CORS). Use this flow:");
    print("  1) minecraft get [id]     — starts a normal browser download");
    print("  2) minecraft import       — pick the downloaded .html → seeds /mc.html");
    print("  3) minecraft offline      — open /mc.html");
    print("");
    print("  minecraft list");
    print("  minecraft get [id|#]      — browser download (recommended: 1.8-better)");
    print("  minecraft import          — file picker → /mc.html + open");
    print("  minecraft load <vfs-path> — use a file already in VFS");
    print("  minecraft offline         — open cached /mc.html");
    print("  minecraft open [id]       — try site proxy, else same as get");
    print("  minecraft skins | skin <name>");
    print("  Built-in proxy: /__proxy__/ on this site (automatic).");
    print("  minecraft proxy status|off     — external proxy stays OFF unless you set a custom URL");
    print("  minecraft proxy set <url>      — optional third-party proxy only");
    return;
  }

  if (sub === "list" || sub === "ls") {
    for (const r of mc.listVersions()) {
      print(
        String(r.n).padStart(2) + ". " + r.id.padEnd(16) + " " + r.label +
          "  (" + r.size + ")" + (r.recommend ? "  ★" : "")
      );
    }
    print('Next: minecraft get 1.8-better   then   minecraft import');
    return;
  }

  if (sub === "proxy") {
    const a = (args[1] || "status").toLowerCase();
    if (a === "off" || a === "disable") {
      mc.setProxyEnabled(false);
      print("Fetch-proxy OFF — get/open will use browser download + import only", "ok");
      return;
    }
    if (a === "on" || a === "enable") {
      if (!mc.getFetchProxy()) {
        print("No external proxy URL set. Built-in /__proxy__/ is always used first.", "out");
        print("Only set an external one with: minecraft proxy set https://…/$/", "out");
        return;
      }
      mc.setProxyEnabled(true);
      print("External fetch-proxy ON — " + mc.getFetchProxy(), "ok");
      return;
    }
    if (a === "set") {
      const url = args.slice(2).join(" ").trim();
      if (!url) {
        print("Usage: minecraft proxy set https://your-proxy.pages.dev/$/");
        return;
      }
      print("Proxy set to " + mc.setFetchProxy(url), "ok");
      return;
    }
    if (a === "clear") {
      mc.setFetchProxy("clear");
      print("Proxy URL cleared & disabled", "ok");
      return;
    }
    print("proxy enabled: " + mc.isProxyEnabled());
    print("proxy base: " + (mc.getFetchProxy() || "(none)"));
    print("Commands: minecraft proxy on|off|status|set <url>|clear");
    return;
  }

  if (sub === "import" || sub === "upload" || sub === "seed") {
    print("Pick the Minecraft .html file you downloaded…", "out");
    try {
      const r = await mc.importLocalFile({ open: true });
      print("Seeded /mc.html (" + Math.round(r.size / 1048576) + " MB) and opened", "ok");
    } catch (e) {
      print(String(e.message || e), "err");
    }
    return;
  }

  if (sub === "load") {
    const path = args[1];
    if (!path) {
      print("Usage: minecraft load /minecraft/game.html", "err");
      return;
    }
    try {
      const r = await mc.loadFromVfs(path.startsWith("/") ? path : "/" + path);
      print("Loaded " + path + " → /mc.html (" + Math.round(r.size / 1048576) + " MB)", "ok");
    } catch (e) {
      print(String(e.message || e), "err");
    }
    return;
  }

  if (sub === "offline" || sub === "play") {
    print("Opening same-origin /mc.html (not about:blank)…", "ok");
    try {
      mc.openOfflineMc();
    } catch (e) {
      print(String(e.message || e), "err");
    }
    return;
  }

  if (sub === "get" || sub === "download" || sub === "dl") {
    const key = args.slice(1).join(" ") || "1.8-better";
    print("Getting " + key + "…", "out");
    try {
      const r = await mc.fetchMcAsset("game", key, (m) => print(m, "out"));
      mc.downloadBlob(r.blob, r.filename);
      print("Saved " + r.filename + " (" + Math.round(r.size / 1048576) + " MB) via " + r.method, "ok");
      if (r.method === "user-proxy" || r.method === "site-proxy" || r.method === "sw-cache") {
        print("/mc.html seeded — use: minecraft offline (no more proxy bandwidth)", "ok");
      }
    } catch (e) {
      if (e && e.code === "NEED_IMPORT") {
        print(e.message, "out");
        print("After the file lands in Downloads → minecraft import", "ok");
      } else {
        print(String(e.message || e), "err");
      }
    }
    return;
  }

  if (sub === "open") {
    const key = args.slice(1).join(" ") || "1.8-better";
    print("Trying open " + key + "…", "out");
    try {
      const r = await mc.openMcInTab(key);
      print("Opened " + r.filename + " via " + (r.method || "blob"), "ok");
    } catch (e) {
      if (e && e.code === "NEED_IMPORT") {
        print(e.message, "out");
        print("Run: minecraft import", "ok");
      } else {
        print(String(e.message || e), "err");
        print("Fallback: minecraft get " + key + "  then  minecraft import", "out");
      }
    }
    return;
  }

  if (sub === "skins") {
    mc.listSkins().forEach((s, i) => print(String(i + 1).padStart(2) + ". " + s));
    print("Skins: use browser download from the skins release, or minecraft skin <name>");
    return;
  }

  if (sub === "skin") {
    const key = args.slice(1).join(" ");
    if (!key) {
      print("Usage: minecraft skin <name-fragment>");
      return;
    }
    try {
      const r = await mc.fetchMcAsset("skin", key, (m) => print(m, "out"));
      mc.downloadBlob(r.blob, r.filename);
      print("Saved " + r.filename, "ok");
    } catch (e) {
      print(String(e.message || e), "err");
    }
    return;
  }

  // bare id → same as get
  if (sub && sub !== "help") {
    try {
      const r = await mc.fetchMcAsset("game", args.join(" ") || sub, (m) => print(m, "out"));
      print("Ready " + r.filename + " (" + Math.round(r.size / 1048576) + " MB) via " + r.method, "ok");
      mc.openOfflineMc();
    } catch (e) {
      print(String(e.message || e), "err");
      print("Fallback: minecraft import", "out");
    }
  }
}


async function cmdN3xnChat() {
  print("Opening n3xn chat (/n3xn-chat.html)…", "ok");
  const mc = await import("./minecraft.js");
  mc.openN3xnChat();
}


/* ========== Multi-line terminal (Monaco shell) ========== */
let __termMulti = false;
let __termMonaco = null;

export function initTermMultiButton() {
  const btn = document.getElementById("btn-term-multi");
  if (!btn) return;
  btn.onclick = () => toggleTermMulti();
}

async function toggleTermMulti() {
  const input = document.getElementById("terminal-input");
  const row = document.querySelector(".terminal-input-row");
  if (!row) return;
  __termMulti = !__termMulti;
  if (!__termMulti) {
    const host = document.getElementById("term-monaco-host");
    if (host) host.remove();
    if (input) input.style.display = "";
    __termMonaco = null;
    return;
  }
  if (input) input.style.display = "none";
  let host = document.getElementById("term-monaco-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "term-monaco-host";
    host.style.cssText = "flex:1;min-height:120px;height:160px;border:1px solid #1e293b;border-radius:6px;overflow:hidden";
    row.style.flexDirection = "column";
    row.style.alignItems = "stretch";
    row.appendChild(host);
  }
  // reuse monaco from editor
  await window.__n3xnEnsureMonaco?.();
  const monaco = window.monaco;
  if (!monaco) {
    print("Monaco not ready", "err");
    return;
  }
  if (__termMonaco) {
    __termMonaco.layout();
    return;
  }
  __termMonaco = monaco.editor.create(host, {
    value: "",
    language: "shell",
    theme: (window.__n3xnMonacoSettings && window.__n3xnMonacoSettings.theme) || "vs-dark",
    minimap: { enabled: false },
    lineNumbers: "on",
    wordWrap: "on",
    fontSize: 13,
    automaticLayout: true,
    scrollBeyondLastLine: false,
  });
  __termMonaco.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, async () => {
    const text = __termMonaco.getValue().trim();
    if (!text) return;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      print("n3xn@vfs:$ " + t, "cmd");
      try {
        await run(t);
      } catch (e) {
        print(String(e.message || e), "err");
      }
    }
  });
  print("Multi-line terminal on — Ctrl+Enter to run", "ok");
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    initTermMultiButton();
  } catch (_) {}
});
// also try immediately
try {
  initTermMultiButton();
} catch (_) {}


async function cmdPresence(args) {
  const collab = await import("./collab.js");
  const sub = (args[0] || "show").toLowerCase();
  if (sub === "show" || sub === "status") {
    print(JSON.stringify(collab.getPresenceStyle(), null, 2));
    return;
  }
  if (sub === "name") {
    collab.setPresenceStyle({ name: args.slice(1).join(" ") || null });
    print("Presence name set", "ok");
    return;
  }
  if (sub === "color") {
    collab.setPresenceStyle({ color: args[1] || null });
    print("Caret color set — others see this on your cursor", "ok");
    return;
  }
  if (sub === "sel" || sub === "selection") {
    collab.setPresenceStyle({ selectionColor: args[1] || null });
    print("Selection highlight color set", "ok");
    return;
  }
  if (sub === "label") {
    collab.setPresenceStyle({ labelBg: args[1], labelFg: args[2] || "#000" });
    print("Name badge colors set", "ok");
    return;
  }
  print("presence show|name <str>|color <#hex>|sel <#hex>|label <bg> [fg]");
}
