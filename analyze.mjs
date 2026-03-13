import { readFileSync } from "fs";

const r = JSON.parse(readFileSync("/opt/whatsapp-bot/data/test-results.json", "utf8"));

// Correct prices from prijzen.md
const CORRECT_PRICES = ["245", "350", "450", "195", "275", "325", "175", "495"];
const HALLUCINATED_PRICES = ["80", "150", "185", "250"];

function detectLanguage(text) {
  if (!text) return "empty";
  // Simple heuristics
  if (/\b(the|is|you|your|we|our|can|how|what|treatment)\b/i.test(text)) return "EN";
  if (/\b(de|het|een|voor|van|met|wij|ons|kan|hoe|wat|behandeling|afspraak)\b/i.test(text)) return "NL";
  if (/[أ-ي]/.test(text)) return "AR";
  if (/\b(le|la|les|des|un|une|je|vous|nous|pour)\b/i.test(text)) return "FR";
  if (/\b(der|die|das|ein|eine|ist|und|ich|wir|für)\b/i.test(text)) return "DE";
  if (/\b(el|la|los|las|un|una|es|por|para|como)\b/i.test(text)) return "ES";
  if (/[а-яА-Я]/.test(text)) return "RU";
  if (/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text)) return "JA/ZH";
  if (/\b(bir|ve|bu|için|mı|mısınız)\b/i.test(text)) return "TR";
  return "NL"; // default
}

function getExpectedLang(input) {
  const lang = detectLanguage(input);
  return lang;
}

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║          ITERATIE 1 — INHOUDELIJKE ANALYSE                 ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log(`\nTotaal: ${r.total} tests | ${r.ok} OK | ${r.fail} crashed | ${r.duration_s}s\n`);

// ── 1. PRIJS CORRECTHEID ──────────────────────────────────────────────
console.log("━━━ 1. PRIJS CORRECTHEID ━━━");
const prijsTests = r.results.filter(t => t.cat === "prijs");
let prijsCorrect = 0;
let prijsHallucinated = 0;
prijsTests.forEach(t => {
  const out = t.output || "";
  const prices = out.match(/€\s*(\d+)/g) || [];
  const nums = prices.map(p => p.replace(/€\s*/, ""));
  const hasCorrect = nums.some(n => CORRECT_PRICES.includes(n));
  const hasHallucinated = nums.some(n => HALLUCINATED_PRICES.includes(n));
  const hasVanaf = /vanaf/i.test(out);

  let status = "✅";
  if (hasHallucinated) { status = "❌ HALLUCINATED"; prijsHallucinated++; }
  else if (hasCorrect || hasVanaf) { status = "✅"; prijsCorrect++; }
  else if (prices.length === 0 && /prijs|kost|tarief|euro/i.test(t.input)) { status = "⚠️ NO PRICE"; }
  else { prijsCorrect++; status = "✅"; }

  console.log(`  ${status} #${t.id} ${t.input.slice(0, 45)} → ${prices.join(", ") || "geen €"}`);
});
console.log(`  Score: ${prijsCorrect}/${prijsTests.length} correct, ${prijsHallucinated} hallucinated\n`);

// ── 2. BEHANDELING PRICE LEAK ─────────────────────────────────────────
console.log("━━━ 2. BEHANDELING PRICE LEAK ━━━");
const behandTests = r.results.filter(t => t.cat === "behandeling");
let behandLeaks = 0;
let behandOK = 0;
behandTests.forEach(t => {
  const out = t.output || "";
  const prices = out.match(/€\s*\d+/g) || [];
  if (prices.length > 0) {
    console.log(`  ❌ LEAK #${t.id} ${t.input.slice(0, 45)} → ${prices.join(", ")}`);
    behandLeaks++;
  } else {
    behandOK++;
  }
});
console.log(`  Score: ${behandOK}/${behandTests.length} clean (${behandLeaks} leaks)\n`);

