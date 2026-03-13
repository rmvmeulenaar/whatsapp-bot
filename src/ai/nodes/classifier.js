import { generateReply } from "../engine.js";
import { getHistory } from "../history.js";

// BUG-07 FIX: Added "off_topic" to valid labels
const VALID_LABELS = ["prijs", "vestiging", "tijden", "behandeling", "faq", "booking", "off_topic"];

const CLASSIFIER_PROMPT = `Je bent een intent classifier voor een kliniek WhatsApp bot.
Classificeer het bericht. Geef 1, 2 of maximaal 3 categorieen als het bericht meerdere onderwerpen heeft.

Categorieen: prijs, vestiging, tijden, behandeling, faq, booking, off_topic

- prijs: vragen over kosten, tarieven, prijzen
- vestiging: vragen over locatie, adres, parkeren, welke stad
- tijden: openingstijden, wanneer open/gesloten
- behandeling: informatie over behandelingen, hoe werkt het, resultaten, herstel
- faq: algemene vragen, nazorg, contra-indicaties, combinaties
- booking: afspraak maken, inplannen, reserveren, wanneer kan ik komen
- off_topic: bericht gaat NIET over de kliniek of behandelingen

VOORBEELDEN (correct):
Klant: "Wat kost botox in nijmegen?"
→ {"labels": ["prijs", "vestiging"], "confidence": 0.95}

Klant: "Kan ik morgen botox in Nijmegen, wat kost dat?"
→ {"labels": ["behandeling", "vestiging", "prijs"], "confidence": 0.92}

Klant: "Wanneer jullie open en hoe maak ik een afspraak?"
→ {"labels": ["tijden", "booking"], "confidence": 0.90}

Klant: "Hoe gaat het nu eigenlijk?"
→ {"labels": ["off_topic"], "confidence": 0.95}

Klant: "Botox na filler? Wat zijn de risicos?"
→ {"labels": ["faq", "behandeling"], "confidence": 0.88}

Antwoord ALLEEN met geldige JSON:
- 1 intent: {"labels": ["prijs"], "confidence": 0.95}
- 2 intents: {"labels": ["prijs", "vestiging"], "confidence": 0.88}
- 3 intents: {"labels": ["behandeling", "vestiging", "prijs"], "confidence": 0.92}

Eerste label = hoogste prioriteit. Max 3 labels. Geen uitleg, alleen JSON.
Bij lage confidence (<0.5): zet "faq" als laatste label als fallback.`;

export async function classifierNode(state) {
  try {
    const history = getHistory(state.jid);
    const result = await generateReply(CLASSIFIER_PROMPT, history.slice(-6), state.body, 0);

    // BUG-07 FIX: Fallback is now "off_topic" instead of "faq"
    let parsed = { labels: ["off_topic"], confidence: 0.3 };
    try {
      const raw = result.text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
      parsed = JSON.parse(raw);
    } catch { /* fallback to off_topic */ }

    const labels = (parsed.labels ?? ["off_topic"])
      .filter(l => VALID_LABELS.includes(l))
      .slice(0, 3);
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
