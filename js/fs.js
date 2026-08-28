/**
 * n3xn VFS v2 — Virtual Filesystem layer
 * Hierarchical tree stored in meta + encrypted blobs in IndexedDB
 */

import * as db from "./db.js";

let tree = { type: "dir", children: {} }; // in-memory root

export async function loadTree() {
  const root = await db.getMeta("root");
  if (root && root.type === "dir" && root.children && Object.keys(root.children).length > 0) {
    tree = root;
  } else {
    // Meta missing/empty — rebuild from actual IndexedDB file records
    tree = { type: "dir", children: {} };
    try {
      await rebuildTreeFromFiles();
    } catch (e) {
      console.warn("rebuildTreeFromFiles failed", e);
    }
  }
  // Always ensure children object exists
  if (!tree.children) tree.children = {};
  return tree;
}

/** Rebuild directory tree from every file stored in IndexedDB */
export async function rebuildTreeFromFiles() {
  const files = await db.listAllFiles();
  const newTree = { type: "dir", children: {} };

  function ensureDir(parts) {
    let node = newTree;
    for (const p of parts) {
      if (!node.children[p]) {
        node.children[p] = { type: "dir", children: {}, created: Date.now() };
      } else if (node.children[p].type !== "dir") {
        // name collision file vs dir — keep as dir wrapper isn't ideal; skip
        return null;
      }
      node = node.children[p];
    }
    return node;
  }

  for (const f of files) {
    const path = f.path.startsWith("/") ? f.path : "/" + f.path;
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const name = parts.pop();
    const parent = ensureDir(parts);
    if (!parent) continue;
    parent.children[name] = {
      type: "file",
      size: f.size || 0,
      mime: f.mime || "application/octet-stream",
      modified: f.modified || Date.now(),
    };
  }

  tree = newTree;
  await saveTree();
  return tree;
}

export async function saveTree() {
  if (!tree.children) tree.children = {};
  await db.setMeta("root", tree);
}