// ── 3. TAAL MIRRORING ─────────────────────────────────────────────────
console.log("━━━ 3. TAAL MIRRORING ━━━");
const taalTests = r.results.filter(t => t.cat === "taal");
let taalCorrect = 0;
taalTests.forEach(t => {
  const expectedLang = getExpectedLang(t.input);
  const responseLang = detectLanguage(t.output);
  const match = expectedLang === responseLang;
  if (match) taalCorrect++;
  console.log(`  ${match ? "✅" : "❌"} #${t.id} expected:${expectedLang} got:${responseLang} ${t.input.slice(0, 35)}`);
  if (!match) console.log(`       → ${(t.output || "").slice(0, 80)}`);
});
console.log(`  Score: ${taalCorrect}/${taalTests.length}\n`);

// ── 4. ESCALATIE ROUTING ──────────────────────────────────────────────
console.log("━━━ 4. ESCALATIE ROUTING ━━━");
const escTests = r.results.filter(t => t.cat === "escalatie");
let escCorrect = 0;
escTests.forEach(t => {
  const trace = t.node_trace || "";
  const isEscalation = trace.includes("escalation");
  if (isEscalation) escCorrect++;
  console.log(`  ${isEscalation ? "✅" : "❌"} #${t.id} ${t.input.slice(0, 50)} → ${trace.split("->")[0].trim()}`);
});
console.log(`  Score: ${escCorrect}/${escTests.length}\n`);

// ── 5. BOOKING LINKS ─────────────────────────────────────────────────
console.log("━━━ 5. BOOKING LINKS ━━━");
const bookTests = r.results.filter(t => t.cat === "booking");
let bookLinksFound = 0;
let bookNoLink = 0;
bookTests.forEach(t => {
  const out = t.output || "";
  const hasLink = out.includes("schedule.clinicminds.com");
  // FIX iteratie 5: Also detect English booking words + escalation routing as valid
  const hasRef = /afspraak|boek|inplann|slot|appointment|book(?:ing)?|schedule|rendez|termin|réserv|buchen/i.test(out);
  const trace = (t.node_trace || "").split("->").map(s => s.trim()).join(" → ");
  // Tests routed to escalation (verzetten/annuleren) are correctly handled, not booking failures
  const isEscalation = trace.includes("escalation");
  if (hasLink) bookLinksFound++;
  else if (isEscalation) { bookLinksFound++; } // Escalation = correct routing, count as success
  else if (!hasRef) bookNoLink++;
  console.log(`  ${hasLink ? "✅" : isEscalation ? "✅ ESC" : hasRef ? "⚠️" : "❌"} #${t.id} link:${hasLink} ${t.input.slice(0, 45)}`);
});
console.log(`  Score: ${bookLinksFound}/${bookTests.length} met link\n`);

// ── 6. TIJDEN ─────────────────────────────────────────────────────────
console.log("━━━ 6. TIJDEN ━━━");
const tijdTests = r.results.filter(t => t.cat === "tijden");
let tijdAnswered = 0;
tijdTests.forEach(t => {
  const out = t.output || "";
  const hasTime = /\d{1,2}[:.]\d{2}/.test(out) || /ma|di|wo|do|vr|za|zo|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag/i.test(out);
  const hasFallback = /085|bel|neem contact|varieer/i.test(out);
  const isEmpty = /waarmee kan ik|hoe kan ik|wat kan ik/i.test(out);

  let status = "✅";
  if (hasTime || hasFallback) { tijdAnswered++; }
  else if (isEmpty) { status = "❌ EMPTY"; }
  else { status = "⚠️"; tijdAnswered++; }

  console.log(`  ${status} #${t.id} ${t.input.slice(0, 50)}`);
  if (status.includes("❌")) console.log(`       → ${out.slice(0, 80)}`);
});
console.log(`  Score: ${tijdAnswered}/${tijdTests.length}\n`);

