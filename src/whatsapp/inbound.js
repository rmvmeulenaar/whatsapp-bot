// Inbound message pipeline: filter → dedup → normalize → rate-limit → takeover → AI graph
// Source: whatsapp-api-blueprint.md + PITFALLS.md (#4 dedup, #15 groups)
// Phase 3: runPipeline replaced by runGraph (LangGraph StateGraph)
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { logEvent } from "../logging/logger.js";
import { runGraph } from "../ai/graph.js";
import { checkRateLimit } from "./rateLimit.js";
import { setTakeover, isInTakeover } from "./takeover.js";
import { maskPhone } from "../integrations/clinicminds.js";

// Phase 5: suggest-mode takeover imports
import { getConversation, markSuggestionTakenOver, getExistingPending, insertOutgoingMessage, getLastWatchEntry } from "../dashboard/db.js";
import { cancelEscalation } from "../integrations/telegram.js";

// FIX 3: import wasBotSent to skip takeover for bot-sent fromMe messages
import { wasBotSent } from "./outbound.js";

// TEAM-01: block team member DMs (filled by Rogier in .env)
const TEAM_JIDS = new Set(
  (process.env.TEAM_JIDS ?? "").split(",").map(j => j.trim()).filter(Boolean)
);

// BUG-05: block Clinicminds reminder messages (phone-based)
const CLINICMINDS_REMINDER_NUMBERS = new Set(
  (process.env.CLINICMINDS_REMINDER_NUMBERS ?? "").split(",").map(j => j.trim()).filter(Boolean)
);
const REMINDER_PATTERN = /(?:uw afspraak|your appointment|herinnering|reminder|bevestig)/i;

// TTL-based deduplicator prevents double-processing on reconnect (Pitfall #4)
// Uses Map (not Set) so entries expire — prevents unbounded memory growth (Pitfall #11)
class MessageDeduplicator {
  constructor(maxAge = 20 * 60 * 1000, maxSize = 5000) {
    this.seen = new Map();
    this.maxAge = maxAge;
    this.maxSize = maxSize;
    // Proactive hourly cleanup prevents memory leak if Map grows past maxSize
    setInterval(() => this.cleanup(true), 60 * 60 * 1000).unref();
  }

  isDuplicate(key) {
    this.cleanup(false);
    if (this.seen.has(key)) return true;
    this.seen.set(key, Date.now());
    return false;
  }

  cleanup(force = false) {
    if (!force && this.seen.size <= this.maxSize) return;
    const now = Date.now();
    for (const [key, time] of this.seen) {
      if (now - time > this.maxAge) this.seen.delete(key);
    }
  }
}

const deduplicator = new MessageDeduplicator();

export function createInboundHandler(onMessageEvent) {
  return async function handleUpsert({ messages, type }) {
    // Handle both "notify" (new incoming) and "append" (history sync on reconnect)
    // Skipping "append" silently drops messages received while bot was offline
    if (type !== "notify" && type !== "append") return;

    for (const msg of messages) {
      await processMessage(msg, type, onMessageEvent);
    }
  };
}

