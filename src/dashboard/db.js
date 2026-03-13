import Database from "better-sqlite3";
import { mkdirSync } from "fs";

const BOT_ROOT = process.env.BOT_ROOT || '/opt/whatsapp-bot';
const DB_PATH = process.env.DB_PATH ?? (BOT_ROOT + '/data/watch.db');
mkdirSync(BOT_ROOT + '/data', { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // Critical: concurrent write safety

db.exec(`
  CREATE TABLE IF NOT EXISTS watch_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TEXT NOT NULL,
    jid             TEXT NOT NULL,
    intent          TEXT,
    inbound         TEXT NOT NULL,
    classification  TEXT NOT NULL,
    knowledge_source TEXT,
    proposed_reply  TEXT,
    safety_pass     INTEGER NOT NULL DEFAULT 0,
    safety_reason   TEXT,
    safety_class    TEXT,
    model           TEXT,
    latency_ms      INTEGER,
    feedback        TEXT,
    correction      TEXT
  )
`);

// Add node_trace column if not exists (Phase 3 addition)
try {
  db.exec("ALTER TABLE watch_entries ADD COLUMN node_trace TEXT");
} catch { /* column already exists — ignore */ }

// === Phase 4: action column on watch_entries ===
try {
  db.exec(`ALTER TABLE watch_entries ADD COLUMN action TEXT DEFAULT 'watch_log_only'`);
} catch { /* column already exists — ignore */ }

export const insertEntry = db.prepare(`
  INSERT INTO watch_entries
    (ts, jid, intent, inbound, classification, knowledge_source, proposed_reply,
     safety_pass, safety_reason, safety_class, model, latency_ms, node_trace, action)
  VALUES
    (@ts, @jid, @intent, @inbound, @inbound_classification, @knowledge_source, @proposed_reply,
     @safety_pass, @safety_reason, @safety_classification, @model, @latency_ms, @node_trace, @action)
`);

export const getRecentEntries = db.prepare(
  `SELECT * FROM watch_entries ORDER BY id DESC LIMIT ?`
);

export const updateFeedback = db.prepare(
  `UPDATE watch_entries SET feedback = @feedback, correction = @correction WHERE id = @id`
);

// SSE subscribers for live dashboard updates
export const subscribers = new Set();

export function broadcastEntry(entry) {
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(data);
    } catch {
      subscribers.delete(res);
    }
  }
}

// === Phase 4: conversations table (per-JID mode control) ===
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    jid TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'watch',
    clinic TEXT,
    takeover_until INTEGER
  )
`);

export const getConversation = db.prepare(
  `SELECT mode, clinic, takeover_until FROM conversations WHERE jid = ?`
);

// === BUG-02: Takeover persistence — write/read takeover_until per JID ===
export const writeTakeoverUntil = db.prepare(
  `UPDATE conversations SET takeover_until = @takeover_until WHERE jid = @jid`
);

export const getTakeoverUntil = db.prepare(
  `SELECT takeover_until FROM conversations WHERE jid = ?`
);

export const upsertConversation = db.prepare(`
  INSERT INTO conversations (jid, mode, clinic, takeover_until)
  VALUES (@jid, @mode, @clinic, @takeover_until)
  ON CONFLICT(jid) DO UPDATE SET
    mode = excluded.mode,
    clinic = excluded.clinic,
    takeover_until = excluded.takeover_until
`);

export const setConversationMode = db.prepare(
  `INSERT INTO conversations (jid, mode) VALUES (@jid, @mode)
   ON CONFLICT(jid) DO UPDATE SET mode = excluded.mode`
);

// === Phase 5: pending_suggestions table ===
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_suggestions (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    jid                    TEXT NOT NULL,
    proposed_message       TEXT NOT NULL,
    inbound_message        TEXT NOT NULL,
    patient_name           TEXT,
    status                 TEXT NOT NULL DEFAULT 'pending',
    approved_by            INTEGER,
    edited_message         TEXT,
    created_at             INTEGER NOT NULL,
    telegram_msg_id_moumen INTEGER,
    telegram_msg_id_rogier INTEGER,
    watch_entry_id         INTEGER
  )
`);

// Startup recovery: reset any 'sending' rows left over from a previous crash
try {
  db.exec(`UPDATE pending_suggestions SET status = 'pending' WHERE status = 'sending'`);
} catch { /* table may not exist on first run */ }

