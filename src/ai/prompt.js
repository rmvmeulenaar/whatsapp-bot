import { readFileSync } from "fs";
import { db } from "../dashboard/db.js";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";

function getBotIdentiteit() {
  try {
    return readFileSync(`${KENNIS_DIR}/bot-identiteit.md`, "utf8");
  } catch {
    return "Je bent Molty, digitale assistent voor PVI en Radiance Clinic.";
  }
}

// Iteratie 3: Specific language names for targeted instruction
const LANG_NAMES = {
  nl: "Nederlands",
  en: "Engels (English)",
  de: "Duits (Deutsch)",
  fr: "Frans (Français)",
  es: "Spaans (Español)",
  ar: "Arabisch (العربية)",
  tr: "Turks (Türkçe)",
  ru: "Russisch (Русский)",
  ja: "Japans (日本語)",
  zh: "Chinees (中文)",
  it: "Italiaans (Italiano)",
  pt: "Portugees (Português)",
  ko: "Koreaans (한국어)",
  pl: "Pools (Polski)",
};


// Phase 10: node-aware few-shot cache (5-minute TTL per nodeLabel)
const _fewShotCache = new Map();

function buildFewShotExamples(nodeLabel) {
  if (!nodeLabel) return [];

  const cached = _fewShotCache.get(nodeLabel);
  if (cached && Date.now() - cached.ts < 300_000) return cached.examples;

  let approved = [], direct = [];
  try {
    // Approved Telegram-edits for this node type
    approved = db.prepare(`
      SELECT ps.inbound_message, ps.edited_message
      FROM pending_suggestions ps
      JOIN watch_entries w ON w.id = ps.watch_entry_id
      WHERE ps.status = 'approved'
        AND ps.edited_message IS NOT NULL
        AND (w.feedback IS NULL OR w.feedback != 'bad')
        AND w.intent LIKE ?
      ORDER BY ps.created_at DESC LIMIT 5
    `).all(`%${nodeLabel}%`);
  } catch {}

  try {
    // Moumen's direct WhatsApp replies via explicit watch_entry_id (no timestamp guessing)
    direct = db.prepare(`
      SELECT o.text as moumen_text, w.inbound as klant_text
      FROM outgoing_messages o
      JOIN watch_entries w ON w.id = o.watch_entry_id
      WHERE w.intent LIKE ?
        AND (w.feedback IS NULL OR w.feedback != 'bad')
      ORDER BY o.ts DESC LIMIT 3
    `).all(`%${nodeLabel}%`);
  } catch {}

  const examples = [
    ...approved.map(r => ({ klant: r.inbound_message, molty: r.edited_message })),
    ...direct.map(r => ({ klant: r.klant_text, molty: r.moumen_text }))
  ].filter(e => e.klant && e.molty).slice(0, 4);

  _fewShotCache.set(nodeLabel, { ts: Date.now(), examples });
  return examples;
}

/**
 * buildQAPrompt — Shared prompt builder for all content nodes.
 *
 * @param {object|null} patientContext  - Patient info from lookup
 * @param {string}      kennisBlock    - Kennis markdown to embed
 * @param {string}      language       - Detected language code (nl/en/etc)
 * @param {string|null} nodeName       - Calling node name (prijs/behandeling/tijden/vestiging/faq/bookingLink)
 */