async function processMessage(msg, type, onMessageEvent) {
  const remoteJid = msg.key.remoteJid;
  const id = msg.key.id;

  // fromMe check — als team zelf antwoordt, set takeover flag (Phase 2)
  // FIX 3: skip takeover if this fromMe was sent by the bot itself (not a human)
  if (msg.key.fromMe) {
    if (type === 'append') return; // TEAM-02: ignore history replay on reconnect
    if (remoteJid && !remoteJid.endsWith("@broadcast") && !remoteJid.endsWith("@g.us")) {
      if (wasBotSent(remoteJid)) {
        // Bot-sent echo — ignore, do NOT set takeover
        logEvent({ type: "fromMe_bot_skip", jid: maskPhone(remoteJid) });
      } else {
        // Human-typed fromMe — set takeover as before
        setTakeover(remoteJid);
        logEvent({ type: "fromMe_takeover", jid: maskPhone(remoteJid) });

        // Phase 5: als JID in suggest-mode staat, markeer pending als taken_over
        try {
          const conv = getConversation.get(remoteJid); // prepared statement — use .get()
          if (conv && conv.mode === 'suggest') {
            // CRITICAL ORDER: get pending FIRST (while status is still 'pending'),
            // THEN mark as taken_over, THEN cancel escalation using stored ID.
            // If you mark first, getExistingPending returns null (status no longer 'pending')
            // and the escalation timer leaks.
            const existing = getExistingPending(remoteJid);
            markSuggestionTakenOver(remoteJid);
            if (existing) {
              cancelEscalation(existing.id);
            }
            logEvent({ type: "suggest_taken_over", jid: maskPhone(remoteJid) });
          }
        } catch (err) {
          console.error("[inbound] suggest takeover check failed:", err.message);
        }
      }
    }

    // Phase 10: log Moumen's direct WhatsApp reply for few-shot learning
    try {
      const text = extractText(normalizeMessageContent(msg.message));
      if (text) {
        const lastEntry = getLastWatchEntry.get(remoteJid);
        insertOutgoingMessage.run({
          jid: remoteJid,
          ts: new Date((msg.messageTimestamp?.toNumber?.() ?? msg.messageTimestamp ?? 0) * 1000).toISOString(),
          text,
          source: 'moumen',
          watch_entry_id: lastEntry?.id ?? null
        });
        logEvent({ type: "fromMe_logged", jid: maskPhone(remoteJid) });
      }
    } catch (err) {
      console.error("[inbound] fromMe logging failed:", err.message);
    }
    return; // Niet door pipeline sturen
  }

  // Filter 1: Skip WhatsApp status updates and broadcast lists (Pitfall #15)
  if (remoteJid === "status@broadcast") return;
  if (remoteJid.endsWith("@broadcast")) return;

  // Filter 2: Skip group messages (Phase 1 policy: groups disabled)
  // PVI team group 120363301130072756@g.us must NOT trigger bot
  if (remoteJid.endsWith("@g.us")) return;

  // TEAM-01: skip team member DMs
  if (TEAM_JIDS.size > 0 && TEAM_JIDS.has(remoteJid)) {
    logEvent({ type: "team_message_skipped", jid: maskPhone(remoteJid) });
    return;
  }

  // BUG-05: skip Clinicminds reminder messages (phone-based)
  if (CLINICMINDS_REMINDER_NUMBERS.size > 0 && CLINICMINDS_REMINDER_NUMBERS.has(remoteJid)) {
    logEvent({ type: "clinicminds_reminder_skipped", jid: maskPhone(remoteJid) });
    return;
  }

  // Deduplication by jid+messageId pair (Pitfall #4)
  const dedupeKey = `${remoteJid}:${id}`;
  if (deduplicator.isDuplicate(dedupeKey)) return;

  // Normalize Baileys message structure to consistent format
  const message = normalizeMessageContent(msg.message);

  // Extract plain text from any message type
  const body = extractText(message);

  // messageTimestamp can be Long (protobuf) or plain number — handle both (Pitfall #6)
  const ts = (msg.messageTimestamp?.toNumber?.() ?? msg.messageTimestamp ?? Date.now() / 1000) * 1000;

  const jid = remoteJid;

  // Rate limit check (Phase 2)
  const rateResult = checkRateLimit(jid);
  if (!rateResult.allowed) {
    logEvent({ type: "rate_limited", jid: maskPhone(jid) });
    return;
  }

  // Takeover check — als mens recent heeft geantwoord, skip pipeline (Phase 2)
  if (isInTakeover(jid)) {
    logEvent({ type: "takeover_active", jid: maskPhone(jid) });
    return;
  }

  // Normalized MessageEvent — no Baileys types leak past this boundary
  const event = {
    jid,
    chatType: "dm",
    name: msg.pushName || "Onbekend",
    body,
    media: null,          // Phase 1: no media processing
    replyContext: null,
    messageId: id,
    ts
  };

  // Log every inbound event — raw event in JSONL
  logEvent({ type: "inbound", ...event });

  // Dispatch to caller handler
  if (onMessageEvent) await onMessageEvent(event);

  // AI Graph (watch-mode: logt, stuurt niets) (Phase 3: LangGraph)
  try {
    await runGraph(jid, body);
  } catch (err) {
    logEvent({ type: "graph_error", jid: maskPhone(jid), error: err.message });
  }
}

function extractText(message) {
  if (!message) return "";
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.listResponseMessage?.title) return message.listResponseMessage.title;
  if (message.buttonsResponseMessage?.selectedDisplayText)
    return message.buttonsResponseMessage.selectedDisplayText;
  return "";
}
