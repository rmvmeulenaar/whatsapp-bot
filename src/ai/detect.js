// Iteratie 4: Full multi-language detection
// Replaces the old NL-vs-EN only detector

// ── Script-based detection (non-Latin scripts, highest confidence) ──────────

function detectByScript(text) {
  // Arabic script
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return "ar";
  // Cyrillic → Russian (most common Cyrillic language in NL)
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  // Japanese (Hiragana or Katakana present)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return "ja";
  // Chinese (CJK only, no Japanese kana)
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  // Korean (Hangul)
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(text)) return "ko";
  return null;
}

// ── Marker-based detection (Latin-script languages) ─────────────────────────

const LANG_MARKERS = {
  nl: [
    "ik ", "de ", "het ", "een ", "wat ", "hoe ", "wanneer ", "graag",
    "bedankt", "hallo", "dag ", "goedemorgen", "goedemiddag", "dank je",
    "dank u", "alstublieft", "welke", "voor ", "van ", "met ", "wij ",
    "ons ", "kan ik", "bij ", "ook ", "nog ", "naar ", "mijn ", "jullie",
  ],
  en: [
    "i ", "the ", "you ", "is ", "can ", "what ", "when ", "please",
    "thank", "hello", "how much", "where", "would", "could", "your ",
    "do you", "are you", "have you", "offer", "treatment", "book",
    "appointment", "price", "cost",
  ],
  de: [
    "ich ", "der ", "die ", "das ", "ein ", "eine ", "ist ", "und ",
    "für ", "wie ", "bitte", "guten ", "möchte", "haben", "können",
    "buchen", "termin", "kosten", "behandlung",
  ],
  fr: [
    "je ", "le ", "la ", "les ", "des ", "un ", "une ", "est ",
    "pour ", "bonjour", "merci", "rendez", "voudrais", "comment",
    "combien", "quel", "vous", "nous", "avec",
  ],
  es: [
    "el ", "la ", "los ", "las ", "una ", "es ", "por ", "para ",
    "hola", "cuánto", "cuanto", "quiero", "cómo", "como ", "dónde",
    "tiene", "puede", "botox", "precio",
  ],
  tr: [
    "bir ", " ve ", "bu ", "için ", " mı", "musunuz", "lütfen",
    "teşekkür", "merhaba", "nasıl", "kaç ", "randevu", "konuş",
  ],
  it: [
    "il ", " la ", "lo ", " un ", "una ", "che ", "per ", "come ",
    "quanto", "buongiorno", "grazie", "vorrei", "dove ", "prezzo",
  ],
  pt: [
    " o ", " a ", "os ", "as ", "um ", "uma ", "que ", "para ",
    "como ", "obrigado", "olá", "quanto", "onde ", "preço",
  ],
  pl: [
    "ja ", "to ", "jest ", "nie ", " na ", " co ", "jak ", "ile ",
    "gdzie ", "dzień dobry", "dziękuję", "proszę", "chcę",
  ],
};

export function detectLanguage(text) {
  if (!text || typeof text !== "string") return "nl";
  const lower = " " + text.toLowerCase() + " "; // pad for word boundary matching

  // 1. Script-based detection (non-Latin)
  const scriptLang = detectByScript(text);
  if (scriptLang) return scriptLang;

  // 2. Marker-based scoring for Latin-script languages
  const scores = {};
  for (const [lang, markers] of Object.entries(LANG_MARKERS)) {
    scores[lang] = markers.filter(m => lower.includes(m)).length;
  }

  // Find highest scoring language (NL is default/tiebreaker)
  let bestLang = "nl";
  let bestScore = scores.nl ?? 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (lang === "nl") continue;
    // Non-NL must score strictly higher to win (NL is default)
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  return bestLang;
}