export function buildQAPrompt(patientContext, kennisBlock, language = "nl", nodeName = null) {
  const patientLine = patientContext
    ? `De klant is bekend in ons systeem als ${patientContext.firstName ?? "klant"}. Vestiging: ${patientContext.location ?? "onbekend"}.`
    : "De klant is niet bekend in ons systeem (nieuwe klant of nummer niet gevonden).";

  // Iteratie 3: Targeted language instruction
  const isNL = !language || language === "nl";
  const langName = LANG_NAMES[language] ?? LANG_NAMES.nl;
  const langShort = langName.split(" (")[0]; // "Engels", "Duits", etc.

  let taalRegel;
  if (isNL) {
    taalRegel = `TAALREGEL: De klant schrijft Nederlands. Antwoord in het Nederlands.`;
  } else {
    taalRegel = `⚠️⚠️⚠️ TAALREGEL (VERPLICHT — HOOGSTE PRIORITEIT) ⚠️⚠️⚠️
De klant schrijft in het ${langName}.
Je MOET antwoorden in het ${langShort.toUpperCase()}.
❌ FOUT: antwoord in het Nederlands
✅ GOED: antwoord in het ${langShort.toUpperCase()}
De kennis hieronder is in het Nederlands, maar jij VERTAALT je antwoord naar het ${langShort}.`;
  }

  // Node-specific scope limitations
  let nodeScope = "";
  if (nodeName === "behandeling") {
    nodeScope = `
NODE-BEPERKING (behandeling)
- Je geeft ALLEEN informatie over wat de behandeling inhoudt, hoe het werkt, verwachte resultaten, en herstel/nazorg.
- Noem ABSOLUUT GEEN prijzen, €-bedragen, of "vanaf" prijzen. GEEN ENKELE PRIJS.
- Als de klant naar prijzen vraagt, zeg kort: "Voor actuele prijzen kijk ik even voor je, een moment."
- Focus op: wat het is, hoe het werkt, hoeveel sessies, resultaat, hersteltijd.
`;
  } else if (nodeName === "tijden") {
    nodeScope = `
NODE-BEPERKING (tijden)
- JE BENT HIER OM OPENINGSTIJDEN TE GEVEN. Dit is je ENIGE taak.
- ANTWOORD ALTIJD met concrete openingstijden. Zeg NOOIT alleen "Waarmee kan ik je helpen?" of andere generieke begroetingen.
- Bij een vage vraag zonder specifieke vestiging of kliniek:
  * Geef Radiance Clinic tijden: maandag t/m vrijdag 09:00-17:00, zaterdag op afspraak, zondag gesloten
  * Voeg toe: "Voor PVI openingstijden bel 085-4013678 (variëren per vestiging)."
- Bij een vraag over een specifieke vestiging: geef de tijden als ze in de kennis staan, anders: "Bel 085-4013678 voor de actuele tijden."
- Verzin GEEN openingstijden als ze niet in de kennis staan.
`;
  } else if (nodeName === "vestiging") {
    nodeScope = `
NODE-BEPERKING (vestiging)
- Je geeft ALLEEN informatie over locaties, adressen, en bereikbaarheid.
- Als het exacte adres niet in de kennis staat, verwijs naar de website of het telefoonnummer.
`;
  } else if (nodeName === "prijs") {
    nodeScope = `
NODE-BEPERKING (prijs)
- Je geeft prijsinformatie op basis van de kennisbestanden.
- Gebruik altijd "vanaf €X" formuleringen, nooit exacte garantieprijzen.
- Als een prijs niet in de kennis staat, zeg: "Die prijs heb ik niet direct beschikbaar, neem contact op voor een offerte."
`;
  }

  const taalHerinnering = isNL
    ? ""
    : `\n⚠️ HERINNERING: Antwoord in het ${langShort.toUpperCase()}, NIET in het Nederlands!`;

  const fewShotExamples = buildFewShotExamples(nodeName);
  const fewShotBlock = fewShotExamples.length > 0
    ? `\nVOORBEELDEN (echte reacties van Molty op dit type vraag — volg deze stijl):\n` +
      fewShotExamples.map(e =>
        `Klant: "${String(e.klant).slice(0,120)}"\nMolty: "${String(e.molty).slice(0,200)}"`
      ).join("\n\n") + "\n"
    : "";

  return `${taalRegel}

${getBotIdentiteit()}
${fewShotBlock}
KLANTCONTEXT
${patientLine}

KENNIS (gebruik ALLEEN deze informatie, verzin niets)
${kennisBlock}
${nodeScope}
BESLISBOOM (volg strikt)
GROEN — Zelf afhandelen: openingstijden, locatie/adres, behandelinfo op "vanaf-prijs" niveau, booking link sturen
GEEL — Doorverwijzen naar intake + Moumen: geschiktheid, behandelcombinaties, adviesvragen
ROOD — Alleen doorverwijzen, NIETS uitleggen: medisch advies, contra-indicaties, medicijnen, bijwerkingen, pijn, klachten

SCOPE (deze node)
MAG: Info uit kennisbestanden hierboven, "vanaf €X" prijzen, booking link aanbieden
MAG NIET: Exacte prijzen berekenen/beloven, medisch advies, behandelgeschiedenis openbaren die klant niet zelf noemde

HARDE REGELS
1. Geef NOOIT een exacte prijs — altijd "vanaf €X" of "prijzen op aanvraag"
2. Geef NOOIT medisch advies, diagnoses of contra-indicaties
3. Beweer NOOIT dat je een arts bent of een medewerker met naam
4. Ga NIET in op behandelgeschiedenis die klant niet zelf noemde (Spiegelregel)
5. Als informatie niet in de kennisbestanden staat: "Dat weet ik niet zeker, ik verbind je met een collega."
6. Rapporteer je confidence: HOOG (>0.8) / MIDDEL (0.5-0.8) / LAAG (<0.5)

FORMAT
- Max 3 zinnen tenzij klant expliciet meer vraagt
- Geen opsommingen tenzij duidelijker
- Gebruik emoji's ALLEEN als klant ze gebruikt
- Eindig niet met "Als u nog vragen heeft..." — te formeel
${taalHerinnering}
`;
}
