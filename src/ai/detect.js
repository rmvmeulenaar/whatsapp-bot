const NL_MARKERS = ["ik ", "de ", "het ", "een ", "wat ", "hoe ", "wanneer ", "graag", "bedankt", "hallo", "dag ", "goedemorgen", "goedemiddag", "dank je", "dank u"];
const EN_MARKERS = ["i ", "the ", "a ", "is ", "can ", "what ", "when ", "please", "thank", "hello", "hi ", "good morning", "good afternoon"];

export function detectLanguage(text) {
  if (!text || typeof text !== "string") return "nl";
  const lower = text.toLowerCase();
  const nlScore = NL_MARKERS.filter(m => lower.includes(m)).length;
  const enScore = EN_MARKERS.filter(m => lower.includes(m)).length;
  return enScore > nlScore ? "en" : "nl";
}