function normalize(path) {
  if (!path || path === "/") return "/";
  return "/" + path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

function split(path) {
  const n = normalize(path);
  if (n === "/") return [];
  return n.slice(1).split("/");
}

function getNode(path) {
  const parts = split(path);
  let node = tree;
  for (const p of parts) {
    if (!node || node.type !== "dir" || !node.children[p]) return null;
    node = node.children[p];
  }
  return node;
}

function getParent(path) {
  const parts = split(path);
  if (parts.length === 0) return { parent: null, name: null };
  const name = parts.pop();
  let parent = tree;
  for (const p of parts) {
    if (!parent.children[p] || parent.children[p].type !== "dir") return null;
    parent = parent.children[p];
  }
  return { parent, name };
}

export function getTree() {
  return tree;
}

export async function mkdir(path) {
  path = normalize(path);
  if (path === "/") return;
  const { parent, name } = getParent(path);
  if (!parent) throw new Error("Parent directory does not exist");
  if (parent.children[name]) throw new Error("Already exists");
  parent.children[name] = { type: "dir", children: {}, created: Date.now() };
  await saveTree();
}

export async function writeFile(path, content, meta = {}) {
  path = normalize(path);
  const { parent, name } = getParent(path);
  if (!parent) throw new Error("Parent directory does not exist: " + path);

  // Ensure parent dirs exist? Optional recursive create
  if (!parent.children[name]) {
    parent.children[name] = {
      type: "file",
      size: 0,
      mime: meta.mime || "application/octet-stream",
      modified: Date.now(),
    };
  } else if (parent.children[name].type === "dir") {
    throw new Error("Is a directory");
  }

  await db.putFile(path, content, meta);
  const node = parent.children[name];
  node.type = "file";
  node.modified = Date.now();
  if (typeof content === "string") node.size = new TextEncoder().encode(content).length;
  else if (content instanceof Uint8Array) node.size = content.length;
  else if (content instanceof ArrayBuffer) node.size = content.byteLength;
  await saveTree();
}

export async function readFile(path) {
  path = normalize(path);
  const node = getNode(path);
  if (!node) throw new Error("No such file: " + path);
  if (node.type === "dir") throw new Error("Is a directory");
  return db.getFile(path);
}

export async function remove(path) {
  path = normalize(path);
  if (path === "/") throw new Error("Cannot remove root");
  const { parent, name } = getParent(path);
  if (!parent || !parent.children[name]) throw new Error("No such file or directory");

  const node = parent.children[name];
  if (node.type === "dir") {
    if (Object.keys(node.children).length > 0) {
      throw new Error("Directory not empty (use rm -r)");
    }
  } else {
    await db.deleteFile(path);
  }
  delete parent.children[name];
  await saveTree();
}

export async function removeRecursive(path) {
  path = normalize(path);
  if (path === "/") throw new Error("Cannot remove root");
  const node = getNode(path);
  if (!node) throw new Error("No such file or directory");

  async function walk(p, n) {
    if (n.type === "dir") {
      for (const [child, cnode] of Object.entries(n.children)) {
        await walk(p + "/" + child, cnode);
      }
    } else {
      await db.deleteFile(p);
    }
  }
  await walk(path, node);

  const { parent, name } = getParent(path);
  delete parent.children[name];
  await saveTree();
}

export function ls(path = "/") {
  path = normalize(path);
  const node = getNode(path);
  if (!node) throw new Error("No such directory");
  if (node.type !== "dir") throw new Error("Not a directory");
  return Object.entries(node.children).map(([name, n]) => ({
    name,
    type: n.type,
    size: n.size || 0,
    modified: n.modified || n.created,
  }));
}

export function exists(path) {
  return !!getNode(normalize(path));
}

export function isDir(path) {
  const n = getNode(normalize(path));
  return n && n.type === "dir";
}

export function isFile(path) {
  const n = getNode(normalize(path));
  return n && n.type === "file";
}

/** Build flat list of all paths for tree UI */
export function flatten(path = "/", prefix = "") {
  const node = getNode(path);
  if (!node || node.type !== "dir") return [];
  const result = [];
  for (const [name, n] of Object.entries(node.children)) {
    const full = path === "/" ? "/" + name : path + "/" + name;
    result.push({ path: full, name, type: n.type, size: n.size || 0 });
    if (n.type === "dir") {
      result.push(...flatten(full));
    }
  }
  return result;
}

/** Import a FileList or array of File objects into a target directory */
export async function importFiles(files, targetDir = "/") {
  targetDir = normalize(targetDir);
  if (!isDir(targetDir) && targetDir !== "/") {
    await mkdir(targetDir);
  }

  for (const file of files) {
    // webkitRelativePath for folder imports
    let rel = file.webkitRelativePath || file.name;
    // Strip the top folder name if present
    if (rel.includes("/")) {
      const parts = rel.split("/");
      // keep relative structure
      rel = parts.join("/");
    }
    const dest = targetDir === "/" ? "/" + rel : targetDir + "/" + rel;

    // Create intermediate directories
    const parts = dest.split("/").filter(Boolean);
    parts.pop(); // remove filename
    let current = "";
    for (const p of parts) {
      current += "/" + p;
      if (!exists(current)) {
        await mkdir(current);
      }
    }

    const buffer = await file.arrayBuffer();
    await writeFile(dest, buffer, { mime: file.type || undefined });
  }
}

/** Import a ZIP into target directory */
export async function importZip(file, targetDir = "/") {
  const zip = await JSZip.loadAsync(file);
  targetDir = normalize(targetDir);

  const entries = [];
  zip.forEach((relPath, entry) => {
    entries.push({ relPath, entry });
  });

  for (const { relPath, entry } of entries) {
    if (entry.dir) {
      const dirPath = targetDir === "/" ? "/" + relPath.replace(/\/$/, "") : targetDir + "/" + relPath.replace(/\/$/, "");
      if (!exists(dirPath)) await mkdir(dirPath);
    } else {
      const content = await entry.async("uint8array");
      const dest = targetDir === "/" ? "/" + relPath : targetDir + "/" + relPath;
      // ensure parents
      const parts = dest.split("/").filter(Boolean);
      parts.pop();
      let current = "";
      for (const p of parts) {
        current += "/" + p;
        if (!exists(current)) await mkdir(current);
      }
      await writeFile(dest, content);
    }
  }
}

/** Export a path (file or folder) as ZIP */
export async function exportZip(path = "/") {
  path = normalize(path);
  const zip = new JSZip();

  async function add(p, node, zipPath) {
    if (node.type === "file") {
      const f = await db.getFile(p);
      if (f) zip.file(zipPath || p.slice(1), f.content);
    } else {
      const folder = zipPath ? zip.folder(zipPath) : zip;
      for (const [name, child] of Object.entries(node.children)) {
        const childPath = p === "/" ? "/" + name : p + "/" + name;
        await add(childPath, child, zipPath ? zipPath + "/" + name : name);
      }
    }
  }

  const node = getNode(path);
  if (!node) throw new Error("Path not found");
  const baseName = path === "/" ? "n3xn-export" : path.split("/").pop();
  await add(path, node, path === "/" ? "" : baseName);

  return zip.generateAsync({ type: "blob" });
}
