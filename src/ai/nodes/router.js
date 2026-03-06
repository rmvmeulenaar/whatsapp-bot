import { getPendingBooking } from "../../dashboard/db.js";

const KEYWORD_MAP = {
  prijs:      [/(?:wat |hoe ?veel |hoeveel )?(kost|prijs|tarief|euro|€)/i, /price|cost|how much/i],
  vestiging:  [/(?:waar |adres|locatie|vestiging|parkeer)/i, /(?:amsterdam|nijmegen|utrecht|eindhoven|den ?haag|rotterdam)/i, /location|address|where/i],
  tijden:     [/(?:open(?:ings)?(?:tijden)?|wanneer open|sluit|gesloten|tot hoe laat)/i, /(?:opening hours|when.*open|closed)/i],
  behandeling:[/(?:behandeling|wat is|hoe werkt|informatie over|info over)/i, /(?:botox|filler|lip|peel|laser|microneedling|prp|thread)/i, /treatment|procedure|what is/i],
  faq:        [/(?:hoe lang|resultaat|pijn|verdov|herstel|bijwerk|na ?zorg)/i, /(?:how long|result|pain|recovery|aftercare)/i],
  booking:    [/(?:afspraak|boek|inplannen|reserv)/i, /(?:appointment|book|schedule)/i],
  escalation: [/(?:klacht|niet tevreden|probleem|complicatie|bijwerking|arts|dokter)/i, /(?:zwanger|allergie|medicijn|medicatie|bloedverdunner)/i, /(?:complaint|problem|complication|side effect|doctor)/i, /(?:medewerker|iemand spreken|mens|persoon)/i],
};

export async function routerNode(state) {
  // Als er een lopende booking flow is, altijd naar booking routen
  const pending = getPendingBooking(state.jid);
  if (pending) {
    return {
      intent: { labels: ["booking"], confidence: 0.95, method: "pending_booking", routing: "content" },
      node_trace: ["router:pending_booking"],
    };
  }

  const text = state.body.toLowerCase();
  const matched = [];

  for (const [label, patterns] of Object.entries(KEYWORD_MAP)) {
    for (const p of patterns) {
      if (p.test(text)) {
        matched.push(label);
        break;
      }
    }
  }

  if (matched.length === 0) {
    return {
      intent: { labels: [], confidence: 0, method: "none", routing: "classifier" },
      node_trace: ["router:no_match"],
    };
  }

  if (matched.includes("escalation")) {
    return {
      intent: { labels: ["escalation"], confidence: 0.95, method: "keyword", routing: "escalation" },
      node_trace: ["router:escalation"],
    };
  }

  return {
    intent: { labels: matched.filter(l => l !== "escalation"), confidence: 0.9, method: "keyword", routing: "content" },
    node_trace: ["router:keyword"],
  };
}
