/**
 * n3xn VFS v2 — GitHub integration (classic PAT)
 * Separate "GitHub VFS" namespace: gh:/owner/repo/...
 * Local cache via storage backends; commit / push / PR / issues / etc.
 */

import * as db from "./db.js";
import * as storage from "./storage-backends.js";
import { toBase64, fromBase64 } from "./crypto.js";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

let token = null;
let user = null;
let logFn = (m, c) => console.log(m);
let currentRepo = null; // { owner, repo, branch, sha? }

export function setLogger(fn) {
  logFn = fn || logFn;
}
function log(msg, cls = "out") {
  logFn(String(msg), cls);
}

export function isAuthed() {
  return !!token;
}
export function getUser() {
  return user;
}
export function getCurrentRepo() {
  return currentRepo;
}

/* ========== Auth (classic PAT, encrypted at rest) ========== */

export async function setToken(classicToken) {
  if (!classicToken || !classicToken.trim()) throw new Error("Token required");
  token = classicToken.trim();
  user = await api("GET", "/user");
  const pass = db.getPassword();
  if (pass) {
    await storage.setSecret("github_pat", { token, login: user.login }, pass);
  }
  try {
    localStorage.setItem("n3xn_gh_login", user.login);
  } catch (_) {}
  log(`GitHub: signed in as ${user.login}`, "ok");
  return user;
}

export async function loadSavedToken() {
  const pass = db.getPassword();
  if (!pass) return null;
  try {
    const sec = await storage.getSecret("github_pat", pass);
    if (sec?.token) {
      token = sec.token;
      user = await api("GET", "/user");
      return user;
    }
  } catch (e) {
    log("Saved GitHub token unlock failed: " + e.message, "err");
  }
  return null;
}

export async function clearToken() {
  token = null;
  user = null;
  currentRepo = null;
  try {
    await storage.deleteSecret("github_pat");
  } catch (_) {}
  log("GitHub token cleared", "out");
}

