/**
 * n3xn VFS — .nexc package format (v1)
 *
 * Minimal INI-like syntax:
 *
 * [nexc]
 * name = My Tool
 * version = 1.0
 * default = build
 *
 * [permissions]
 * vfs.read
 * vfs.write
 * terminal
 * network
 *
 * [module build]
 * echo building
 * mkdir -p /out
 * at 0ms
 *   echo step A
 * parallel
 *   echo B
 *   echo C
 * wait 200ms
 * echo done
 *
 * Run: nexc run file.nexc [module]
 *      nexc list file.nexc
 *      nexc --r file.nexc
 */

import * as db from "./db.js";

const SYSTEM_WARN =
  /^(secret:|monaco_|github_|shell_aliases|custom_commands|n3xn_|opfs-meta:)/i;

export function isSystemKey(key) {
  return SYSTEM_WARN.test(String(key || ""));
}

export function parseNexc(text) {
  const lines = String(text || "").split(/\r?\n/);
  const meta = { name: "untitled", version: "0", default: "default" };
  const permissions = [];
  const modules = {};
  let section = null;
  let modName = null;
  let buf = [];

  function flushMod() {
    if (modName != null) {
      modules[modName] = parseModuleBody(buf.join("\n"));
      buf = [];
    }
  }

  for (let raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    const sec = trimmed.match(/^\[([^\]]+)\]$/);
    if (sec) {
      flushMod();
      modName = null;
      const name = sec[1].trim();
      if (name === "nexc") section = "nexc";
      else if (name === "permissions") section = "permissions";
      else if (name.startsWith("module ")) {
        section = "module";
        modName = name.slice(7).trim() || "default";
        buf = [];
      } else {
        section = name;
        if (name !== "nexc" && name !== "permissions") {
          modName = name;
          buf = [];
          section = "module";
        }
      }
      continue;
    }

    if (section === "nexc") {
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const k = trimmed.slice(0, eq).trim().toLowerCase();
        const v = trimmed.slice(eq + 1).trim();
        meta[k] = v;
      }
      continue;
    }
    if (section === "permissions") {
      permissions.push(trimmed.replace(/^[-*]\s*/, ""));
      continue;
    }
    if (section === "module" && modName) {
      buf.push(line);
    }
  }
  flushMod();

  if (!Object.keys(modules).length) {
    // whole file as default module of bare commands
    modules.default = parseModuleBody(text);
  }
  if (!meta.default) meta.default = Object.keys(modules)[0] || "default";

  return { meta, permissions, modules };
}

function parseModuleBody(body) {
  const steps = [];
  const lines = String(body || "").split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith("#")) {
      i++;
      continue;
    }
    // at 500ms
    const at = t.match(/^at\s+(\d+)\s*(ms|s)?$/i);
    if (at) {
      let ms = parseInt(at[1], 10);
      if ((at[2] || "ms").toLowerCase() === "s") ms *= 1000;
      const group = [];
      i++;
      while (i < lines.length) {
        const t2 = lines[i].trim();
        if (!t2 || t2.startsWith("#")) {
          i++;
          continue;
        }
        if (/^(at\s+|parallel|wait\s+|\[)/i.test(t2) && !lines[i].startsWith(" ") && !lines[i].startsWith("\t")) {
          break;
        }
        if (lines[i].startsWith(" ") || lines[i].startsWith("\t") || !/^(at\s+|parallel|wait\s+)/i.test(t2)) {
          // indented or plain commands until next directive at column 0
          if (/^(at\s+|parallel|wait\s+)/i.test(t2) && !lines[i].match(/^[\s]/)) break;
          group.push(t2);
          i++;
          continue;
        }
        break;
      }
      steps.push({ type: "at", ms, commands: group });
      continue;
    }
    if (/^parallel$/i.test(t)) {
      const group = [];
      i++;
      while (i < lines.length) {
        const t2 = lines[i].trim();
        if (!t2 || t2.startsWith("#")) {
          i++;
          continue;
        }
        if (/^(at\s+|parallel|wait\s+)/i.test(t2) && !lines[i].match(/^[\s]/)) break;
        if (lines[i].match(/^[\s]/) || !/^(at\s+|parallel|wait\s+)/i.test(t2)) {
          group.push(t2);
          i++;
          continue;
        }
        break;
      }
      steps.push({ type: "parallel", commands: group });
      continue;
    }
    const wait = t.match(/^wait\s+(\d+)\s*(ms|s)?$/i);
    if (wait) {
      let ms = parseInt(wait[1], 10);
      if ((wait[2] || "ms").toLowerCase() === "s") ms *= 1000;
      steps.push({ type: "wait", ms });
      i++;
      continue;
    }
    steps.push({ type: "cmd", command: t });
    i++;
  }
  return steps;
}

export async function confirmPermissions(perms, { remote = false, source = "" } = {}) {
  if (!perms.length) return true;
  const msg =
    (remote ? "REMOTE .nexc EXECUTION\n\nSource: " + source + "\n\n" : ".nexc requests permissions:\n\n") +
    perms.map((p) => "  • " + p).join("\n") +
    "\n\nAllow?";
  return window.confirm(msg);
}

/**
 * @param {object} parsed
 * @param {string} moduleName
 * @param {{ runLine: (cmd: string) => Promise<void>, log?: Function }} host
 */
export async function runNexc(parsed, moduleName, host) {
  const mod = moduleName || parsed.meta.default || "default";
  const steps = parsed.modules[mod];
  if (!steps) throw new Error("Module not found: " + mod + " (have: " + Object.keys(parsed.modules).join(", ") + ")");
  const log = host.log || (() => {});
  log(`nexc «${parsed.meta.name}» module=${mod}`, "ok");

  for (const step of steps) {
    if (step.type === "wait") {
      log(`wait ${step.ms}ms`, "out");
      await sleep(step.ms);
      continue;
    }
    if (step.type === "at") {
      log(`at ${step.ms}ms → ${step.commands.length} cmd(s)`, "out");
      await sleep(step.ms);
      for (const c of step.commands) await host.runLine(c);
      continue;
    }
    if (step.type === "parallel") {
      log(`parallel × ${step.commands.length}`, "out");
      await Promise.all(step.commands.map((c) => host.runLine(c)));
      continue;
    }
    if (step.type === "cmd") {
      await host.runLine(step.command);
    }
  }
  log("nexc done", "ok");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function loadNexcFromPath(path, readFile) {
  const f = await readFile(path);
  if (!f) throw new Error("File not found: " + path);
  return parseNexc(f.text());
}

export async function loadNexcFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  return { parsed: parseNexc(text), text, url };
}
