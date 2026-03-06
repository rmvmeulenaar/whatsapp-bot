import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";
const IDENTITY = readFileSync(`${KENNIS_DIR}/bot-identiteit.md`, "utf8");

async function _prijsNode(state) {
  const kennis = readFileSync(`${KENNIS_DIR}/prijzen.md`, "utf8");
  const prompt = `${IDENTITY}\n\nKENNIS (prijzen):\n${kennis}\n\nGeef ALLEEN prijsinformatie op basis van bovenstaande kennis. Gebruik altijd "vanaf" bij prijzen. Antwoord in de taal van de klant.`;

  const result = await generateReply(prompt, [], state.body, 0);
  return {
    results: [{ node: "prijs", text: result.text, model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["prijs:done"],
  };
}

export const prijsNode = withGuardrails(_prijsNode);
