import { readFileSync } from "fs";
import { generateReply } from "../engine.js";
import { withGuardrails } from "../guardrails.js";
import { buildQAPrompt } from "../prompt.js";
import { getHistory } from "../history.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";

// Iteratie 3 FIX: Strip ALL price information from kennis before passing to LLM
// This prevents the LLM from leaking prices like "€80" from behandelingen-pvi.md
function stripPrices(text) {
  return text
    // €X, € X, €X.XX patterns
    .replace(/€\s*\d+[\d.,]*/g, "")
    // "X euro", "X,XX euro" patterns
    .replace(/\d+[\d.,]*\s*euro/gi, "")
    // "vanaf ..." with removed prices
    .replace(/vanaf\s+(?:\s|$)/gi, "")
    // "Startprijs:" lines
    .replace(/\*?\*?Startprijs:\*?\*?\s*/gi, "")
    // Table rows that now have empty price cells
    .replace(/\|\s*\|\s*$/gm, "| op aanvraag |")
    // Cleanup double/triple spaces
    .replace(/  +/g, " ");
}

// Extract relevant section from large kennis file based on user question
function extractRelevantSection(fullKennis, userMessage, maxChars = 8000) {
  if (fullKennis.length <= maxChars) return fullKennis;

  const lower = userMessage.toLowerCase();
  // Split into sections by ## headings
  const sections = fullKennis.split(/(?=^## )/m);

  // Score each section by keyword overlap with user message
  const scored = sections.map(section => {
    const sectionLower = section.toLowerCase();
    const keywords = lower.split(/\s+/).filter(w => w.length > 3);
    const score = keywords.filter(w => sectionLower.includes(w)).length;
    return { section, score };
  });

  // Always keep the header (first section if it starts with #)
  const header = sections[0]?.startsWith("# ") ? sections[0] : "";

  // Sort by score descending, take top sections until maxChars
  scored.sort((a, b) => b.score - a.score);
  let result = header;
  for (const { section, score } of scored) {
    if (section === header) continue;
    if (score === 0 && result.length > 1000) continue;
    if (result.length + section.length > maxChars) break;
    result += "\n\n" + section;
  }

  return result || fullKennis.slice(0, maxChars);
}

async function _behandelingNode(state) {
  const clinic = state.clinic && state.clinic !== "unknown" ? state.clinic : null;
  let kennis;
  if (clinic) {
    try {
      kennis = readFileSync(`${KENNIS_DIR}/behandelingen-${clinic}.md`, "utf8");
    } catch {
      try {
        kennis = readFileSync(`${KENNIS_DIR}/behandelingen.md`, "utf8");
      } catch {
        kennis = "Geen behandelingsinformatie beschikbaar.";
      }
    }
  } else {
    try {
      const radiance = readFileSync(`${KENNIS_DIR}/behandelingen-radiance.md`, "utf8");
      const pvi = readFileSync(`${KENNIS_DIR}/behandelingen-pvi.md`, "utf8");
      const combined = radiance + "\n\n---\n\n" + pvi;
      kennis = extractRelevantSection(combined, state.body, 8000);
    } catch {
      try {
        kennis = readFileSync(`${KENNIS_DIR}/behandelingen.md`, "utf8");
      } catch {
        kennis = "Geen behandelingsinformatie beschikbaar.";
      }
    }
  }

  // Iteratie 3 FIX: Strip all prices from kennis to prevent price leaks
  kennis = stripPrices(kennis);

  // FIX: Pass "behandeling" as nodeName → prompt will add "no prices" rule
  const prompt = buildQAPrompt(state.patient, kennis, state.language, "behandeling");
  const history = getHistory(state.jid);
  const result = await generateReply(prompt, history, state.body, 0.1);
  return {
    results: [{ node: "behandeling", text: result.text, type: "text", model: result.model, latencyMs: result.latencyMs }],
    node_trace: ["behandeling:done"],
  };
}

export const behandelingNode = withGuardrails(_behandelingNode);
