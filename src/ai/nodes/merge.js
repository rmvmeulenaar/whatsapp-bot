const LABEL_PRIORITY = ["prijs", "vestiging", "tijden", "behandeling", "faq", "bookingLink"];

// FIX: Drop generic non-answers that add no value
// Iteratie 3: Also match "Hoi! Waarmee..." and "Hi! How can I..." prefixed variants
const EMPTY_PATTERNS = [
  // Direct matches
  /^waarmee kan ik je helpen/i,
  /^hoe kan ik je helpen/i,
  /^wat kan ik voor je doen/i,
  /^waar kan ik je mee helpen/i,
  /^how can i help/i,
  /^what can i do for you/i,
  // With greeting prefix (Hoi!, Hi!, Hello!, Hey!, etc.)
  /^(?:hoi|hi|hello|hey|hallo)!?\s*(?:waarmee|hoe|wat|waar)\s*kan ik/i,
  /^(?:hoi|hi|hello|hey|hallo)!?\s*(?:how can i|what can i)/i,
  // With "— Molty" suffix variations
  /^(?:hoi|hi|hello|hey|hallo)!?\s*waarmee kan ik je helpen\??\s*(?:—|-)?\s*molty/i,
];

function isEmptyResponse(text) {
  if (!text || text.trim().length < 10) return true;
  const trimmed = text.trim();
  return EMPTY_PATTERNS.some(p => p.test(trimmed));
}

// BUG-04 FIX: Strip CONFIDENCE: HOOG/MIDDEL/LAAG from LLM output before sending to client
function stripConfidence(text) {
  if (!text) return text;
  return text.replace(/\s*CONFIDENCE:\s*(HOOG|MIDDEL|LAAG)[^\n]*/gi, "").trim();
}

export async function mergeNode(state) {
  const results = state.results ?? [];
  if (results.length === 0) {
    return { output: null, node_trace: ["merge:empty"] };
  }

  // FIX: Filter out empty/generic responses before merging
  const sorted = [...results]
    .filter(r => r.text && !isEmptyResponse(r.text))
    .sort((a, b) => LABEL_PRIORITY.indexOf(a.node) - LABEL_PRIORITY.indexOf(b.node));

  // FIX iteratie 4: Return fallback instead of null when all responses were generic
  if (sorted.length === 0) {
    const lang = state.language ?? "nl";
    const fallback = lang !== "nl"
      ? "I don't have that information readily available. Please call us at 085-4013678 or email info@radianceclinic.nl."
      : "Dat heb ik niet direct beschikbaar. Neem gerust contact op via 085-4013678 of mail naar info@radianceclinic.nl.";
    return {
      output: fallback,
      node_trace: ["merge:fallback"],
    };
  }

  // BUG-04 FIX: Strip confidence markers before joining
  const output = sorted.map(r => stripConfidence(r.text)).join("\n\n");

  return {
    output: output || null,
    node_trace: ["merge:done:" + sorted.map(r => r.node).join("+")],
  };
}
