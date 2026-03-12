import { getPendingBooking } from "../../dashboard/db.js";

// Greeting patterns — returns fixed text, no LLM call needed.
const GREETING_PATTERNS = [
  /^(hallo|hi|hey|hoi|yo|dag)\b/i,
  /^goede(morgen|middag|avond)/i,
  /^(good morning|good afternoon|good evening|hello)\b/i,
  // BUG-06 FIX: Arabic, Turkish, French greetings
  /^(مرحبا|مرحباً|السلام|اهلا|أهلاً)\b/,
  /^(merhaba|selam|günaydın|iyi günler)\b/i,
  /^(bonjour|salut|bonsoir|allô)\b/i,
];

// FIX: Acknowledgment patterns — short positive responses, no LLM needed
// BUG-06 FIX: Added multilingual acknowledgment patterns
const ACKNOWLEDGMENT_PATTERNS = [
  /^(bedankt|dank ?je ?wel|dank ?u ?wel|thanks|thank you|merci|danke)\b/i,
  /^(ok[eé]?|oke|oké|okay|top|prima|super|fijn|goed|cool|nice)\b/i,
  /^(👍|👌|🙏|😊|💪|✅|❤️|♥️)$/,
  /^(perfect|geweldig|fantastisch|mooi|helemaal goed)\b/i,
  /^(is goed|goed zo|alles duidelijk|duidelijk)\b/i,
  // BUG-10 FIX: Multilingual acknowledgments
  /^(شكرا|شكراً|merci|teşekkür|gracias|grazie)\b/i,
];

const KEYWORD_MAP = {
  prijs:      [/(?:wat |hoe ?veel |hoeveel )?(kost|prijs|tarief|euro|€)/i, /price|cost|how much/i],
  vestiging:  [/(?:waar |adres|locatie|vestiging|parkeer)/i, /(?:amsterdam|nijmegen|utrecht|eindhoven|den ?haag|rotterdam)/i, /location|address|where/i],
  tijden:     [/(?:open(?:ings)?(?:tijden)?|wanneer open|sluit|gesloten|tot hoe laat)/i, /(?:opening hours|when.*open|closed)/i],
  behandeling:[/(?:behandeling|wat is|hoe werkt|informatie over|info over)/i, /(?:botox|filler|lip|peel|laser|microneedling|prp|thread)/i, /treatment|procedure|what is/i],
  faq:        [/(?:hoe lang|resultaat|verdov|herstel|na ?zorg)/i, /(?:how long|result|recovery|aftercare)/i],
  booking:    [/(?:afspraak|boek|inplannen|reserv)/i, /(?:appointment|book|schedule)/i],
  // Escalation patterns — Iteratie 4: EXPANDED for comprehensive coverage
  escalation: [
    // Direct complaint words
    /(?:klacht|niet tevreden|probleem)\b/i,
    // "Ik heb/krijg/voel" + medical issue
    /\b(?:ik heb|ik krijg|ik voel)\b.{0,30}\b(?:pijn|complicatie|bijwerking)/i,
    // "Na behandeling" + symptoms
    /\bna (?:de |mijn )?\bbehandeling\b.{0,30}\b(?:pijn|zwelling|blauwe plek)/i,
    // Medical contraindications (always escalate)
    /\b(?:zwanger|zwangerschap|borstvoeding)\b/i,
    // Allergy — FIX: removed "voor/tegen/op" requirement
    /\b(?:allergie|allergisch)\b/i,
    // Medication use
    /\b(?:bloedverdunner|medicijn|medicatie)\b.{0,20}\b(?:gebruik|slik|neem)/i,
    // English complaints
    /(?:complaint|problem|complication|side effect)\b/i,
    // "Want to speak to someone" — FIX: added arts/dokter
    /(?:medewerker|iemand spreken|mens|persoon|arts|dokter)\b.{0,20}(?:spreken|praten|bellen)/i,
    /\bwil.{0,15}(?:medewerker|mens|persoon|iemand|arts|dokter)\b/i,
    // Appointment changes
    /\b(?:verzetten|verplaatsen|annuleren|afzeggen|cancel)\b/i,
    // Urgency
    /\b(?:urgent|spoed|noodgeval|emergency)\b/i,
    // English "speak to" patterns
    /\bneed.{0,20}(?:speak|talk|doctor|urgent)/i,
    /\b(?:speak|talk).{0,20}(?:doctor|someone|human|person)/i,
    // ── FIX iteratie 4: Additional escalation triggers ──
    // Something went wrong
    /\b(?:misgegaan|fout\s*gegaan|mislukt)\b/i,
    // Money back
    /\bgeld\s*terug\b/i,
    // Asymmetry / visual issues after treatment
    /\b(?:scheef|asymmetrisch|ongelijk)\b/i,
    // Legal / liability
    /\b(?:schadeclaim|aansprakelijk)\b/i,
    // Not satisfied with result
    /\bbevalt.{0,20}niet\b/i,
    // Lumps / bumps after filler
    /\bbult(?:je|en)?\b/i,
    // Standalone complication/side effect words (without "ik heb" prefix)
    /\b(?:complicatie|bijwerking)s?\b/i,
    // Allergic reaction (compound phrase)
    /\ballergische?\s*reactie\b/i,
  ],
};

export async function routerNode(state) {
  const text = state.body;
  const lower = text.toLowerCase().trim();

  // BUG-10 FIX: History is available via state.history for context
  const history = state.history ?? [];

  // 1. Greeting check (fast, deterministic, no LLM)
  for (const p of GREETING_PATTERNS) {
    if (p.test(lower) || p.test(text)) {
      return {
        intent: { labels: ["groet"], confidence: 1.0, method: "keyword", routing: "greeting" },
        node_trace: ["router:greeting"],
      };
    }
  }

  // 1b. FIX: Acknowledgment check — short thank-you/ok responses
  for (const p of ACKNOWLEDGMENT_PATTERNS) {
    if (p.test(lower) || p.test(text)) {
      return {
        intent: { labels: ["acknowledgment"], confidence: 1.0, method: "keyword", routing: "greeting" },
        node_trace: ["router:acknowledgment"],
      };
    }
  }

  // 2. Keyword matching — collect ALL matching labels
  const matched = [];
  for (const [label, patterns] of Object.entries(KEYWORD_MAP)) {
    for (const p of patterns) {
      if (p.test(lower)) {
        matched.push(label);
        break;
      }
    }
  }

  // 3. No matches → fall through to classifier
  if (matched.length === 0) {
    return {
      intent: { labels: [], confidence: 0, method: "none", routing: "classifier" },
      node_trace: ["router:no_match"],
    };
  }

  // 4. FIX: Escalation ALWAYS wins — even over pending booking
  if (matched.includes("escalation")) {
    return {
      intent: { labels: ["escalation"], confidence: 0.95, method: "keyword", routing: "escalation" },
      node_trace: ["router:escalation"],
    };
  }

  // 5. Pending booking check — only AFTER escalation is ruled out
  const pending = getPendingBooking(state.jid);
  if (pending) {
    return {
      intent: { labels: ["booking"], confidence: 0.95, method: "pending_booking", routing: "content" },
      node_trace: ["router:pending_booking"],
    };
  }

  // 6. Normal content routing
  return {
    intent: { labels: matched.filter(l => l !== "escalation"), confidence: 0.9, method: "keyword", routing: "content" },
    node_trace: ["router:keyword"],
  };
}
