#!/usr/bin/env node
// Molty Dashboard Smoke Test
// Tests: API health, display_name, JID format, DB state
// Usage: node /opt/whatsapp-bot/test/smoke-test.js

import Database from "better-sqlite3";
import { mkdirSync } from "fs";

const BASE_URL = "http://localhost:3001";
const DB_PATH = process.env.DB_PATH ?? "/opt/whatsapp-bot/data/watch.db";

let passed = 0;
let failed = 0;
const results = [];

function log(status, test, detail = "") {
  const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "ℹ️ ";
  const line = `${icon} [${status}] ${test}${detail ? " — " + detail : ""}`;
  console.log(line);
  results.push({ status, test, detail });
  if (status === "PASS") passed++;
  if (status === "FAIL") failed++;
}

function info(msg) { log("INFO", msg); }

// ─── 1. DB checks ────────────────────────────────────────────────────────────
info("=== DATABASE CHECKS ===");
try {
  const db = new Database(DB_PATH, { readonly: true });

  // Check watch_entries count
  const totalEntries = db.prepare("SELECT COUNT(*) as n FROM watch_entries").get();
  info(`watch_entries: ${totalEntries.n} rows`);

  // Check for masked JIDs (old format: contains ***)
  const maskedCount = db.prepare("SELECT COUNT(*) as n FROM watch_entries WHERE jid LIKE '%***%'").get();
  log(maskedCount.n === 0 ? "PASS" : "INFO", "No masked JIDs in watch_entries",
    maskedCount.n > 0 ? `${maskedCount.n} legacy masked entries exist (expected — from before fix)` : "All JIDs are full");

  // Check recent entries (last 5) for JID format
  const recent = db.prepare("SELECT id, jid, ts FROM watch_entries ORDER BY id DESC LIMIT 5").all();
  const recentMasked = recent.filter(r => r.jid.includes("***"));
  if (recent.length > 0) {
    log(recentMasked.length === 0 ? "PASS" : "FAIL", "Recent watch_entries have unmasked JIDs",
      recentMasked.length > 0 ? `${recentMasked.length} of last 5 still masked: ${recentMasked.map(r=>r.jid).join(", ")}` : `Sample: ${recent[0]?.jid}`);
  } else {
    info("No watch_entries yet — can't verify JID format of new entries");
  }

  // Check pending_suggestions
  const pending = db.prepare("SELECT COUNT(*) as n FROM pending_suggestions WHERE status='pending'").get();
  info(`pending_suggestions (active): ${pending.n}`);

  // Check conversations table (real JIDs)
  const convCount = db.prepare("SELECT COUNT(*) as n FROM conversations").get();
  const convSample = db.prepare("SELECT jid, mode FROM conversations LIMIT 3").all();
  info(`conversations table: ${convCount.n} entries`);
  if (convSample.length > 0) info(`Sample conversations: ${convSample.map(c => c.jid + ' (' + c.mode + ')').join(", ")}`);

  db.close();
} catch (err) {
  log("FAIL", "Database access", err.message);
}

// ─── 2. API health checks ────────────────────────────────────────────────────
info("\n=== API HEALTH CHECKS ===");

async function testEndpoint(path, checks = []) {
  try {
    const res = await fetch(BASE_URL + path, {
      headers: { "Cookie": "molty_session=skip_for_test" }, // will get redirected to login
    });

    // We expect either 200 (if no auth) or 302 (redirect to login)
    if (res.status === 302 || res.url?.includes("/login")) {
      log("INFO", `GET ${path}`, "Auth required (expected if Google OAuth configured)");
      return null;
    }
    if (!res.ok) {
      log("FAIL", `GET ${path}`, `HTTP ${res.status}`);
      return null;
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      log("INFO", `GET ${path}`, `Returns HTML (${res.status})`);
      return null;
    }

    const data = await res.json();
    log("PASS", `GET ${path}`, `${res.status} OK, ${Array.isArray(data) ? data.length + " items" : "object"}`);

    for (const check of checks) {
      check(data, path);
    }
    return data;
  } catch (err) {
    log("FAIL", `GET ${path}`, err.message);
    return null;
  }
}

// Check display_name is present in array responses
function checkDisplayName(data, path) {
  if (!Array.isArray(data) || data.length === 0) {
    info(`  ${path}: empty response — can't check display_name`);
    return;
  }
  const withName = data.filter(d => d.display_name !== null && d.display_name !== undefined);
  const withNonNull = data.filter(d => d.display_name);
  log(
    "display_name" in data[0] ? "PASS" : "FAIL",
    `  ${path}: display_name field present`,
    `${withNonNull.length}/${data.length} have a name`
  );
}

// Check JIDs in response are not masked
function checkUnmaskedJids(data, path) {
  if (!Array.isArray(data) || data.length === 0) return;
  const masked = data.filter(d => d.jid?.includes("***"));
  log(
    masked.length === 0 ? "PASS" : "FAIL",
    `  ${path}: No masked JIDs in response`,
    masked.length > 0 ? `${masked.length} masked: ${masked.slice(0,2).map(d=>d.jid).join(", ")}` : "All clean"
  );
}

await testEndpoint("/api/entries?limit=10", [checkDisplayName, checkUnmaskedJids]);
await testEndpoint("/api/conversations", [checkDisplayName, checkUnmaskedJids]);
await testEndpoint("/api/pending", [checkDisplayName]);
await testEndpoint("/api/metrics/daily");

// ─── 3. PM2 process check ───────────────────────────────────────────────────
info("\n=== PROCESS CHECKS ===");
import { execSync } from "child_process";
try {
  const pm2Out = execSync("pm2 jlist 2>/dev/null", { encoding: "utf8" });
  const procs = JSON.parse(pm2Out);
  const bot = procs.find(p => p.name === "whatsapp-bot");
  if (!bot) {
    log("FAIL", "PM2: whatsapp-bot process", "Not found");
  } else {
    log(bot.pm2_env?.status === "online" ? "PASS" : "FAIL",
      "PM2: whatsapp-bot status",
      `${bot.pm2_env?.status} | restarts: ${bot.pm2_env?.restart_time} | uptime: ${Math.round((Date.now() - bot.pm2_env?.pm_uptime)/1000)}s`);
  }
} catch (err) {
  log("FAIL", "PM2 check", err.message);
}

// ─── 4. Summary ─────────────────────────────────────────────────────────────
console.log("\n=== SUMMARY ===");
console.log(`✅ PASSED: ${passed}`);
console.log(`❌ FAILED: ${failed}`);
console.log(`ℹ️  TOTAL:  ${passed + failed}`);
if (failed > 0) {
  console.log("\nFailed tests:");
  results.filter(r => r.status === "FAIL").forEach(r => console.log(`  ❌ ${r.test} — ${r.detail}`));
  process.exit(1);
} else {
  console.log("\nAll tests passed 🎉");
}
