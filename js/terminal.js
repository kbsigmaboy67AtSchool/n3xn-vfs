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

export function initTerminal() {
  const input = inputEl();
  input.addEventListener("keydown", onKey);
  print("n3xn Virtual FileSystem v2 — Terminal", "ok");
  print('Type "help" for commands. Everything is encrypted & local.', "out");
  loadCustomCommands();
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

async function run(line) {
  const parts = parseArgs(line);
  const cmd = parts[0];
  const args = parts.slice(1);

  try {
    if (customCommands[cmd]) {
      await runCustom(cmd, args);
      return;
    }

    switch (cmd) {
      case "help":
        showHelp();
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
        await cmdCat(args[0]);
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
  if (!path) return cwd;
  if (path.startsWith("/")) return path;
  if (path === "..") {
    if (cwd === "/") return "/";
    const parts = cwd.split("/").filter(Boolean);
    parts.pop();
    return "/" + parts.join("/") || "/";
  }
  if (path.startsWith("./")) path = path.slice(2);
  return cwd === "/" ? "/" + path : cwd + "/" + path;
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

async function cmdCat(path) {
  if (!path) throw new Error("Usage: cat <file>");
  const f = await fs.readFile(resolve(path));
  if (!f) throw new Error("No such file");
  // Limit display for huge files
  const text = f.text();
  if (text.length > 100000) {
    print(text.slice(0, 100000) + "\n\n... [truncated — file is " + f.size + " bytes]", "out");
  } else {
    print(text);
  }
}

async function cmdMkdir(args) {
  for (const a of args) {
    if (a.startsWith("-")) continue;
    await fs.mkdir(resolve(a));
    print("Created: " + resolve(a), "ok");
  }
}

async function cmdTouch(args) {
  for (const a of args) {
    if (a.startsWith("-")) continue;
    const p = resolve(a);
    if (!fs.exists(p)) {
      await fs.writeFile(p, "");
      print("Created: " + p, "ok");
    } else {
      print("Exists: " + p);
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
  // run [mode] <file>
  // modes: html, html-window, js, image, markdown, json, css, text, dataurl, blob-open
  let mode, path;
  const modes = ["html", "html-window", "js", "image", "markdown", "md", "json", "css", "text", "dataurl", "blob-open", "auto"];
  if (args.length === 0) {
    path = window.__n3xnActivePath;
    if (!path) throw new Error("Usage: run [mode] <file>  (or open a file first)");
  } else if (modes.includes(args[0]) && args[1]) {
    mode = args[0] === "auto" ? undefined : args[0];
    path = resolve(args[1]);
  } else if (modes.includes(args[0]) && !args[1]) {
    mode = args[0] === "auto" ? undefined : args[0];
    path = window.__n3xnActivePath;
    if (!path) throw new Error("No file open");
  } else {
    path = resolve(args[0]);
    mode = args[1] && modes.includes(args[1]) ? args[1] : undefined;
  }
  print(`Running ${path}${mode ? " as " + mode : ""}…`);
  await runner.run(path, mode);
  print("Done — blob URL logged above", "ok");
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

function showHelp() {
  const lines = [
    "Built-in commands:",
    "  help, clear, pwd, cd, ls [-l], cat, mkdir, touch, rm [-r],",
    "  mv, cp, find <pattern>, echo, whoami, stat, tree,",
    "  export [fs|path], patch <pat> <search> <replace> [--dry],",
    "  run [mode] <file>  — html|html-window|js|image|markdown|json|css|text|blob-open",
    "  blob make|list|open|watch|clear <file|idx>",
    "  webfile get|sync|headers|put   — fetch/sync URLs into VFS",
    "  cmd list|add|rm   — manage custom commands",
    "",
    "Custom commands can use: fs, db, print, args, cwd, resolve",
    "Everything is encrypted at rest. Local only.",
  ];
  lines.forEach((l) => print(l));
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
