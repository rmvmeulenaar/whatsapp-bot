const ESCALATION_PATTERNS = [
  /\b(klacht|niet tevreden|niet blij|probleem|problemen)\b/i,
  /\b(medisch|arts|dokter|bijwerking|pijn|pijnklacht|complicatie)\b/i,
  /\b(zwanger|allergie|medicijn|medicatie|bloedverdunner)\b/i,
  /\b(complaint|issue|problem|not happy|unhappy)\b/i,
  /\b(urgent|spoed|nood)\b/i,
  /\b(diagnose|contra-indicatie)\b/i,
];

const BOOKING_PATTERNS = [
  /\b(afspraak maken|afspraak plannen|afspraak boeken|afspraak inplannen)\b/i,
  /\b(wil (een )?(afspraak|langskomen|boeken|inplannen))\b/i,
  /\b(wanneer kan ik|wanneer ben je|beschikbaar)\b/i,
  /\b(book|appointment|schedule)\b/i,
  /\b(inschrijven|aanmelden)\b/i,
];

export function classifyIntent(text) {
  if (!text || typeof text !== "string") return "qa";

  // Check escalation first (higher priority)
  for (const p of ESCALATION_PATTERNS) {
    if (p.test(text)) return "escalation";
  }
  // Then booking
  for (const p of BOOKING_PATTERNS) {
    if (p.test(text)) return "booking";
  }
  return "qa"; // default
}
