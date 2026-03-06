const INJECTION_PATTERNS = [
  /ignore (previous|all|above|your) instructions/i,
  /forget (your|the) (system|previous|instructions)/i,
  /you are now/i, /act as (a|an)/i, /jailbreak/i,
  /pretend (you are|to be)/i, /disregard (your|all|the)/i,
  /negeer (je|de|al je|alle) instructies/i,
  /doe alsof je/i, /stel je voor dat je/i,
];

const MEDICAL_PATTERNS = [
  /(niet geschikt|gecontra-indiceerd|contra-indicatie)/i,
  /(allergie|allergisch)/i, /(bijwerking|complicatie)/i,
  /(diagnose|medisch advies)/i, /(bloedverdunner|medicijn|medicatie)/i,
  /(zwanger|zwangerschap|borstvoeding)/i,
  /(contraindicated|side effect|complication|medical advice)/i,
  /ik raad (aan|af)/i,
];

const IDENTITY_CLAIM_PATTERNS = [
  /ik ben (een )?(arts|dokter|verpleeg|dermato|cosmetisch chirurg)/i,
  /mijn naam is (rogier|moumen|romy|medewerker)/i,
  /i am (a |the )?(doctor|physician|nurse|surgeon)/i,
  /als (uw|je) arts/i,
];

const MAX_REPLY_LENGTH = 600;

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

  // Layer 2: Medical content in reply
  for (const p of MEDICAL_PATTERNS) {
    if (p.test(text)) return { pass: false, classification: "ROOD", reason: "medical_content", text };
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
    return { pass: false, classification: "GEEL", reason: "too_long", text: text.slice(0, MAX_REPLY_LENGTH) + "…" };
  }

  return { pass: true, classification: "GROEN", reason: null, text };
}
