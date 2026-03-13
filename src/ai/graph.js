import { StateGraph, START, END } from "@langchain/langgraph";
import { BotStateAnnotation } from "./state.js";
import { withGuardrails } from "./guardrails.js";

// Import all nodes
import { routerNode } from "./nodes/router.js";
import { classifierNode } from "./nodes/classifier.js";
import { patientLookupNode } from "./nodes/patientLookup.js";
import { escalationNode } from "./nodes/escalation.js";
import { mergeNode } from "./nodes/merge.js";
import { dispatcherNode } from "./nodes/dispatcher.js";
import { guardrailNode } from "./nodes/guardrail.js";

// Dashboard + logging imports
import { insertEntry, broadcastEntry, getConversation, setConversationMode } from "../dashboard/db.js";
import { logEvent } from "../logging/logger.js";
import { appendHistory, getHistory } from "./history.js";
import { detectLanguage } from "./detect.js";
import { maskPhone, lookupPatientByPhone, normalizePhone } from "../integrations/clinicminds.js";

// Outbound + connection imports
import { Langfuse } from "langfuse";
import { sendText } from "../whatsapp/outbound.js";
import { getSocket } from "../whatsapp/connection.js";

// Phase 5: Telegram suggest-mode imports
import { sendSuggestNotification, replacePendingForJid } from "../integrations/telegram.js";
import { insertPendingSuggestion, setMoumenMsgId, setRogierMsgId, getExistingPending } from "../dashboard/db.js";

// BUG-06 FIX: Multilingual greeting node
const GREETINGS = {
  nl: { greeting: "Hoi! Waarmee kan ik je helpen? — Molty", ack: "Graag gedaan! Als je nog vragen hebt, laat het me weten 😊 — Molty" },
  en: { greeting: "Hi! How can I help you? — Molty", ack: "You're welcome! Feel free to ask if you have more questions 😊 — Molty" },
  ar: { greeting: "مرحباً! كيف يمكنني مساعدتك؟ — Molty", ack: "بكل سرور! إذا كان لديك أي أسئلة، لا تتردد 😊 — Molty" },
  tr: { greeting: "Merhaba! Size nasıl yardımcı olabilirim? — Molty", ack: "Rica ederim! Başka sorularınız olursa lütfen sorun 😊 — Molty" },
  fr: { greeting: "Bonjour! Comment puis-je vous aider? — Molty", ack: "De rien! N'hésitez pas si vous avez d'autres questions 😊 — Molty" },
};

async function greetingNode(state) {
  const lang = state.language ?? "nl";
  const t = GREETINGS[lang] ?? GREETINGS.en;
  const label = state.intent?.labels?.[0];
  if (label === "acknowledgment") {
    return { output: t.ack, node_trace: ["greeting:acknowledgment"] };
  }
  return { output: t.greeting, node_trace: ["greeting:done"] };
}

// contentRouterNode — KEPT as orphaned node (edges removed, node registration kept)
const contentRouterNode = withGuardrails(async function _contentRouterNode(state) {
  return { node_trace: ["contentRouter"] };
});

// Build the StateGraph
const workflow = new StateGraph(BotStateAnnotation);

// Add all nodes
workflow.addNode("router", routerNode);
workflow.addNode("classifier", classifierNode);
workflow.addNode("patientLookup", patientLookupNode);
workflow.addNode("contentRouter", contentRouterNode);
workflow.addNode("escalation", escalationNode);
workflow.addNode("greeting", greetingNode);   // BUG 12 FIX + BUG-06 FIX
workflow.addNode("dispatcher", dispatcherNode);
workflow.addNode("merge", mergeNode);
workflow.addNode("guardrail", guardrailNode);

// Wire edges
workflow.addEdge(START, "router");

// After router: conditional routing based on intent.routing
workflow.addConditionalEdges("router", (state) => {
  const routing = state.intent?.routing;
  if (routing === "escalation") return "escalation";
  if (routing === "greeting") return "greeting";  // BUG 12 FIX
  if (routing === "classifier") return "classifier";
  return "patientLookup"; // routing === "content"
});

// Classifier routes to patientLookup
workflow.addEdge("classifier", "patientLookup");

// BUG-07 FIX: patientLookup → conditional: off_topic → END, notWelcome → escalation, else → dispatcher
workflow.addConditionalEdges("patientLookup", (state) => {
  if (state.patient?.notWelcome) return "escalation";
  if (state.intent?.labels?.[0] === "off_topic") return END;  // BUG-07: no output for off-topic
  return "dispatcher";
});

// dispatcher -> merge
workflow.addEdge("dispatcher", "merge");

// merge -> guardrail -> END
workflow.addEdge("merge", "guardrail");
workflow.addEdge("guardrail", END);
workflow.addEdge("escalation", END);
workflow.addEdge("greeting", END);  // BUG 12 FIX

// Compile ONCE at module load
export const graph = workflow.compile();

// Langfuse client — singleton
const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY ?? "",
  publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "",
  baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
  flushAt: 1,
  requestTimeout: 5000,
});


