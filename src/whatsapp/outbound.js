import { logEvent } from '../logging/logger.js';
import { maskPhone } from '../integrations/clinicminds.js';
import { setConversationMode } from '../dashboard/db.js';

// Per-JID outbound rate limiting (separate from inbound rateLimit.js)
const lastSent = new Map();
const MIN_GAP_MS = 3000;

/**
 * Box-Muller Gaussian delay for human-like typing simulation.
 * Mean 3s, SD 0.8s, clamped to 1.4s-4.6s.
 */
function gaussianDelay(meanMs = 3000, sdMs = 800) {
  const u1 = Math.random();
  const u2 = Math.random();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(1400, Math.min(4600, Math.round(meanMs + gauss * sdMs)));
}

/**
 * Convert markdown formatting to WhatsApp formatting.
 */
function prepareText(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '*$1*')   // markdown bold -> WA bold
    .replace(/#{1,6} /g, '')              // strip headers
    .replace(/---/g, '')                  // strip hr
    .trim();
}

/**
 * Send a WhatsApp text message with typing indicator and anti-ban delay.
 * @param {object} socket - Baileys socket from getSocket()
 * @param {string} jid - WhatsApp JID
 * @param {string} text - Message text to send
 */
export async function sendText(socket, jid, text) {
  // Rate limit check (per-JID, 3s minimum gap)
  const last = lastSent.get(jid);
  if (last && Date.now() - last < MIN_GAP_MS) {
    logEvent({ type: 'outbound_rate_limited', jid: maskPhone(jid) });
    return;
  }

  const prepared = prepareText(text);

  try {
    // Typing indicator: composing -> delay -> send -> paused
    await socket.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, gaussianDelay()));
    await socket.sendMessage(jid, { text: prepared });
    await socket.sendPresenceUpdate('paused', jid);

    lastSent.set(jid, Date.now());
    logEvent({ type: 'outbound_sent', jid: maskPhone(jid), length: prepared.length });
  } catch (err) {
    logEvent({ type: 'send_error', jid: maskPhone(jid), error: err.message });
    // Safety: revert to watch mode for this JID
    try {
      setConversationMode.run({ jid, mode: 'watch' });
    } catch { /* db error non-critical here */ }
    throw err;
  }
}
