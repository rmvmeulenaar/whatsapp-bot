const HISTORY_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_TURNS = 10; // 10 exchanges = 20 messages
const histories = new Map();

export function getHistory(jid) {
  const entry = histories.get(jid);
  if (!entry) return [];
  if (Date.now() - entry.lastActivity > HISTORY_TTL_MS) {
    histories.delete(jid);
    return [];
  }
  return entry.messages.slice(-MAX_TURNS * 2);
}

export function appendHistory(jid, role, content) {
  const entry = histories.get(jid) ?? { messages: [], lastActivity: 0 };
  entry.messages.push({ role, content });
  entry.lastActivity = Date.now();
  if (entry.messages.length > MAX_TURNS * 2 + 4) {
    entry.messages = entry.messages.slice(-MAX_TURNS * 2);
  }
  histories.set(jid, entry);
}

// Cleanup every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [jid, entry] of histories) {
    if (now - entry.lastActivity > HISTORY_TTL_MS) histories.delete(jid);
  }
}, 30 * 60 * 1000).unref();
