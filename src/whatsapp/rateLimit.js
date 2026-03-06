const WINDOW_MS = 60 * 1000; // 1 minute sliding window
const MAX_PER_WINDOW = 5;
const rateLimits = new Map(); // jid → { count, windowStart }

export function checkRateLimit(jid) {
  const now = Date.now();
  const entry = rateLimits.get(jid) ?? { count: 0, windowStart: now };

  // Reset if window expired
  if (now - entry.windowStart > WINDOW_MS) {
    const newEntry = { count: 1, windowStart: now };
    rateLimits.set(jid, newEntry);
    return { allowed: true };
  }

  if (entry.count >= MAX_PER_WINDOW) {
    return { allowed: false, reason: "rate_limited" };
  }

  entry.count++;
  rateLimits.set(jid, entry);
  return { allowed: true };
}

// Cleanup expired windows every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jid, entry] of rateLimits) {
    if (now - entry.windowStart > WINDOW_MS * 5) rateLimits.delete(jid);
  }
}, 10 * 60 * 1000).unref();
