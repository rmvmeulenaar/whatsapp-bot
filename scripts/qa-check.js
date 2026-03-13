/**
 * qa-check.js — Offline quality verification against watch.db
 * Usage: node scripts/qa-check.js
 * Exit 0 = no HIGH severity issues
 * Exit 1 = HIGH severity issues found (print full report)
 */
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Set BOT_ROOT before importing db.js so it resolves the correct DB path
process.env.BOT_ROOT = process.env.BOT_ROOT ?? join(__dirname, "..");

import { db } from "../src/dashboard/db.js";

// ── Evaluator 1: Conversation Quality ───────────────────────────────────
function evaluateConversationQuality() {
  const issues = [];

  // BUG-04 regression: confidence strings must never reach proposed_reply
  const confLeaks = db.prepare(
    "SELECT COUNT(*) as cnt FROM watch_entries WHERE proposed_reply LIKE '%CONFIDENCE: %'"
  ).get();
  if (confLeaks.cnt > 0) {
    issues.push({ severity: "HIGH", message: `${confLeaks.cnt} proposed_reply rows contain confidence strings (BUG-04 regression)` });
  }

  // suggest_pending with null reply = bot offered to send but had nothing to say
  const nullSuggest = db.prepare(
    "SELECT COUNT(*) as cnt FROM watch_entries WHERE action = 'suggest_pending' AND proposed_reply IS NULL"
  ).get();
  if (nullSuggest.cnt > 0) {
    issues.push({ severity: "HIGH", message: `${nullSuggest.cnt} suggest_pending entries have null proposed_reply` });
  }

  // Very short replies (< 15 chars) that may be malformed
  const shortReplies = db.prepare(
    "SELECT COUNT(*) as cnt FROM watch_entries WHERE proposed_reply IS NOT NULL AND LENGTH(proposed_reply) < 15 AND action = 'suggest_pending'"
  ).get();
  if (shortReplies.cnt > 3) {
    issues.push({ severity: "MEDIUM", message: `${shortReplies.cnt} suggest_pending replies are suspiciously short (< 15 chars)` });
  }

  return { name: "ConversationQuality", passed: issues.filter(i => i.severity === "HIGH").length === 0, issues };
}

// ── Evaluator 2: Pipeline Correctness ───────────────────────────────────
function evaluatePipelineCorrectness() {
  const issues = [];

  // off_topic should route to watch_log_only — if it reaches suggest_pending that's BUG-07 regression
  const offTopicSuggest = db.prepare(
    "SELECT COUNT(*) as cnt FROM watch_entries WHERE node_trace LIKE '%off_topic%' AND action = 'suggest_pending'"
  ).get();
  if (offTopicSuggest.cnt > 0) {
    issues.push({ severity: "HIGH", message: `${offTopicSuggest.cnt} off_topic messages incorrectly reached suggest_pending (BUG-07 regression)` });
  }

  // Entries with latency > 15s — LLM timeout occurred, reply quality is likely degraded
  const highLatency = db.prepare(
    "SELECT COUNT(*) as cnt FROM watch_entries WHERE latency_ms > 15000"
  ).get();
  if (highLatency.cnt > 10) {
    issues.push({ severity: "MEDIUM", message: `${highLatency.cnt} entries have latency > 15000ms (LLM timeout rate elevated)` });
  }

  // Null proposed_reply for non-off_topic entries that reached suggest_pending
  const nullNonOffTopic = db.prepare(
    "SELECT COUNT(*) as cnt FROM watch_entries WHERE action = 'suggest_pending' AND proposed_reply IS NULL AND (node_trace NOT LIKE '%off_topic%' OR node_trace IS NULL)"
  ).get();
  if (nullNonOffTopic.cnt > 0) {
    issues.push({ severity: "HIGH", message: `${nullNonOffTopic.cnt} suggest_pending entries have null reply without off_topic path` });
  }

  return { name: "PipelineCorrectness", passed: issues.filter(i => i.severity === "HIGH").length === 0, issues };
}

// ── Evaluator 3: Coverage / Representativeness ──────────────────────────
function evaluateCoverage() {
  const issues = [];

  // Intent distribution — single intent > 80% may indicate classifier failure
  const intentDist = db.prepare(`
    SELECT intent, COUNT(*) as cnt, ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM watch_entries WHERE intent IS NOT NULL), 1) as pct
    FROM watch_entries
    WHERE intent IS NOT NULL
    GROUP BY intent
    ORDER BY cnt DESC
  `).all();
  const dominant = intentDist.find(r => r.pct > 80);
  if (dominant) {
    issues.push({ severity: "HIGH", message: `Intent "${dominant.intent}" is ${dominant.pct}% of all classified entries — possible classifier failure` });
  }

  // Safety fail rate > 5% indicates guardrail over-triggering
  const safetyStats = db.prepare(
    "SELECT SUM(CASE WHEN safety_pass = 0 THEN 1 ELSE 0 END) as fails, COUNT(*) as total FROM watch_entries"
  ).get();
  const failRate = safetyStats.total > 0 ? (safetyStats.fails / safetyStats.total) * 100 : 0;
  if (failRate > 5) {
    issues.push({ severity: "HIGH", message: `Safety fail rate is ${failRate.toFixed(1)}% (${safetyStats.fails}/${safetyStats.total}) — guardrail may be over-triggering` });
  }

  // Pending suggestions older than 48h (stale queue)
  const staleMs = 48 * 60 * 60 * 1000;
  const stalePending = db.prepare(
    `SELECT COUNT(*) as cnt FROM pending_suggestions WHERE status = 'pending' AND created_at < ?`
  ).get(Date.now() - staleMs);
  if (stalePending.cnt > 0) {
    issues.push({ severity: "MEDIUM", message: `${stalePending.cnt} pending suggestions are older than 48h — queue may be unmonitored` });
  }

  return { name: "Coverage", passed: issues.filter(i => i.severity === "HIGH").length === 0, issues };
}

