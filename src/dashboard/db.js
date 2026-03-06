import Database from "better-sqlite3";
import { mkdirSync } from "fs";

const DB_PATH = process.env.DB_PATH ?? "/opt/whatsapp-bot/data/watch.db";
mkdirSync("/opt/whatsapp-bot/data", { recursive: true });

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

// === Phase 5: prepared statements for pending_suggestions ===
const insertPending = db.prepare(`
  INSERT INTO pending_suggestions (jid, proposed_message, inbound_message, patient_name, status, created_at)
  VALUES (@jid, @proposed_message, @inbound_message, @patient_name, 'pending', @created_at)
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

// === Phase 5: export functions for pending_suggestions ===
export function insertPendingSuggestion({ jid, proposed_message, inbound_message, patient_name, watch_entry_id }) {
  const result = insertPending.run({ jid, proposed_message, inbound_message, patient_name: patient_name ?? null, created_at: Date.now() });
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

export { db };
