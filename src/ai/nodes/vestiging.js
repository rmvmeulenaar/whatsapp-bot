import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";
const IDENTITY = readFileSync(`${KENNIS_DIR}/bot-identiteit.md`, "utf8");

async function _vestigingNode(state) {
  let kennis = readFileSync(`${KENNIS_DIR}/vestigingen.md`, "utf8");
  if (state.clinic && state.clinic !== "unknown") {
    try {
      kennis += "\n\n" + readFileSync(`${KENNIS_DIR}/vestigingen-${state.clinic}.md`, "utf8");
    } catch { /* clinic-specific file may not exist */ }
  }
  const prompt = `${IDENTITY}\n\nKENNIS (vestigingen):\n${kennis}\n\nGeef locatie-informatie op basis van bovenstaande kennis. Antwoord in de taal van de klant.`;

  const result = await generateReply(prompt, [], state.body, 0);
  return {
    results: [{ node: "vestiging", text: result.text, model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["vestiging:done"],
  };
}

export const vestigingNode = withGuardrails(_vestigingNode);
