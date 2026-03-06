import { classifyIntent } from "../router/classifier.js";
import { classifyInbound } from "./classifier.js";
import { lookupPatientByPhone, normalizePhone, maskPhone } from "../integrations/clinicminds.js";
import { getKennisBlock } from "../knowledge/loader.js";
import { buildQAPrompt } from "./prompt.js";
import { getHistory, appendHistory } from "./history.js";
import { generateReply } from "./engine.js";
import { validateOutput } from "./safety.js";
import { loadPriceWhitelist } from "./priceWhitelist.js";
import { detectLanguage } from "./detect.js";
import { logEvent } from "../logging/logger.js";
import { insertEntry, broadcastEntry } from "../dashboard/db.js";

// Load price whitelist once at startup (reload requires restart)
let priceWhitelist = [];
try {
  priceWhitelist = loadPriceWhitelist();
} catch (err) {
  logEvent({ type: "price_whitelist_load_error", error: err.message });
}

export async function runPipeline(jid, inboundText) {
  const ts = new Date().toISOString();

  try {
    // 1. Language detection
    const language = detectLanguage(inboundText);

    // 2. Intent classification (qa / booking / escalation)
    const intent = classifyIntent(inboundText);

    // 3. Inbound SOUL.md classification (GROEN / GEEL / ROOD)
    const { classification: inboundClass, reason: classReason } = classifyInbound(inboundText);

    // 4. Clinicminds patient lookup with 2s timeout
    const phone = normalizePhone(jid.split("@")[0]);
    let patient = null;
    try {
      patient = await Promise.race([
        lookupPatientByPhone(phone),
        new Promise((_, rej) => setTimeout(() => rej(new Error("clinicminds_timeout")), 2000)),
      ]);
    } catch (err) {
      logEvent({ type: "clinicminds_lookup_fail", jid: maskPhone(jid), error: err.message });
      // Non-fatal: continue with patient = null
    }

    // 5. Select knowledge block based on patient's clinic
    const clinicContext = patient?.location?.toLowerCase().includes("radiance") ? "radiance"
      : patient ? "pvi" : "both";
    const kennisBlock = getKennisBlock(clinicContext);

    // 6. Build prompt and get history
    const systemPrompt = buildQAPrompt(patient, kennisBlock, language);
    const history = getHistory(jid);

    // 7. LLM call — only for qa intent
    let llmResult = { text: null, model: "skipped", tokens: null, latencyMs: 0 };

    if (intent === "qa") {
      try {
        llmResult = await generateReply(systemPrompt, history, inboundText, 0.3);
      } catch (err) {
        logEvent({ type: "llm_error", jid: maskPhone(jid), error: err.message });
        llmResult = { text: null, model: "error", tokens: null, latencyMs: 0 };
      }
    }

    // 8. Safety validation
    const safetyResult = llmResult.text
      ? validateOutput(llmResult.text, inboundText, priceWhitelist)
      : {
          pass: false,
          classification: "ROOD",
          reason: intent === "escalation" ? "escalation_required" : (intent === "booking" ? "booking_intent" : "llm_failed"),
          text: null,
        };

    // 9. Append to conversation history
    if (llmResult.text) {
      appendHistory(jid, "user", inboundText);
      appendHistory(jid, "assistant", safetyResult.text ?? llmResult.text);
    }

    // 10. Build watch entry (GDPR: maskPhone for all log entries)
    const entry = {
      ts,
      jid: maskPhone(jid),
      intent,
      inbound: inboundText,
      inbound_classification: inboundClass,
      inbound_classification_reason: classReason,
      knowledge_source: clinicContext,
      model: llmResult.model,
      latency_ms: llmResult.latencyMs,
      proposed_reply: safetyResult.text,
      safety_pass: safetyResult.pass ? 1 : 0,
      safety_reason: safetyResult.reason,
      safety_classification: safetyResult.classification,
      action: "watch_log_only",
      feedback: null,
      correction: null,
    };

    // 11. Log to JSONL + SQLite + broadcast to dashboard
    logEvent({ type: "watch_entry", ...entry });
    const result = insertEntry.run(entry);
    broadcastEntry({ id: Number(result.lastInsertRowid), ...entry });

    return entry;

  } catch (err) {
    // Pipeline-level error: log and return error entry
    const errorEntry = {
      ts,
      jid: maskPhone(jid),
      intent: "error",
      inbound: inboundText,
      inbound_classification: "ROOD",
      knowledge_source: "none",
      model: "error",
      latency_ms: 0,
      proposed_reply: null,
      safety_pass: 0,
      safety_reason: `pipeline_error: ${err.message}`,
      safety_classification: "ROOD",
      action: "watch_log_only",
      feedback: null,
      correction: null,
    };
    logEvent({ type: "pipeline_error", jid: maskPhone(jid), error: err.message, stack: err.stack });
    try {
      const result = insertEntry.run(errorEntry);
      broadcastEntry({ id: Number(result.lastInsertRowid), ...errorEntry });
    } catch {
      // Ignore DB errors in error handler
    }
    return errorEntry;
  }
}