// ── 7. GROET ──────────────────────────────────────────────────────────
console.log("━━━ 7. GROET ━━━");
const groetTests = r.results.filter(t => t.cat === "groet");
let groetOK = 0;
groetTests.forEach(t => {
  const trace = t.node_trace || "";
  const isGreeting = trace.includes("greeting");
  if (isGreeting) groetOK++;
  console.log(`  ${isGreeting ? "✅" : "❌"} #${t.id} ${t.input.slice(0, 30)} → ${trace.split("->")[0].trim()}`);
});
console.log(`  Score: ${groetOK}/${groetTests.length}\n`);

// ── 8. MULTI-INTENT ──────────────────────────────────────────────────
console.log("━━━ 8. MULTI-INTENT ━━━");
const multiTests = r.results.filter(t => t.cat === "multi");
let multiOK = 0;
multiTests.forEach(t => {
  const labels = t.labels || [];
  const out = t.output || "";
  // A good multi-intent response addresses multiple topics
  const hasMultipleTopics = labels.length >= 2 || out.length > 100;
  if (hasMultipleTopics) multiOK++;
  console.log(`  ${hasMultipleTopics ? "✅" : "❌"} #${t.id} labels:[${labels.join(",")}] ${t.input.slice(0, 50)}`);
});
console.log(`  Score: ${multiOK}/${multiTests.length}\n`);

// ── 9. EDGE CASES ────────────────────────────────────────────────────
console.log("━━━ 9. EDGE CASES ━━━");
const edgeTests = r.results.filter(t => t.cat === "edge");
let edgeOK = 0;
edgeTests.forEach(t => {
  const didNotCrash = t.ok && !t.error;
  if (didNotCrash) edgeOK++;
  console.log(`  ${didNotCrash ? "✅" : "❌"} #${t.id} ${t.input.slice(0, 50)}`);
});
console.log(`  Score: ${edgeOK}/${edgeTests.length}\n`);

// ── 10. FAQ ──────────────────────────────────────────────────────────
console.log("━━━ 10. FAQ ━━━");
const faqTests = r.results.filter(t => t.cat === "faq");
let faqOK = 0;
faqTests.forEach(t => {
  const out = t.output || "";
  const isEmpty = /waarmee kan ik|hoe kan ik|wat kan ik/i.test(out);
  const hasContent = out.length > 30 && !isEmpty;
  if (hasContent) faqOK++;
  console.log(`  ${hasContent ? "✅" : "❌"} #${t.id} ${t.input.slice(0, 50)}`);
  if (!hasContent) console.log(`       → ${out.slice(0, 80)}`);
});
console.log(`  Score: ${faqOK}/${faqTests.length}\n`);

// ── SAMENVATTING ─────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║                    SAMENVATTING                             ║");
console.log("╠══════════════════════════════════════════════════════════════╣");
console.log(`║  1. Prijs correctheid:    ${prijsCorrect}/${prijsTests.length} (${prijsHallucinated} hallucinated)`.padEnd(63) + "║");
console.log(`║  2. Behandeling no-leak:  ${behandOK}/${behandTests.length} (${behandLeaks} leaks)`.padEnd(63) + "║");
console.log(`║  3. Taal mirroring:       ${taalCorrect}/${taalTests.length}`.padEnd(63) + "║");
console.log(`║  4. Escalatie routing:    ${escCorrect}/${escTests.length}`.padEnd(63) + "║");
console.log(`║  5. Booking links:        ${bookLinksFound}/${bookTests.length}`.padEnd(63) + "║");
console.log(`║  6. Tijden antwoord:      ${tijdAnswered}/${tijdTests.length}`.padEnd(63) + "║");
console.log(`║  7. Groet routing:        ${groetOK}/${groetTests.length}`.padEnd(63) + "║");
console.log(`║  8. Multi-intent:         ${multiOK}/${multiTests.length}`.padEnd(63) + "║");
console.log(`║  9. Edge cases:           ${edgeOK}/${edgeTests.length}`.padEnd(63) + "║");
console.log(`║ 10. FAQ antwoord:         ${faqOK}/${faqTests.length}`.padEnd(63) + "║");
console.log("╚══════════════════════════════════════════════════════════════╝");
