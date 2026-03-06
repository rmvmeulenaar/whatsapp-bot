import { StateGraph, START, END } from "@langchain/langgraph";
import { BotStateAnnotation } from "./state.js";
import { withGuardrails } from "./guardrails.js";

// Import all 12 nodes
import { routerNode } from "./nodes/router.js";
import { classifierNode } from "./nodes/classifier.js";
import { patientLookupNode } from "./nodes/patientLookup.js";
import { escalationNode } from "./nodes/escalation.js";
import { prijsNode } from "./nodes/prijs.js";
import { vestigingNode } from "./nodes/vestiging.js";
import { tijdenNode } from "./nodes/tijden.js";
import { behandelingNode } from "./nodes/behandeling.js";
import { faqNode } from "./nodes/faq.js";
import { bookingLinkNode } from "./nodes/bookingLink.js";
import { mergeNode } from "./nodes/merge.js";
import { guardrailNode } from "./nodes/guardrail.js";

// Dashboard + logging imports
import { insertEntry, broadcastEntry, getConversation, setConversationMode } from "../dashboard/db.js";
import { logEvent } from "../logging/logger.js";
import { appendHistory } from "./history.js";
import { detectLanguage } from "./detect.js";
import { maskPhone } from "../integrations/clinicminds.js";

// Outbound + connection imports
import { sendText } from "../whatsapp/outbound.js";
import { getSocket } from "../whatsapp/connection.js";

// Phase 5: Telegram suggest-mode imports (static — NOT dynamic import)
import { sendSuggestNotification, scheduleEscalation, replacePendingForJid } from "../integrations/telegram.js";
import { insertPendingSuggestion, setMoumenMsgId, setRogierMsgId, getExistingPending } from "../dashboard/db.js";

// contentRouterNode — KEPT as orphaned node (edges removed, node registration kept)
// Routing is now done via addConditionalEdges on patientLookup
async function _contentRouterNode(state) {
  return { node_trace: ["contentRouter"] };
}
const contentRouterNode = withGuardrails(_contentRouterNode);

// Build the StateGraph
const workflow = new StateGraph(BotStateAnnotation);

// Add all nodes
workflow.addNode("router", routerNode);
workflow.addNode("classifier", classifierNode);
workflow.addNode("patientLookup", patientLookupNode);
workflow.addNode("contentRouter", contentRouterNode);
workflow.addNode("escalation", escalationNode);
workflow.addNode("prijs", prijsNode);
workflow.addNode("vestiging", vestigingNode);
workflow.addNode("tijden", tijdenNode);
workflow.addNode("behandeling", behandelingNode);
workflow.addNode("faq", faqNode);
workflow.addNode("bookingLink", bookingLinkNode);
workflow.addNode("merge", mergeNode);
workflow.addNode("guardrail", guardrailNode);

// Wire edges
workflow.addEdge(START, "router");

// After router: conditional routing based on intent.routing
workflow.addConditionalEdges("router", (state) => {
  const routing = state.intent?.routing;
  if (routing === "escalation") return "escalation";
  if (routing === "classifier") return "classifier";
  return "patientLookup"; // routing === "content" — go directly to patient lookup
});

// Classifier routes to patientLookup
workflow.addEdge("classifier", "patientLookup");

// Multi-label parallel fan-out from patientLookup to content nodes
workflow.addConditionalEdges("patientLookup", (state) => {
  const labels = state.intent?.labels ?? [];
  const validNodes = ["prijs", "vestiging", "tijden", "behandeling", "faq", "bookingLink"];
  // Map 'booking' label (from classifier) to 'bookingLink' node name
  const mapped = labels.map(l => l === 'booking' ? 'bookingLink' : l);
  const matched = mapped.filter(l => validNodes.includes(l));
  return matched.length > 0 ? matched : ["faq"];
});

// Fan-in: all content nodes -> merge (LangGraph waits only for triggered nodes)
workflow.addEdge(["prijs", "vestiging", "tijden", "behandeling", "faq", "bookingLink"], "merge");

// merge -> guardrail -> END
workflow.addEdge("merge", "guardrail");
workflow.addEdge("guardrail", END);
workflow.addEdge("escalation", END);

// Compile ONCE at module load
export const graph = workflow.compile();

// runGraph — replaces runPipeline interface
// Entry fields aligned with db.js insertEntry prepared statement:
//   INSERT maps: @inbound_classification -> classification column
//                @safety_classification -> safety_class column
export async function runGraph(jid, inboundText) {
  const ts = new Date().toISOString();
  const language = detectLanguage(inboundText);
  const startTs = Date.now();

  // Look up per-JID mode from conversations table (default: watch)
  const conv = getConversation.get(jid);
  const mode = conv?.mode ?? 'watch';
  const clinic = conv?.clinic ?? 'unknown';

  const initialState = {
    jid,
    body: inboundText,
    ts: startTs,
    mode,
    clinic,
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

  // History update — only if we have actual output
  if (result.output) {
    appendHistory(jid, "user", inboundText);
    appendHistory(jid, "assistant", result.output);
  }

  // Auto-mode outbound (after graph.invoke())
  let action = 'watch_log_only';
  if (mode === 'auto' && result.output && !result.error?.startsWith('guardrail')) {
    const socket = getSocket();
    if (socket) {
      try {
        // FIX 5: check return value — { sent: false } means rate limited
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
    // Phase 5: suggest-mode — stuur Telegram notificatie in plaats van WhatsApp bericht
    const suggestionId = insertPendingSuggestion({
      jid,
      proposed_message: result.output,
      inbound_message: inboundText,
      patient_name: result.patient?.fullName ?? jid.split('@')[0],
      watch_entry_id: null,
    });

    // Supersede any existing pending for this JID (cancels escalation timer, edits Telegram msg)
    await replacePendingForJid(jid, suggestionId);

    // Determine primary recipient
    const MOUMEN_CHAT_ID = process.env.MOUMEN_TELEGRAM_ID ? Number(process.env.MOUMEN_TELEGRAM_ID) : null;
    const ROGIER_CHAT_ID = Number(process.env.ROGIER_TELEGRAM_ID ?? "6237130967");
    const primaryChatId = MOUMEN_CHAT_ID ?? ROGIER_CHAT_ID;

    const msgId = await sendSuggestNotification({
      chatId: primaryChatId,
      suggestionId,
      patientName: result.patient?.fullName ?? jid.split('@')[0],
      customerMsg: inboundText,
      proposedReply: result.output,
    });

    if (msgId) {
      if (MOUMEN_CHAT_ID) {
        setMoumenMsgId(suggestionId, msgId);
      } else {
        // No Moumen configured — Rogier is primary, skip escalation
        setRogierMsgId(suggestionId, msgId);
      }
    }

    // Schedule escalation only if Moumen is primary (otherwise Rogier already got it)
    if (MOUMEN_CHAT_ID && msgId) {
      scheduleEscalation(suggestionId, {
        patientName: result.patient?.fullName ?? jid.split('@')[0],
        customerMsg: inboundText,
        proposedReply: result.output,
      });
    }

    action = 'suggest_pending';
  }

  // Build watch entry compatible with db.js insertEntry prepared statement
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

  return entry;
}
