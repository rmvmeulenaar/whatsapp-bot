import { generateReply } from "../engine.js";
import { getHistory } from "../history.js";

// BUG-07 FIX: Added "off_topic" to valid labels
const VALID_LABELS = ["prijs", "vestiging", "tijden", "behandeling", "faq", "booking", "off_topic"];

const CLASSIFIER_PROMPT = `Je bent een intent classifier voor een kliniek WhatsApp bot.
Classificeer het bericht. Geef de 1 of 2 meest relevante categorieen.

Categorieen: prijs, vestiging, tijden, behandeling, faq, booking, off_topic

- prijs: vragen over kosten, tarieven, prijzen
- vestiging: vragen over locatie, adres, parkeren
- tijden: openingstijden, wanneer open/gesloten
- behandeling: informatie over behandelingen, hoe werkt het
- faq: algemene vragen, herstel, nazorg, resultaten
- booking: afspraak maken, inplannen, reserveren
- off_topic: bericht gaat niet over de kliniek, behandelingen, afspraken of gezondheidszorg

Antwoord ALLEEN met geldige JSON:
- 1 intent: {"labels": ["prijs"], "confidence": 0.95}
- 2 intents: {"labels": ["prijs", "vestiging"], "confidence": 0.88}

Eerste label = hoogste prioriteit. Max 2 labels. Geen uitleg, alleen JSON.`;

export async function classifierNode(state) {
  try {
    const history = getHistory(state.jid);
    const result = await generateReply(CLASSIFIER_PROMPT, history.slice(-4), state.body, 0);

    // BUG-07 FIX: Fallback is now "off_topic" instead of "faq"
    let parsed = { labels: ["off_topic"], confidence: 0.3 };
    try {
      const raw = result.text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
      parsed = JSON.parse(raw);
    } catch { /* fallback to off_topic */ }

    const labels = (parsed.labels ?? ["off_topic"])
      .filter(l => VALID_LABELS.includes(l))
      .slice(0, 2);
    // BUG-07 FIX: Fallback is off_topic instead of faq
    const finalLabels = labels.length ? labels : ["off_topic"];

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
      intent: { labels: ["off_topic"], confidence: 0.3, method: "llm_error" },
      node_trace: ["classifier:error"],
      error: "classifier_failed: " + err.message,
    };
  }
}