// ── Evaluator 4: Dashboard UX HTTP Checks ───────────────────────────────
async function evaluateDashboardUX() {
  const issues = [];
  const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3001";
  const AUTH = process.env.DASHBOARD_BASIC_AUTH ?? "radiance:Radiance2026!";
  const authHeader = "Basic " + Buffer.from(AUTH).toString("base64");

  const checks = [
    { path: "/api/entries?limit=5", label: "GET /api/entries", expectArray: true },
    { path: "/api/pending", label: "GET /api/pending", expectArray: true },
    { path: "/api/conversations", label: "GET /api/conversations (DASH-04)", expectArray: true },
    { path: "/api/metrics/daily", label: "GET /api/metrics/daily (DASH-06)", expectArray: true },
  ];

  for (const check of checks) {
    try {
      const res = await fetch(BASE + check.path, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        issues.push({ severity: "HIGH", message: `${check.label} returned HTTP ${res.status}` });
        continue;
      }
      if (check.expectArray) {
        const data = await res.json();
        if (!Array.isArray(data)) {
          issues.push({ severity: "HIGH", message: `${check.label} did not return an array` });
        }
      }
    } catch (err) {
      issues.push({ severity: "HIGH", message: `${check.label} failed: ${err.message}` });
    }
  }

  // Verify /api/pending rows have context field (DASH-07)
  try {
    const res = await fetch(`${BASE}/api/pending`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const rows = await res.json();
      if (rows.length > 0 && !Object.hasOwn(rows[0], "context")) {
        issues.push({ severity: "HIGH", message: "/api/pending rows missing 'context' field (DASH-07 not implemented)" });
      }
    }
  } catch { /* already caught above */ }

  return { name: "DashboardUX", passed: issues.filter(i => i.severity === "HIGH").length === 0, issues };
}

// ── Evaluator 5: E2E Smoke (DB-only, no LLM call) ───────────────────────
function evaluateE2ESmoke() {
  const issues = [];

  // Verify bot has been processing messages recently (last 24h)
  const recentEntries = db.prepare(
    "SELECT COUNT(*) as cnt FROM watch_entries WHERE ts > datetime('now', '-24 hours')"
  ).get();
  if (recentEntries.cnt === 0) {
    issues.push({ severity: "MEDIUM", message: "No watch_entries in the last 24 hours — bot may be offline or not receiving messages" });
  }

  // Verify conversations table has rows (mode control is operational)
  const convRows = db.prepare("SELECT COUNT(*) as cnt FROM conversations").get();
  if (convRows.cnt === 0) {
    issues.push({ severity: "MEDIUM", message: "conversations table is empty — mode control never exercised" });
  }

  // Verify at least one booking intent entry exists (booking flow tested)
  const bookingEntries = db.prepare(
    "SELECT COUNT(*) as cnt FROM watch_entries WHERE intent LIKE '%booking%'"
  ).get();
  if (bookingEntries.cnt === 0) {
    issues.push({ severity: "MEDIUM", message: "No booking intent entries found — booking flow may be untested" });
  }

  // Verify pending_suggestions table is reachable
  const pendingCount = db.prepare("SELECT COUNT(*) as cnt FROM pending_suggestions").get();
  // Just ensuring the table exists and is queryable — any row count is fine
  if (typeof pendingCount.cnt !== "number") {
    issues.push({ severity: "HIGH", message: "pending_suggestions table is not queryable" });
  }

  return { name: "E2ESmoke", passed: issues.filter(i => i.severity === "HIGH").length === 0, issues };
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("QA Check — Molty WhatsApp Bot");
  console.log("================================");
  console.log(`DB: ${process.env.BOT_ROOT}/data/watch.db`);
  console.log("");

  const results = await Promise.all([
    evaluateConversationQuality(),
    evaluatePipelineCorrectness(),
    evaluateCoverage(),
    evaluateDashboardUX(),
    evaluateE2ESmoke(),
  ]);

  let highCount = 0;
  let mediumCount = 0;

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`[${status}] ${result.name}`);
    for (const issue of result.issues) {
      const prefix = issue.severity === "HIGH" ? "  [HIGH]   " : "  [MEDIUM] ";
      console.log(`${prefix}${issue.message}`);
      if (issue.severity === "HIGH") highCount++;
      else mediumCount++;
    }
  }

  console.log("");
  console.log(`Summary: ${highCount} HIGH, ${mediumCount} MEDIUM issues`);

  if (highCount > 0) {
    console.log("Exit 1 — HIGH severity issues found");
    process.exit(1);
  } else {
    console.log("Exit 0 — all checks passed (MEDIUM issues are informational)");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("QA script failed:", err);
  process.exit(1);
});
