/**
 * Offline-friendly game / hub runners for n3xn.
 * Scripts prefer same-origin /__cdn__/ when SW is controlling the page.
 */

import * as fs from "./fs.js";
import { createBlobFromText } from "./runner.js";

function cdn(path) {
  // path like npm/kaboom@3000.0.0/dist/kaboom.js
  const controlled = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  if (controlled) return "/__cdn__/jsdelivr/" + path;
  return "https://cdn.jsdelivr.net/" + path;
}

function esm(path) {
  const controlled = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  if (controlled) return "/__cdn__/esm/" + path;
  return "https://esm.sh/" + path;
}

/** Rewrite common CDN imports in user HTML/JS to offline proxy when possible */
export function rewriteCdnImports(src) {
  let s = String(src || "");
  if (!(navigator.serviceWorker && navigator.serviceWorker.controller)) return s;
  s = s.replace(/https:\/\/cdn\.jsdelivr\.net\//g, "/__cdn__/jsdelivr/");
  s = s.replace(/https:\/\/esm\.sh\//g, "/__cdn__/esm/");
  s = s.replace(/https:\/\/cdnjs\.cloudflare\.com\//g, "/__cdn__/cdnjs/");
  return s;
}

const PACKS = {
  kaboom: {
    label: "Kaboom.js",
    scripts: [cdn("npm/kaboom@3000.1.17/dist/kaboom.js")],
    // also esm entry
    esm: esm("kaboom@3000.1.17"),
  },
  phaser: {
    label: "Phaser 3",
    scripts: [cdn("npm/phaser@3.80.1/dist/phaser.min.js")],
  },
  pixi: {
    label: "PixiJS",
    scripts: [cdn("npm/pixi.js@8.6.6/dist/pixi.min.js")],
  },
  three: {
    label: "Three.js",
    scripts: [cdn("npm/three@0.170.0/build/three.min.js")],
  },
  matter: {
    label: "Matter.js",
    scripts: [cdn("npm/matter-js@0.20.0/build/matter.min.js")],
  },
  p5: {
    label: "p5.js",
    scripts: [cdn("npm/p5@1.11.1/lib/p5.min.js")],
  },
};

export function listGamePacks() {
  return Object.keys(PACKS).map((id) => ({ id, label: PACKS[id].label }));
}

async function readEntry(path) {
  const f = await fs.readFile(path);
  if (!f) throw new Error("File not found: " + path);
  return f.text();
}

function wrapHtml({ title, scripts, bodyScript, bodyHtml }) {
  const tags = (scripts || [])
    .map((src) => `<script src="${src}"><\/script>`)
    .join("\n");
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title || "n3xn game"}</title>
<style>html,body{margin:0;height:100%;background:#0a0a0f;color:#e2e8f0;overflow:hidden}
canvas{display:block;margin:0 auto}</style>
${tags}
</head><body>
${bodyHtml || ""}
<script>
try {
${bodyScript || ""}
} catch (e) {
  document.body.innerHTML = '<pre style="padding:1rem;color:#f87171">'+String(e.stack||e)+'</pre>';
  console.error(e);
}
<\/script>
</body></html>`;
}

/**
 * Run user file with a game pack injected.
 * - .html: rewrite CDNs + inject missing pack scripts into head
 * - .js: wrap as body script after pack UMD globals
 */
export async function runGamePack(path, packId) {
  const pack = PACKS[packId];
  if (!pack) throw new Error("Unknown pack: " + packId + " (try kaboom|phaser|pixi|three|matter|p5)");

  const raw = rewriteCdnImports(await readEntry(path));
  const name = (path.split("/").pop() || "game").toLowerCase();
  let html;

  if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".n3-site")) {
    html = raw;
    // ensure pack scripts present
    for (const src of pack.scripts || []) {
      if (!html.includes(src) && !html.includes(packId)) {
        if (/<\/head>/i.test(html)) {
          html = html.replace(/<\/head>/i, `<script src="${src}"><\/script></head>`);
        } else {
          html = `<script src="${src}"><\/script>` + html;
        }
      }
    }
  } else {
    // treat as JS game script
    html = wrapHtml({
      title: pack.label + " — " + path,
      scripts: pack.scripts,
      bodyScript: raw,
    });
  }

  const { url } = createBlobFromText(html, "text/html", `${packId}:${path}`);
  window.open(url, "_blank", "noopener");
  return { url, pack: packId };
}

/** Auto: detect kaboom/phaser/pixi imports or filename */
export function detectGamePack(path, source) {
  const p = (path || "").toLowerCase();
  const s = (source || "").toLowerCase();
  if (p.includes("kaboom") || s.includes("kaboom")) return "kaboom";
  if (p.includes("phaser") || s.includes("phaser")) return "phaser";
  if (p.includes("pixi") || s.includes("pixi")) return "pixi";
  if (p.includes("three") || s.includes("three.")) return "three";
  if (p.includes("matter") || s.includes("matter.")) return "matter";
  if (p.includes("p5") || /\bp5\s*\(/.test(s) || s.includes("function setup")) return "p5";
  return null;
}

export async function runGameAuto(path) {
  const src = await readEntry(path);
  const pack = detectGamePack(path, src) || "kaboom";
  return runGamePack(path, pack);
}
