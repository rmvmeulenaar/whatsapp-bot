import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";
const IDENTITY = readFileSync(`${KENNIS_DIR}/bot-identiteit.md`, "utf8");

async function _faqNode(state) {
  const kennis = readFileSync(`${KENNIS_DIR}/faq.md`, "utf8");
  const prompt = `${IDENTITY}\n\nKENNIS (FAQ):\n${kennis}\n\nBeantwoord de vraag op basis van bovenstaande kennis. Als het antwoord niet in de kennis staat, zeg dat je het niet zeker weet en verwijs naar een collega. Antwoord in de taal van de klant.`;

  const result = await generateReply(prompt, [], state.body, 0.3);
  return {
    results: [{ node: "faq", text: result.text, model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["faq:done"],
  };
}

export const faqNode = withGuardrails(_faqNode);