// === Phase 5: prepared statements for pending_suggestions ===
const insertPending = db.prepare(`
  INSERT INTO pending_suggestions (jid, proposed_message, inbound_message, patient_name, status, created_at, sms_params)
  VALUES (@jid, @proposed_message, @inbound_message, @patient_name, 'pending', @created_at, @sms_params)
`);
const approvePending = db.prepare(`
  UPDATE pending_suggestions SET status = 'approved', approved_by = @approvedBy, edited_message = @editedMessage
  WHERE id = @id AND status = 'pending'
`);
const rejectPending = db.prepare(`
  UPDATE pending_suggestions SET status = 'rejected', approved_by = @approvedBy
  WHERE id = @id AND status = 'pending'
`);
const supersedePending = db.prepare(`
  UPDATE pending_suggestions SET status = 'superseded' WHERE id = @id AND status = 'pending'
`);
const getPending = db.prepare(`SELECT * FROM pending_suggestions WHERE id = ?`);
const getExistingPendingForJid = db.prepare(`
  SELECT id, telegram_msg_id_moumen, telegram_msg_id_rogier
  FROM pending_suggestions WHERE jid = ? AND status = 'pending' LIMIT 1
`);
const getAllPending = db.prepare(`
  SELECT * FROM pending_suggestions WHERE status = 'pending' ORDER BY created_at DESC
`);
const updateMoumenMsgId = db.prepare(`UPDATE pending_suggestions SET telegram_msg_id_moumen = @msgId WHERE id = @id`);
const updateRogierMsgId = db.prepare(`UPDATE pending_suggestions SET telegram_msg_id_rogier = @msgId WHERE id = @id`);
const getPendingForRecovery = db.prepare(`
  SELECT * FROM pending_suggestions WHERE status = 'pending' AND telegram_msg_id_rogier IS NULL
`);
const markTakenOver = db.prepare(`
  UPDATE pending_suggestions SET status = 'taken_over' WHERE jid = @jid AND status = 'pending'
`);
const getAllModes = db.prepare(`SELECT jid, mode FROM conversations WHERE mode != 'watch' ORDER BY mode`);

// === Phase 5 (fix): atomic claim-before-send to prevent double-send race ===
const claimPending = db.prepare(`
  UPDATE pending_suggestions SET status = 'sending' WHERE id = @id AND status = 'pending'
`);
const resetPendingClaim = db.prepare(`
  UPDATE pending_suggestions SET status = 'pending' WHERE id = @id AND status = 'sending'
`);
const finalizePendingApproval = db.prepare(`
  UPDATE pending_suggestions
  SET status = 'approved', approved_by = @approvedBy, edited_message = @editedMessage
  WHERE id = @id AND status = 'sending'
`);

// === Phase 5: export functions for pending_suggestions ===
export function insertPendingSuggestion({ jid, proposed_message, inbound_message, patient_name, watch_entry_id, sms_params }) {
  const result = insertPending.run({ jid, proposed_message, inbound_message, patient_name: patient_name ?? null, created_at: Date.now(), sms_params: sms_params ?? null });
  if (watch_entry_id) {
    db.prepare('UPDATE pending_suggestions SET watch_entry_id = ? WHERE id = ?').run(watch_entry_id, result.lastInsertRowid);
  }
  return Number(result.lastInsertRowid);
}
export function approveSuggestion(id, approvedBy, editedMessage = null) {
  const { changes } = approvePending.run({ id, approvedBy, editedMessage });
  return { ok: changes > 0 };
}
export function rejectSuggestion(id, approvedBy = 0) {
  const { changes } = rejectPending.run({ id, approvedBy });
  return { ok: changes > 0 };
}
export function supersedeSuggestion(id) {
  supersedePending.run({ id });
}
export function getPendingSuggestion(id) {
  return getPending.get(id);
}
export function getExistingPending(jid) {
  return getExistingPendingForJid.get(jid);
}
export function getAllPendingSuggestions() {
  return getAllPending.all();
}
export function setMoumenMsgId(id, msgId) {
  updateMoumenMsgId.run({ id, msgId });
}
export function setRogierMsgId(id, msgId) {
  updateRogierMsgId.run({ id, msgId });
}
export function getPendingForStartupRecovery() {
  return getPendingForRecovery.all();
}
export function markSuggestionTakenOver(jid) {
  const { changes } = markTakenOver.run({ jid });
  return { ok: changes > 0 };
}
export function getAllConversationModes() {
  return getAllModes.all();
}
export function claimSuggestion(id) {
  const { changes } = claimPending.run({ id });
  return { ok: changes > 0 };
}
export function resetSuggestionToPending(id) {
  resetPendingClaim.run({ id });
}
export function finalizeSuggestionApproval(id, approvedBy, editedMessage = null) {
  const { changes } = finalizePendingApproval.run({ id, approvedBy, editedMessage });
  return { ok: changes > 0 };
}

