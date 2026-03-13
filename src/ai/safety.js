const INJECTION_PATTERNS = [
  /ignore (previous|all|above|your) instructions/i,
  /forget (your|the) (system|previous|instructions)/i,
  /you are now/i, /act as (a|an)/i, /jailbreak/i,
  /pretend (you are|to be)/i, /disregard (your|all|the)/i,
  /negeer (je|de|al je|alle) instructies/i,
  /doe alsof je/i, /stel je voor dat je/i,
];

// BUG 6 FIX: Medical patterns now require ADVISORY context, not just keyword presence.
// "Botox is niet pijnlijk" = GROEN (informational), "Ik raad paracetamol aan" = ROOD (advice).
const MEDICAL_ADVICE_PATTERNS = [
  /ik raad (aan|af)/i,
  /je (moet|zou|kunt het beste)\b.{0,40}\b(nemen|gebruiken|stoppen|slikken|smeren)/i,
  /niet geschikt voor (jou|u|mensen met)/i,
  /gecontra-indiceerd/i,
  /contra-indicatie voor (jou|u|jouw)/i,
  /je hebt waarschijnlijk.{0,30}(nodig|last van)/i,
  /diagnose.{0,20}(is|lijkt|zou kunnen)/i,
  /dit (medicijn|medicatie) (helpt|werkt|is geschikt)/i,
  /ik (stel|adviseer|schrijf).{0,20}(voor|aan)/i,
];

const IDENTITY_CLAIM_PATTERNS = [
  /ik ben (een )?(arts|dokter|verpleeg|dermato|cosmetisch chirurg)/i,
  /mijn naam is (rogier|moumen|romy|medewerker)/i,
  /i am (a |the )?(doctor|physician|nurse|surgeon)/i,
  /als (uw|je) arts/i,
];

// BUG 7 FIX: Increased from 600 to 1500. LLM max_tokens=350 already limits output.
// Multi-label answers (prijs + booking) and slot lists need more room.
const MAX_REPLY_LENGTH = 1500;

export function validateOutput(proposedReply, inboundText, priceWhitelist = []) {
  if (!proposedReply || typeof proposedReply !== "string") {
    return { pass: false, classification: "ROOD", reason: "empty_reply", text: "" };
  }
  const text = proposedReply.trim();

  // Layer 1: Injection in reply OR inbound
  for (const p of INJECTION_PATTERNS) {
    if (p.test(text)) return { pass: false, classification: "ROOD", reason: "injection_in_reply", text };
    if (p.test(inboundText)) return { pass: false, classification: "ROOD", reason: "injection_attempt", text };
  }

  // Layer 2: Medical ADVICE in reply (not mere mention of medical words)
  for (const p of MEDICAL_ADVICE_PATTERNS) {
    if (p.test(text)) return { pass: false, classification: "ROOD", reason: "medical_advice", text };
  }

  // Layer 3: Identity claim in reply
  for (const p of IDENTITY_CLAIM_PATTERNS) {
    if (p.test(text)) return { pass: false, classification: "ROOD", reason: "identity_claim", text };
  }

  // Layer 4: Price whitelist check
  const priceMatches = text.match(/(?:€|euro)\s*(\d+)/gi) ?? [];
  for (const match of priceMatches) {
    const amount = parseInt(match.replace(/\D/g, ""), 10);
    const hasVanaf = new RegExp(`vanaf.{0,15}${amount}`, "i").test(text);
    const inWhitelist = Array.isArray(priceWhitelist) ? priceWhitelist.includes(amount) : priceWhitelist.has(amount);
    if (!hasVanaf && !inWhitelist) {
      return { pass: false, classification: "GEEL", reason: "price_not_in_whitelist", text };
    }
  }

  // Layer 5: Length
  if (text.length > MAX_REPLY_LENGTH) {
    return { pass: false, classification: "GEEL", reason: "too_long", text: text.slice(0, MAX_REPLY_LENGTH) + "\u2026" };
  }

  return { pass: true, classification: "GROEN", reason: null, text };
}
