
/**
 * Load Monaco Monarch language defs from /n3xn-lang-highlights.js
 * Expected export shapes (any one):
 *   export default [ { id, extensions, aliases?, tokens / monarch / language } ]
 *   export const languages = [ ... ]
 *   window.__n3xnLangHighlights = [ ... ]  (script without modules)
 */

/** @type {Map<string, string>} ext (no dot, lower) → language id */
const customExtMap = new Map();

/** @type {Set<string>} */
const registeredIds = new Set();

export function getCustomLanguageId(path) {
  const base = (path || "").split("/").pop() || "";
  const lower = base.toLowerCase();
  if (!lower.includes(".")) return null;
  // longest multi-part extension wins (e.g. .n3.site)
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join(".");
    if (customExtMap.has(ext)) return customExtMap.get(ext);
  }
  const ext = parts.pop();
  return customExtMap.get(ext) || null;
}

export function listCustomLanguages() {
  return [...registeredIds];
}

function normalizeDef(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.languageId || raw.name || "").trim();
  if (!id) return null;
  const extensions = (raw.extensions || raw.ext || [])
    .map((e) => String(e).replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  const aliases = raw.aliases || raw.alias || [];
  const tokens =
    raw.tokens ||
    raw.monarch ||
    raw.tokenizer ||
    raw.language ||
    raw.monarchTokensProvider ||
    null;
  return { id, extensions, aliases, tokens, conf: raw.conf || raw.configuration || null };
}

async function fetchModuleDefs() {
  // ES module (preferred)
  try {
    const mod = await import(
      /* @vite-ignore */
      "/n3xn-lang-highlights.js?t=" + Date.now()
    );
    const arr =
      mod.default ||
      mod.languages ||
      mod.langHighlights ||
      mod.highlights ||
      null;
    if (Array.isArray(arr)) return arr;
    if (arr && typeof arr === "object") return [arr];
  } catch (_) {
    /* try classic script / global */
  }

  // Classic script → window.__n3xnLangHighlights
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/n3xn-lang-highlights.js?t=" + Date.now();
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("script load failed"));
      document.head.appendChild(s);
    });
    const g =
      window.__n3xnLangHighlights ||
      window.n3xnLangHighlights ||
      window.__N3XN_LANG_HIGHLIGHTS__;
    if (Array.isArray(g)) return g;
  } catch (_) {}

  return null;
}

/**
 * Register all custom languages with Monaco. Safe if file missing.
 * @param {typeof monaco} monacoApi
 * @param {{ log?: (msg: string, cls?: string) => void }} opts
 */
export async function loadCustomLanguages(monacoApi, opts = {}) {
  const log =
    opts.log ||
    ((msg) => {
      try {
        console.info(msg);
      } catch (_) {}
    });

  if (!monacoApi?.languages) {
    log("[n3xn] No custom language definitions loaded (monaco missing)", "out");
    return { ok: false, count: 0 };
  }

  let defs;
  try {
    defs = await fetchModuleDefs();
  } catch (e) {
    log("[n3xn] No custom language definitions loaded", "out");
    return { ok: false, count: 0 };
  }

  if (!defs || !defs.length) {
    log("[n3xn] No custom language definitions loaded", "out");
    return { ok: false, count: 0 };
  }

  let count = 0;
  for (const raw of defs) {
    const def = normalizeDef(raw);
    if (!def) continue;
    try {
      if (!registeredIds.has(def.id)) {
        monacoApi.languages.register({
          id: def.id,
          extensions: def.extensions.map((e) => (e.startsWith(".") ? e : "." + e)),
          aliases: Array.isArray(def.aliases) ? def.aliases : undefined,
        });
        registeredIds.add(def.id);
      }
      if (def.tokens && typeof def.tokens === "object") {
        monacoApi.languages.setMonarchTokensProvider(def.id, def.tokens);
      }
      if (def.conf && typeof def.conf === "object" && monacoApi.languages.setLanguageConfiguration) {
        try {
          monacoApi.languages.setLanguageConfiguration(def.id, def.conf);
        } catch (_) {}
      }
      for (const ext of def.extensions) {
        customExtMap.set(ext, def.id);
      }
      count++;
    } catch (err) {
      log("[n3xn] custom lang failed: " + def.id + " — " + (err.message || err), "err");
    }
  }

  log(`[n3xn] Loaded ${count} custom language definition(s)`, "ok");
  return { ok: true, count };
}

// Sync resolver for detectLanguage (editor.js)
if (typeof window !== "undefined") {
  window.__n3xnGetCustomLangId = getCustomLanguageId;
}
