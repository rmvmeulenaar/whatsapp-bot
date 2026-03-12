import { logEvent } from "../logging/logger.js";
import { maskPhone } from "../integrations/clinicminds.js";
import { writeTakeoverUntil, getTakeoverUntil } from "../dashboard/db.js";

const humanTakeover = new Map(); // jid → timestamp
const TAKEOVER_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function setTakeover(jid) {
  humanTakeover.set(jid, Date.now());
  try {
    writeTakeoverUntil.run({ jid, takeover_until: Date.now() + TAKEOVER_TTL_MS });
  } catch (e) {
    console.error("[takeover] DB write failed:", e.message);
  }
  try {
    logEvent({ type: "human_takeover_set", jid: maskPhone(jid), ttl_ms: TAKEOVER_TTL_MS });
  } catch {
    // Non-critical — don't fail if logger unavailable
  }
}

export function isInTakeover(jid) {
  const t = humanTakeover.get(jid);
  if (t && Date.now() - t <= TAKEOVER_TTL_MS) return true;
  // Cache miss (post-restart): check DB
  const row = getTakeoverUntil.get(jid);
  if (row?.takeover_until && row.takeover_until > Date.now()) {
    humanTakeover.set(jid, row.takeover_until - TAKEOVER_TTL_MS);
    return true;
  }
  return false;
}

export function clearTakeover(jid) {
  humanTakeover.delete(jid);
}

// Cleanup expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jid, t] of humanTakeover) {
    if (now - t > TAKEOVER_TTL_MS) humanTakeover.delete(jid);
  }
}, 10 * 60 * 1000).unref();