async function api(method, path, body, opts = {}) {
  if (!token) throw new Error("Not authenticated — gh auth <token>");
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body !== undefined && !(body instanceof Uint8Array) && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(API + path, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : typeof body === "string" || body instanceof Uint8Array
          ? body
          : JSON.stringify(body),
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.message || res.statusText || String(res.status);
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return data;
}

/* ========== Repos ========== */

export async function listRepos(type = "owner") {
  // paginate lightly
  const out = [];
  let page = 1;
  while (page <= 5) {
    const batch = await api("GET", `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return out;
}

export async function getRepo(owner, repo) {
  return api("GET", `/repos/${owner}/${repo}`);
}

export async function createRepo(name, opts = {}) {
  return api("POST", "/user/repos", {
    name,
    private: !!opts.private,
    description: opts.description || "Managed by n3xn VFS",
    auto_init: opts.auto_init !== false,
  });
}

export async function listBranches(owner, repo) {
  return api("GET", `/repos/${owner}/${repo}/branches?per_page=100`);
}

export async function setRepo(owner, repo, branch) {
  const info = await getRepo(owner, repo);
  const br = branch || info.default_branch || "main";
  const ref = await api("GET", `/repos/${owner}/${repo}/git/ref/heads/${br}`).catch(() => null);
  currentRepo = {
    owner,
    repo,
    branch: br,
    default_branch: info.default_branch,
    sha: ref?.object?.sha || null,
    full_name: info.full_name,
  };
  await db.setMeta("github_current_repo", currentRepo).catch(() => {});
  log(`Repo: ${owner}/${repo}@${br}`, "ok");
  return currentRepo;
}

/* ========== Tree / contents ========== */

export async function getContents(owner, repo, path = "", ref) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const p = path ? `/${path.replace(/^\//, "")}` : "";
  return api("GET", `/repos/${owner}/${repo}/contents${p}${q}`);
}

export async function getTree(owner, repo, branch, recursive = true) {
  const ref = await api("GET", `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const sha = ref.object.sha;
  const tree = await api(
    "GET",
    `/repos/${owner}/${repo}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`
  );
  return { sha, tree: tree.tree || [] };
}

export async function readRemoteFile(owner, repo, path, ref) {
  const data = await getContents(owner, repo, path, ref);
  if (Array.isArray(data)) throw new Error("Path is a directory");
  if (data.encoding === "base64" && data.content) {
    const bin = fromBase64(data.content.replace(/\n/g, ""));
    return { path, content: bin, sha: data.sha, size: data.size, encoding: "base64" };
  }
  // large files API
  if (data.download_url) {
    const res = await fetch(data.download_url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw" },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { path, content: buf, sha: data.sha, size: buf.length };
  }
  throw new Error("Cannot read file");
}

/* ========== Local GitHub VFS cache  gh:/owner/repo/path ========== */

function cachePath(owner, repo, path) {
  const p = path.replace(/^\//, "");
  return `/gh/${owner}/${repo}/${p}`;
}

export function parseGhPath(p) {
  // gh:owner/repo/path or /gh/owner/repo/path
  let s = p.replace(/^gh:/, "").replace(/^\/gh\//, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Path must be owner/repo/...");
  return { owner: parts[0], repo: parts[1], path: parts.slice(2).join("/") };
}

export async function pullFile(owner, repo, path, branch) {
  const f = await readRemoteFile(owner, repo, path, branch);
  const local = cachePath(owner, repo, path);
  const be = storage.getBackend();
  await be.put(local, f.content, {
    mime: guessMime(path),
    gh_sha: f.sha,
    gh_owner: owner,
    gh_repo: repo,
  });
  // also mirror into encrypted IDB namespace for export compatibility
  if (be.id !== "idb") {
    try {
      await db.putFile(local, f.content, { mime: guessMime(path), gh_sha: f.sha });
    } catch (_) {}
  }
  return local;
}

export async function pullTree(owner, repo, branch, { maxFiles = 500 } = {}) {
  const { tree } = await getTree(owner, repo, branch, true);
  const files = tree.filter((t) => t.type === "blob").slice(0, maxFiles);
  log(`Pulling ${files.length} files from ${owner}/${repo}@${branch}…`, "out");
  let n = 0;
  for (const t of files) {
    try {
      await pullFile(owner, repo, t.path, branch);
      n++;
    } catch (e) {
      log(`skip ${t.path}: ${e.message}`, "err");
    }
  }
  log(`Pulled ${n} files → /gh/${owner}/${repo}/`, "ok");
  return n;
}

export async function readLocalGh(owner, repo, path) {
  const local = cachePath(owner, repo, path);
  const be = storage.getBackend();
  let f = await be.get(local);
  if (!f) {
    try {
      f = await db.getFile(local);
    } catch (_) {}
  }
  return f;
}

export async function writeLocalGh(owner, repo, path, content, mime) {
  const local = cachePath(owner, repo, path);
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content);
  const be = storage.getBackend();
  await be.put(local, bytes, { mime: mime || guessMime(path) });
  if (be.id !== "idb") {
    try {
      await db.putFile(local, bytes, { mime: mime || guessMime(path) });
    } catch (_) {}
  }
  return local;
}

/* ========== Commit + push (Contents API for single file; Git Data API for multi) ========== */

export async function commitFile(owner, repo, path, content, message, branch) {
  const br = branch || currentRepo?.branch || "main";
  let sha;
  try {
    const existing = await getContents(owner, repo, path, br);
    if (!Array.isArray(existing)) sha = existing.sha;
  } catch (_) {}
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content);
  const body = {
    message: message || `Update ${path} via n3xn VFS`,
    content: toBase64(bytes),
    branch: br,
  };
  if (sha) body.sha = sha;
  const res = await api("PUT", `/repos/${owner}/${repo}/contents/${path.replace(/^\//, "")}`, body);
  log(`Committed ${path} → ${res.commit?.sha?.slice(0, 7) || "ok"}`, "ok");
  return res;
}

/** Multi-file commit via Git Data API */
export async function commitFiles(owner, repo, changes, message, branch) {
  // changes: [{ path, content: string|Uint8Array }]
  const br = branch || currentRepo?.branch || "main";
  const ref = await api("GET", `/repos/${owner}/${repo}/git/ref/heads/${br}`);
  const latestCommitSha = ref.object.sha;
  const baseCommit = await api("GET", `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`);
  const baseTree = baseCommit.tree.sha;

  const treeItems = [];
  for (const ch of changes) {
    const bytes =
      typeof ch.content === "string"
        ? new TextEncoder().encode(ch.content)
        : new Uint8Array(ch.content);
    const blob = await api("POST", `/repos/${owner}/${repo}/git/blobs`, {
      content: toBase64(bytes),
      encoding: "base64",
    });
    treeItems.push({
      path: ch.path.replace(/^\//, ""),
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const newTree = await api("POST", `/repos/${owner}/${repo}/git/trees`, {
    base_tree: baseTree,
    tree: treeItems,
  });
  const newCommit = await api("POST", `/repos/${owner}/${repo}/git/commits`, {
    message: message || "n3xn VFS commit",
    tree: newTree.sha,
    parents: [latestCommitSha],
  });
  await api("PATCH", `/repos/${owner}/${repo}/git/refs/heads/${br}`, {
    sha: newCommit.sha,
    force: false,
  });
  log(`Commit ${newCommit.sha.slice(0, 7)} (${changes.length} files)`, "ok");
  return newCommit;
}

export async function pushLocalChanges(owner, repo, paths, message, branch) {
  const changes = [];
  for (const path of paths) {
    const f = await readLocalGh(owner, repo, path);
    if (!f) throw new Error("Local missing: " + path);
    changes.push({ path, content: f.content });
  }
  return commitFiles(owner, repo, changes, message, branch);
}

/* ========== Branches / PRs / Issues / Gists / Actions hooks ========== */

export async function createBranch(owner, repo, name, fromBranch) {
  const from = fromBranch || currentRepo?.branch || "main";
  const ref = await api("GET", `/repos/${owner}/${repo}/git/ref/heads/${from}`);
  return api("POST", `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${name}`,
    sha: ref.object.sha,
  });
}

export async function listPulls(owner, repo, state = "open") {
  return api("GET", `/repos/${owner}/${repo}/pulls?state=${state}&per_page=50`);
}

export async function createPull(owner, repo, title, head, base, body = "") {
  return api("POST", `/repos/${owner}/${repo}/pulls`, { title, head, base, body });
}

export async function listIssues(owner, repo, state = "open") {
  return api("GET", `/repos/${owner}/${repo}/issues?state=${state}&per_page=50`);
}

export async function createIssue(owner, repo, title, body = "") {
  return api("POST", `/repos/${owner}/${repo}/issues`, { title, body });
}

export async function listGists() {
  return api("GET", "/gists?per_page=50");
}

export async function createGist(files, description = "", isPublic = false) {
  // files: { "a.js": { content: "..." } }
  return api("POST", "/gists", { files, description, public: isPublic });
}

export async function starRepo(owner, repo) {
  await api("PUT", `/user/starred/${owner}/${repo}`, "");
  log(`Starred ${owner}/${repo}`, "ok");
}

export async function searchCode(q) {
  return api("GET", `/search/code?q=${encodeURIComponent(q)}`);
}

export async function searchRepos(q) {
  return api("GET", `/search/repositories?q=${encodeURIComponent(q)}`);
}

export async function rateLimit() {
  return api("GET", "/rate_limit");
}

export async function deleteRemoteFile(owner, repo, path, message, branch) {
  const br = branch || currentRepo?.branch || "main";
  const existing = await getContents(owner, repo, path, br);
  if (Array.isArray(existing)) throw new Error("Path is a directory");
  return api("DELETE", `/repos/${owner}/${repo}/contents/${path.replace(/^\//, "")}`, {
    message: message || `Delete ${path} via n3xn`,
    sha: existing.sha,
    branch: br,
  });
}

function guessMime(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  const map = {
    js: "text/javascript",
    ts: "text/typescript",
    json: "application/json",
    md: "text/markdown",
    html: "text/html",
    css: "text/css",
    py: "text/x-python",
    png: "image/png",
    jpg: "image/jpeg",
    svg: "image/svg+xml",
  };
  return map[ext] || "application/octet-stream";
}

/* ========== Help text ========== */

export function tokenHelp() {
  return `
GitHub classic PAT setup (n3xn)

1) Create a token
   • github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)
   • Generate new token (classic)
   • Note: store it once; GitHub will not show it again

2) Recommended scopes (classic)
   • repo              — full private/public repo read/write, commits, PRs
   • workflow          — if you need Actions workflow files
   • gist              — create/list gists
   • read:org          — list org repos (if needed)
   • read:user / user:email — profile
   For "replace GitHub web editor" use at least: repo, gist, workflow

3) Safety
   • Token is encrypted with your n3xn account password (IndexedDB meta)
   • Never paste tokens into public collab rooms or screenshares
   • Revoke at github.com if leaked
   • Prefer fine-grained tokens later; this client targets classic PATs

4) n3xn commands
   gh auth <token>
   gh whoami | gh logout | gh rate
   gh repos | gh use owner/repo [branch]
   gh pull [path] | gh pull-tree
   gh commit <path> [message] | gh push-paths a b c -m "msg"
   gh branch <name> | gh prs | gh pr <title> <head> <base>
   gh issues | gh issue <title>
   gh gist <file> | gh search <query>
   gh storage idb|opfs|cache|memory

GitHub VFS paths cache under /gh/owner/repo/... and are included in encrypted FS export when stored in IndexedDB.
`.trim();
}