export async function runGraph(jid, inboundText) {
  const ts = new Date().toISOString();
  const language = detectLanguage(inboundText);
  const startTs = Date.now();

  // Look up per-JID mode from conversations table (BUG-01 FIX: default 'watch' not 'suggest')
  const conv = getConversation.get(jid);
  const mode = conv?.mode ?? 'suggest';
  const clinic = conv?.clinic ?? 'unknown';

  // Langfuse trace
  const trace = langfuse.trace({
    name: "whatsapp-message",
    userId: maskPhone(jid),
    input: inboundText,
    metadata: { mode, clinic, jid: maskPhone(jid) },
  });

  // BUG-10 FIX: Include conversation history in initial state
  const initialState = {
    jid,
    body: inboundText,
    ts: startTs,
    mode,
    clinic,
    language,
    history: getHistory(jid),
  };

  let result;
  try {
    result = await graph.invoke(initialState);
  } catch (err) {
    logEvent({ type: "graph_error", jid: maskPhone(jid), error: err.message });
    result = {
      output: null,
      error: err.message,
      node_trace: ["graph:crash"],
      intent: { labels: [], method: "error", routing: "error" },
      patient: null,
      results: [],
      clinic: "unknown",
    };
  }

  // FIX: Ensure patient data is available for Telegram context
  // (greeting/escalation-keyword paths skip patientLookup node)
  if (!result.patient) {
    try {
      const phone = normalizePhone(jid.split("@")[0]);
      result.patient = await lookupPatientByPhone(phone);
    } catch (_) { /* non-fatal — proceed without patient context */ }
  }

  // BUG-09 FIX: Always log user message, even if bot has no output
  appendHistory(jid, "user", inboundText);
  if (result.output) {
    appendHistory(jid, "assistant", result.output);
  }

  // Auto-mode outbound
  let action = 'watch_log_only';
  if (mode === 'auto' && result.output && !result.error?.startsWith('guardrail')) {
    const socket = getSocket();
    if (socket) {
      try {
        const sendResult = await sendText(socket, jid, result.output);
        if (sendResult && sendResult.sent === false) {
          logEvent({ type: 'auto_send_rate_limited', jid: maskPhone(jid), reason: sendResult.reason });
          action = 'rate_limited';
        } else {
          action = 'auto_reply';
        }
      } catch (err) {
        logEvent({ type: 'auto_send_failed', jid: maskPhone(jid), error: err.message });
        action = 'send_failed';
      }
    } else {
      logEvent({ type: 'send_error', jid: maskPhone(jid), reason: 'no_socket' });
      action = 'no_socket';
    }
  } else if (mode === 'auto' && result.error?.startsWith('guardrail')) {
    action = 'guardrail_blocked';
  } else if (mode === 'suggest' && result.output && !result.error?.startsWith('guardrail')) {
    // Phase 5: suggest-mode — Telegram notification
    const suggestionId = insertPendingSuggestion({
      jid,
      proposed_message: result.output,
      inbound_message: inboundText,
      patient_name: result.patient?.fullName ?? jid.split('@')[0],
      watch_entry_id: null,
    });

    await replacePendingForJid(jid, suggestionId);

    const MOUMEN_CHAT_ID = process.env.MOUMEN_TELEGRAM_ID ? Number(process.env.MOUMEN_TELEGRAM_ID) : null;
    const ROGIER_CHAT_ID = Number(process.env.ROGIER_TELEGRAM_ID ?? "6237130967");

    const notifParams = {
      suggestionId,
      patientName: result.patient?.fullName ?? jid.split('@')[0],
      customerMsg: inboundText,
      proposedReply: result.output,
      patientContext: result.patient ?? null,
    };

    // Stuur naar Moumen (als beschikbaar)
    if (MOUMEN_CHAT_ID) {
      const moumenMsgId = await sendSuggestNotification({ chatId: MOUMEN_CHAT_ID, ...notifParams });
      if (moumenMsgId) setMoumenMsgId(suggestionId, moumenMsgId);
    }

    // Stuur direct ook naar Rogier (CC — race-condition safe via claimSuggestion)
    const rogierMsgId = await sendSuggestNotification({ chatId: ROGIER_CHAT_ID, ...notifParams });
    if (rogierMsgId) setRogierMsgId(suggestionId, rogierMsgId);

    action = 'suggest_pending';
  }

  // Build watch entry
  const entry = {
    ts,
    jid: maskPhone(jid),
    intent: result.intent?.labels?.join(",") ?? "unknown",
    inbound: inboundText,
    inbound_classification: "GROEN",
    inbound_classification_reason: result.intent?.routing ?? null,
    knowledge_source: result.clinic ?? "unknown",
    model: result.results?.[0]?.model ?? "none",
    latency_ms: Date.now() - startTs,
    proposed_reply: result.output,
    safety_pass: result.error?.startsWith("guardrail") ? 0 : 1,
    safety_classification: result.error?.startsWith("guardrail") ? "ROOD" : "GROEN",
    safety_reason: result.error ?? null,
    action,
    feedback: null,
    correction: null,
    node_trace: (result.node_trace ?? []).join(" -> "),
  };

  logEvent({ type: "watch_entry", ...entry });

  try {
    const dbResult = insertEntry.run(entry);
    broadcastEntry({ id: Number(dbResult.lastInsertRowid), ...entry });
  } catch (dbErr) {
    logEvent({ type: "db_error", error: dbErr.message });
  }

  // Langfuse spans
  try {
    for (const r of result.results ?? []) {
      trace.span({
        name: r.node,
        output: { text: r.text?.slice(0, 500), type: r.type },
        metadata: { error_code: r.error ?? null },
      });
    }
    trace.update({
      output: result.output ?? null,
      metadata: {
        action,
        node_trace: entry.node_trace,
        latency_ms: entry.latency_ms,
        model: entry.model,
        intent: entry.intent,
      },
    });
    langfuse.flushAsync().catch(() => {});
  } catch (_) {}

  return entry;
}
