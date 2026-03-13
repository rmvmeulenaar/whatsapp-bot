import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";
import { buildQAPrompt } from "../prompt.js";
import { getHistory } from "../history.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";

async function _prijsNode(state) {
  const kennis = readFileSync(`${KENNIS_DIR}/prijzen.md`, "utf8");
  // FIX: Pass "prijs" as nodeName
  const prompt = buildQAPrompt(state.patient, kennis, state.language, "prijs");
  const history = getHistory(state.jid);
  const result = await generateReply(prompt, history, state.body, 0);
  return {
    results: [{ node: "prijs", text: result.text, type: "text", model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["prijs:done"],
  };
}

export const prijsNode = withGuardrails(_prijsNode);