// === Fase 6: pending_bookings table (multi-turn booking flow) ===
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_bookings (
    jid        TEXT PRIMARY KEY,
    treatment  TEXT,
    step       TEXT NOT NULL DEFAULT 'asking_location',
    created_at INTEGER NOT NULL
  )
`);

const getPendingBookingStmt = db.prepare(`SELECT * FROM pending_bookings WHERE jid = @jid`);
const setPendingBookingStmt = db.prepare(`
  INSERT INTO pending_bookings (jid, treatment, step, created_at)
  VALUES (@jid, @treatment, @step, @createdAt)
  ON CONFLICT(jid) DO UPDATE SET treatment = @treatment, step = @step, created_at = @createdAt
`);
const clearPendingBookingStmt = db.prepare(`DELETE FROM pending_bookings WHERE jid = @jid`);

const BOOKING_TTL_MS = 30 * 60 * 1000; // 30 minuten

// BUG-03: Clean stale pending_bookings at startup (30 min TTL)
db.prepare(`DELETE FROM pending_bookings WHERE created_at < ?`).run(Date.now() - BOOKING_TTL_MS);

export function getPendingBooking(jid) {
  const row = getPendingBookingStmt.get({ jid });
  if (!row) return null;
  if (Date.now() - row.created_at > BOOKING_TTL_MS) {
    clearPendingBookingStmt.run({ jid });
    return null;
  }
  return row;
}

export function setPendingBooking(jid, treatment) {
  setPendingBookingStmt.run({ jid, treatment: treatment ?? null, step: 'asking_location', createdAt: Date.now() });
}

export function clearPendingBooking(jid) {
  clearPendingBookingStmt.run({ jid });
}

// === Phase 9: DASH-04..07 prepared statements ===

// DASH-04: list all JIDs with message metadata
export const getConversationList = db.prepare(`
  SELECT
    jid,
    COUNT(*) as message_count,
    MAX(ts) as last_message,
    MIN(ts) as first_message
  FROM watch_entries
  GROUP BY jid
  ORDER BY last_message DESC
  LIMIT 200
`);

// DASH-04: all messages for one JID (chat thread)
export const getConversationMessages = db.prepare(`
  SELECT id, ts, inbound, proposed_reply, action, intent, node_trace, latency_ms
  FROM watch_entries
  WHERE jid = ?
  ORDER BY ts ASC
`);

// DASH-05: all rows from conversations table (real JIDs + modes)
export const getConversationMode = db.prepare(`
  SELECT jid, mode, takeover_until FROM conversations ORDER BY jid
`);

// DASH-06: daily stats from watch_entries (ts is ISO string — use date(ts) directly)
export const getDailyWatchMetrics = db.prepare(`
  SELECT
    date(ts) as day,
    COUNT(*) as total_messages,
    ROUND(AVG(latency_ms)) as avg_latency_ms,
    SUM(CASE WHEN proposed_reply IS NOT NULL THEN 1 ELSE 0 END) as with_reply,
    SUM(CASE WHEN safety_pass = 0 THEN 1 ELSE 0 END) as safety_fails
  FROM watch_entries
  GROUP BY day
  ORDER BY day DESC
  LIMIT 7
`);

// DASH-06: daily approval stats from pending_suggestions
// NOTE: created_at is Unix milliseconds — use date(created_at / 1000, 'unixepoch')
export const getDailySuggestionMetrics = db.prepare(`
  SELECT
    date(created_at / 1000, 'unixepoch') as day,
    COUNT(*) as total_suggestions,
    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
  FROM pending_suggestions
  WHERE status IN ('approved', 'rejected', 'superseded', 'pending')
  GROUP BY day
  ORDER BY day DESC
  LIMIT 7
`);

// DASH-07: last 3 messages for a JID (for pending context enrichment)
export const getLastMessagesForJid = db.prepare(`
  SELECT inbound, proposed_reply, ts, action, intent
  FROM watch_entries
  WHERE jid = ?
  ORDER BY ts DESC
  LIMIT 3
`);

export { db };
