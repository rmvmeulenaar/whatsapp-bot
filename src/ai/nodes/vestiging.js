import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";
import { buildQAPrompt } from "../prompt.js";
import { getHistory } from "../history.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";

async function _vestigingNode(state) {
  let kennis = readFileSync(`${KENNIS_DIR}/vestigingen.md`, "utf8");
  if (state.clinic && state.clinic !== "unknown") {
    try {
      kennis += "\n\n" + readFileSync(`${KENNIS_DIR}/vestigingen-${state.clinic}.md`, "utf8");
    } catch { /* clinic-specific file may not exist */ }
  }
  // FIX: Pass "vestiging" as nodeName
  const prompt = buildQAPrompt(state.patient, kennis, state.language, "vestiging");
  const history = getHistory(state.jid);
  const result = await generateReply(prompt, history, state.body, 0);
  return {
    results: [{ node: "vestiging", text: result.text, type: "text", model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["vestiging:done"],
  };
}

export const vestigingNode = withGuardrails(_vestigingNode);
