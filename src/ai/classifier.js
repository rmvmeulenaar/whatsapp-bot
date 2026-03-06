const ROOD_PATTERNS = [
  /\b(medisch|medicijn|medicatie|medicaties)\b/i,
  /\b(pijn|pijnlijk|pijnklacht)\b/i,
  /\b(bijwerking|bijwerkingen|complicatie|complicaties)\b/i,
  /\b(allergie|allergisch|allergisch?e reactie)\b/i,
  /\b(zwanger|zwangerschap|borstvoeding)\b/i,
  /\b(klacht|klachten|probleem|problemen)\b/i,
  /\b(contra-indicatie|gecontraindiceerd)\b/i,
  /\b(bloedverdunner|bloedverdunners)\b/i,
  /\b(diagnose|diagnoses)\b/i,
  /\b(huil|verdriet|angstig|bang|stress)\b/i,
  /\b(urgent|spoed|nood|noodgeval)\b/i,
];

const GEEL_PATTERNS = [
  /\b(wat raden jullie aan|welke behandeling)\b/i,
  /\btwijfel(?: ik)? tussen\b/i,
  /\bhetzelfde als vorige keer\b/i,
  /\b(advies|adviseer)\b/i,
  /\b(geschikt|geschiktheid)\b/i,
  /\bkan ik (?:ook|zowel)\b/i,
  /\bwil graag weten of\b/i,
  /\bwat is het verschil tussen\b/i,
];

export function classifyInbound(text) {
  if (!text || typeof text !== "string") return { classification: "GROEN", reason: "empty_input" };

  for (const p of ROOD_PATTERNS) {
    if (p.test(text)) return { classification: "ROOD", reason: "medical_or_complaint_pattern" };
  }
  for (const p of GEEL_PATTERNS) {
    if (p.test(text)) return { classification: "GEEL", reason: "advice_or_treatment_question" };
  }
  return { classification: "GROEN", reason: "logistical_or_public_info" };
}
