import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";
import { buildQAPrompt } from "../prompt.js";
import { getHistory } from "../history.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";

async function _faqNode(state) {
  const kennis = readFileSync(`${KENNIS_DIR}/faq.md`, "utf8");
  // FIX: Pass "faq" as nodeName
  const prompt = buildQAPrompt(state.patient, kennis, state.language, "faq");
  const history = getHistory(state.jid);
  const result = await generateReply(prompt, history, state.body, 0.3);
  return {
    results: [{ node: "faq", text: result.text, type: "text", model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["faq:done"],
  };
}

export const faqNode = withGuardrails(_faqNode);
