import { generateReply } from "../engine.js";
import { getHistory } from "../history.js";

const VALID_LABELS = ["prijs", "vestiging", "tijden", "behandeling", "faq", "booking"];

const CLASSIFIER_PROMPT = `Je bent een intent classifier voor een kliniek WhatsApp bot.
Classificeer het bericht. Geef de 1 of 2 meest relevante categorieen.

Categorieen: prijs, vestiging, tijden, behandeling, faq, booking

Antwoord ALLEEN met geldige JSON:
- 1 intent: {"labels": ["prijs"], "confidence": 0.95}
- 2 intents: {"labels": ["prijs", "vestiging"], "confidence": 0.88}

Eerste label = hoogste prioriteit. Max 2 labels. Geen uitleg, alleen JSON.`;

export async function classifierNode(state) {
  try {
    const history = getHistory(state.jid);
    const result = await generateReply(CLASSIFIER_PROMPT, history.slice(-4), state.body, 0);

    let parsed = { labels: ["faq"], confidence: 0.3 };
    try {
      const raw = result.text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
      parsed = JSON.parse(raw);
    } catch { /* fallback to faq */ }

    const labels = (parsed.labels ?? ["faq"])
      .filter(l => VALID_LABELS.includes(l))
      .slice(0, 2);
    const finalLabels = labels.length ? labels : ["faq"];

    return {
      intent: {
        labels: finalLabels,
        confidence: parsed.confidence ?? 0.7,
        method: "llm",
      },
      node_trace: ["classifier:" + finalLabels.join("+")],
      history: [{ role: "classifier", ts: Date.now(), labels: finalLabels }],
    };
  } catch (err) {
    return {
      intent: { labels: ["faq"], confidence: 0.3, method: "llm_error" },
      node_trace: ["classifier:error"],
      error: "classifier_failed: " + err.message,
    };
  }
}
