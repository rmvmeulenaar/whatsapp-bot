import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";
import { buildQAPrompt } from "../prompt.js";
import { getHistory } from "../history.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";

async function _tijdenNode(state) {
  const kennis = readFileSync(`${KENNIS_DIR}/openingstijden.md`, "utf8");
  // FIX: Pass "tijden" as nodeName — adds fallback instruction for missing info
  const prompt = buildQAPrompt(state.patient, kennis, state.language, "tijden");
  const history = getHistory(state.jid);
  const result = await generateReply(prompt, history, state.body, 0);
  return {
    results: [{ node: "tijden", text: result.text, type: "text", model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["tijden:done"],
  };
}

export const tijdenNode = withGuardrails(_tijdenNode);
