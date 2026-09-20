/**
 * n3xn — performance / device / storage diagnostics
 */

import * as storage from "./storage-backends.js";
import * as db from "./db.js";

export async function collectReport() {
  const report = {
    time: new Date().toISOString(),
    memory: null,
    storage: null,
    device: {},
    connection: null,
    n3xn: {},
  };

  // Memory (Chrome)
  const mem = performance.memory || null;
  if (mem) {
    report.memory = {
      jsHeapUsedMB: +(mem.usedJSHeapSize / 1048576).toFixed(2),
      jsHeapTotalMB: +(mem.totalJSHeapSize / 1048576).toFixed(2),
      jsHeapLimitMB: +(mem.jsHeapSizeLimit / 1048576).toFixed(2),
    };
  } else if (navigator.deviceMemory) {
    report.memory = { deviceMemoryGB: navigator.deviceMemory };
  }

  // Storage estimate
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      report.storage = {
        usageMB: +((est.usage || 0) / 1048576).toFixed(2),
        quotaMB: +((est.quota || 0) / 1048576).toFixed(2),
        usagePct: est.quota ? +(((est.usage || 0) / est.quota) * 100).toFixed(2) : null,
        persisted: navigator.storage.persisted ? await navigator.storage.persisted() : null,
      };
    }
  } catch (e) {
    report.storage = { error: e.message };
  }

  report.device = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: navigator.deviceMemory || null,
    maxTouchPoints: navigator.maxTouchPoints,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
  };

  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c) {
      report.connection = {
        effectiveType: c.effectiveType,
        downlink: c.downlink,
        rtt: c.rtt,
        saveData: c.saveData,
      };
    }
  } catch {}

  report.n3xn = {
    user: db.getCurrentUser?.() || null,
    storageBackend: storage.getBackendId(),
    backends: storage.listBackends().map((b) => b.id),
  };

  // Timing
  try {
    const nav = performance.getEntriesByType?.("navigation")?.[0];
    if (nav) {
      report.navigation = {
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadEventMs: Math.round(nav.loadEventEnd),
      };
    }
  } catch {}

  return report;
}

export function formatReport(r) {
  const lines = [];
  lines.push("N3XN PERFORMANCE");
  lines.push("────────────────────────");
  if (r.memory) {
    lines.push("Memory:");
    Object.entries(r.memory).forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
  } else {
    lines.push("Memory: (not exposed in this browser)");
  }
  if (r.storage) {
    lines.push("Storage quota:");
    Object.entries(r.storage).forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
  }
  lines.push("Device:");
  lines.push(`  cores: ${r.device.hardwareConcurrency}`);
  lines.push(`  deviceMemoryGB: ${r.device.deviceMemoryGB ?? "n/a"}`);
  lines.push(`  viewport: ${r.device.viewport} @${r.device.dpr}x`);
  lines.push(`  online: ${r.device.onLine}`);
  if (r.connection) {
    lines.push("Network:");
    Object.entries(r.connection).forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
  }
  lines.push("n3xn:");
  Object.entries(r.n3xn).forEach(([k, v]) => lines.push(`  ${k}: ${JSON.stringify(v)}`));
  return lines.join("\n");
}
