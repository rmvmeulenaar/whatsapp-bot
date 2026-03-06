import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";
const IDENTITY = readFileSync(`${KENNIS_DIR}/bot-identiteit.md`, "utf8");

async function _behandelingNode(state) {
  const clinic = state.clinic && state.clinic !== "unknown" ? state.clinic : null;
  let kennis;
  if (clinic) {
    try {
      kennis = readFileSync(`${KENNIS_DIR}/behandelingen-${clinic}.md`, "utf8");
    } catch {
      kennis = readFileSync(`${KENNIS_DIR}/behandelingen.md`, "utf8");
    }
  } else {
    try {
      kennis = readFileSync(`${KENNIS_DIR}/behandelingen-radiance.md`, "utf8")
        + "\n\n---\n\n"
        + readFileSync(`${KENNIS_DIR}/behandelingen-pvi.md`, "utf8");
    } catch {
      try {
        kennis = readFileSync(`${KENNIS_DIR}/behandelingen.md`, "utf8");
      } catch {
        kennis = "Geen behandelingsinformatie beschikbaar.";
      }
    }
  }

  const prompt = `${IDENTITY}\n\nKENNIS (behandelingen):\n${kennis}\n\nGeef behandelinformatie op basis van bovenstaande kennis. Gebruik NOOIT medisch advies. Antwoord in de taal van de klant.`;

  const result = await generateReply(prompt, [], state.body, 0.1);
  return {
    results: [{ node: "behandeling", text: result.text, model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["behandeling:done"],
  };
}

export const behandelingNode = withGuardrails(_behandelingNode);
