import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";
const IDENTITY = readFileSync(`${KENNIS_DIR}/bot-identiteit.md`, "utf8");

async function _tijdenNode(state) {
  const kennis = readFileSync(`${KENNIS_DIR}/openingstijden.md`, "utf8");
  const prompt = `${IDENTITY}\n\nKENNIS (openingstijden):\n${kennis}\n\nGeef openingstijden op basis van bovenstaande kennis. Antwoord in de taal van de klant.`;

  const result = await generateReply(prompt, [], state.body, 0);
  return {
    results: [{ node: "tijden", text: result.text, model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["tijden:done"],
  };
}

export const tijdenNode = withGuardrails(_tijdenNode);
