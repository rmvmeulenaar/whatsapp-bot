/**
 * WhatsApp Bot — Test Suite v2
 *
 * Fixes van v1:
 * - Unieke JID per test (geen context bleeding)
 * - Clinic context instelbaar per test
 * - JSON output voor analyse
 * - Categorie-scoring
 *
 * Gebruik: node --env-file=.env test-bot-v2.mjs
 */

import { runGraph } from "/opt/whatsapp-bot/src/ai/graph.js";
import Database from "better-sqlite3";
import { writeFileSync } from "fs";

const DB_PATH = "/opt/whatsapp-bot/data/watch.db";
const OUTPUT_PATH = "/opt/whatsapp-bot/data/test-results.json";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeJid(id) {
  return `316TEST${String(id).padStart(4, "0")}@s.whatsapp.net`;
}

function setClinic(db, jid, clinic) {
  db.prepare(`
    INSERT OR REPLACE INTO conversations (jid, mode, clinic)
    VALUES (?, 'watch', ?)
  `).run(jid, clinic);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Test Scenarios ───────────────────────────────────────────────────────

const TESTS = [
  // ── BOOKING (1-30) ────────────────────────────────────────────────────
  // PVI booking (clinic set)
  { id: 1,  cat: "booking", clinic: "pvi", msg: "Ik wil een afspraak maken voor botox in Nijmegen" },
  { id: 2,  cat: "booking", clinic: "pvi", msg: "Kan ik een afspraak boeken voor fillers in Amsterdam?" },
  { id: 3,  cat: "booking", clinic: "pvi", msg: "Afspraak lip filler Utrecht" },
  { id: 4,  cat: "booking", clinic: "pvi", msg: "Ik wil botox in Den Haag, stuur me een link" },
  { id: 5,  cat: "booking", clinic: "pvi", msg: "Boeken voor jawline filler Rotterdam" },
  { id: 6,  cat: "booking", clinic: "pvi", msg: "I want to book Botox in Eindhoven" },
  { id: 7,  cat: "booking", clinic: "pvi", msg: "Stuur een boekingslink voor Maastricht" },
  { id: 8,  cat: "booking", clinic: "pvi", msg: "Hoe kan ik een afspraak inplannen?" },
  { id: 9,  cat: "booking", clinic: "pvi", msg: "Is er deze week nog een gaatje?" },
  { id: 10, cat: "booking", clinic: "pvi", msg: "Wil een afspraak, snel graag" },

  // Radiance booking
  { id: 11, cat: "booking", clinic: "radiance", msg: "Ik wil een afspraak boeken bij Radiance" },
  { id: 12, cat: "booking", clinic: "radiance", msg: "Consult inplannen voor longevity" },
  { id: 13, cat: "booking", clinic: "radiance", msg: "Kan ik een afspraak maken voor IV therapie?" },
  { id: 14, cat: "booking", clinic: "radiance", msg: "Boekingslink graag" },
  { id: 15, cat: "booking", clinic: "radiance", msg: "I want to book an appointment at Radiance" },

  // Booking zonder clinic (moet vragen welke kliniek)
  { id: 16, cat: "booking", clinic: null, msg: "Ik wil een afspraak maken" },
  { id: 17, cat: "booking", clinic: null, msg: "Stuur me een boekingslink" },
  { id: 18, cat: "booking", clinic: null, msg: "I want to book an appointment" },

  // Booking edge cases
  { id: 19, cat: "booking", clinic: "pvi", msg: "Kan ik mijn afspraak verzetten?" },
  { id: 20, cat: "booking", clinic: "pvi", msg: "Afspraak annuleren kan dat?" },
  { id: 21, cat: "booking", clinic: "pvi", msg: "Kan ik 's avonds terecht?" },
  { id: 22, cat: "booking", clinic: "pvi", msg: "Is er een wachtlijst?" },
  { id: 23, cat: "booking", clinic: "pvi", msg: "Kan ik bij u terecht voor mesotherapie?" },
  { id: 24, cat: "booking", clinic: "pvi", msg: "Vervolgafspraak nodig" },
  { id: 25, cat: "booking", clinic: "pvi", msg: "Book me in for next week please" },

  // ── PRIJS (26-50) ────────────────────────────────────────────────────
  { id: 26, cat: "prijs", clinic: "pvi",      msg: "Wat kost botox?" },
  { id: 27, cat: "prijs", clinic: "pvi",      msg: "Prijzen fillers?" },
  { id: 28, cat: "prijs", clinic: "pvi",      msg: "Hoeveel kost lip filler?" },
  { id: 29, cat: "prijs", clinic: "pvi",      msg: "Prijs jawline filler?" },
  { id: 30, cat: "prijs", clinic: "pvi",      msg: "Wat kost profhilo?" },
  { id: 31, cat: "prijs", clinic: "pvi",      msg: "Skin booster prijs?" },
  { id: 32, cat: "prijs", clinic: "pvi",      msg: "Wat kost 1 ml filler?" },
  { id: 33, cat: "prijs", clinic: "pvi",      msg: "Prijs voor neuscorrectie zonder operatie?" },
  { id: 34, cat: "prijs", clinic: "radiance", msg: "Wat kost een IV infuus?" },
  { id: 35, cat: "prijs", clinic: "radiance", msg: "Prijzen longevity behandelingen?" },
  { id: 36, cat: "prijs", clinic: "radiance", msg: "Hoeveel kost het afvaltraject?" },
  { id: 37, cat: "prijs", clinic: null,       msg: "Wat kost botox bij jullie?" },
  { id: 38, cat: "prijs", clinic: null,       msg: "Zijn er kortingen?" },
  { id: 39, cat: "prijs", clinic: null,       msg: "Worden behandelingen vergoed door de verzekering?" },
  { id: 40, cat: "prijs", clinic: "pvi",      msg: "What does botox cost?" },
  { id: 41, cat: "prijs", clinic: "pvi",      msg: "Hoeveel kost mesotherapie?" },
  { id: 42, cat: "prijs", clinic: "pvi",      msg: "Prijs PRP behandeling?" },
  { id: 43, cat: "prijs", clinic: "pvi",      msg: "Wat kost wallen behandeling?" },
  { id: 44, cat: "prijs", clinic: "pvi",      msg: "Prijslijst graag" },
  { id: 45, cat: "prijs", clinic: "pvi",      msg: "Hebben jullie een introductieaanbieding?" },

  // ── BEHANDELING INFO (46-75) ──────────────────────────────────────────
  { id: 46, cat: "behandeling", clinic: "pvi",      msg: "Wat is het verschil tussen botox en filler?" },
  { id: 47, cat: "behandeling", clinic: "pvi",      msg: "Hoe lang werkt botox?" },
  { id: 48, cat: "behandeling", clinic: "pvi",      msg: "Hoe lang duurt een filler behandeling?" },
  { id: 49, cat: "behandeling", clinic: "pvi",      msg: "Doet botox pijn?" },
  { id: 50, cat: "behandeling", clinic: "pvi",      msg: "Wat is mesotherapie?" },
  { id: 51, cat: "behandeling", clinic: "pvi",      msg: "Hoe lang houdt lip filler het vol?" },
  { id: 52, cat: "behandeling", clinic: "pvi",      msg: "Is er hersteltijd na fillers?" },
  { id: 53, cat: "behandeling", clinic: "pvi",      msg: "Wat is profhilo?" },
  { id: 54, cat: "behandeling", clinic: "pvi",      msg: "Zijn er risicos bij botox?" },
  { id: 55, cat: "behandeling", clinic: "pvi",      msg: "Kan ik filler laten oplossen?" },
  { id: 56, cat: "behandeling", clinic: "pvi",      msg: "Wat zijn de bijwerkingen van fillers?" },
  { id: 57, cat: "behandeling", clinic: "pvi",      msg: "Hoeveel eenheden botox heb ik nodig voor mijn voorhoofd?" },
  { id: 58, cat: "behandeling", clinic: "pvi",      msg: "Welke filler gebruiken jullie?" },
  { id: 59, cat: "behandeling", clinic: "pvi",      msg: "What is the difference between Botox and fillers?" },
  { id: 60, cat: "behandeling", clinic: "radiance", msg: "Wat doet een IV infuus precies?" },
  { id: 61, cat: "behandeling", clinic: "radiance", msg: "Hoe werkt het afvaltraject?" },
  { id: 62, cat: "behandeling", clinic: "radiance", msg: "Wat is longevity?" },
  { id: 63, cat: "behandeling", clinic: "pvi",      msg: "Is een neuscorrectie met filler permanent?" },
  { id: 64, cat: "behandeling", clinic: "pvi",      msg: "Kan ik sporten na botox?" },
  { id: 65, cat: "behandeling", clinic: "pvi",      msg: "Mag ik botox tijdens zwangerschap?" },

  // ── VESTIGING / LOCATIE (66-80) ───────────────────────────────────────
  { id: 66, cat: "vestiging", clinic: "pvi",      msg: "Waar zitten jullie?" },
  { id: 67, cat: "vestiging", clinic: "pvi",      msg: "Hebben jullie een vestiging in Amsterdam?" },
  { id: 68, cat: "vestiging", clinic: "pvi",      msg: "Adres Nijmegen?" },
  { id: 69, cat: "vestiging", clinic: "pvi",      msg: "Is er ook een vestiging in Maastricht?" },
  { id: 70, cat: "vestiging", clinic: "pvi",      msg: "Alle locaties?" },
  { id: 71, cat: "vestiging", clinic: "pvi",      msg: "Zitten jullie ook in Rotterdam?" },
  { id: 72, cat: "vestiging", clinic: "pvi",      msg: "Where are you located?" },
  { id: 73, cat: "vestiging", clinic: "radiance", msg: "Waar zit Radiance?" },
  { id: 74, cat: "vestiging", clinic: "radiance", msg: "Adres van Radiance Clinic?" },
  { id: 75, cat: "vestiging", clinic: null,       msg: "Waar zitten jullie precies?" },

  // ── OPENINGSTIJDEN (76-85) ────────────────────────────────────────────
  { id: 76, cat: "tijden", clinic: "pvi",      msg: "Wanneer zijn jullie open?" },
  { id: 77, cat: "tijden", clinic: "pvi",      msg: "Openingstijden?" },
  { id: 78, cat: "tijden", clinic: "pvi",      msg: "Zijn jullie ook op zaterdag open?" },
  { id: 79, cat: "tijden", clinic: "pvi",      msg: "Hoe laat gaan jullie dicht?" },
  { id: 80, cat: "tijden", clinic: "pvi",      msg: "Kan ik op zondag terecht?" },
  { id: 81, cat: "tijden", clinic: "radiance", msg: "Openingstijden Radiance?" },
  { id: 82, cat: "tijden", clinic: null,       msg: "When are you open?" },
  { id: 83, cat: "tijden", clinic: "pvi",      msg: "Tot hoe laat zijn jullie open op vrijdag?" },
  { id: 84, cat: "tijden", clinic: "pvi",      msg: "Openingstijden Nijmegen?" },
  { id: 85, cat: "tijden", clinic: "pvi",      msg: "Zijn jullie in de vakantie open?" },

  // ── FAQ / OVERIG (86-105) ─────────────────────────────────────────────
  { id: 86,  cat: "faq", clinic: "pvi",      msg: "Wie is de arts?" },
  { id: 87,  cat: "faq", clinic: "pvi",      msg: "Kan ik contant betalen?" },
  { id: 88,  cat: "faq", clinic: "pvi",      msg: "Hebben jullie parkeerplaatsen?" },
  { id: 89,  cat: "faq", clinic: "pvi",      msg: "Hoe lang bestaat de praktijk al?" },
  { id: 90,  cat: "faq", clinic: "pvi",      msg: "Is de arts BIG geregistreerd?" },
  { id: 91,  cat: "faq", clinic: "pvi",      msg: "Kan ik foto's zien van eerdere behandelingen?" },
  { id: 92,  cat: "faq", clinic: "pvi",      msg: "Werken jullie met verdoving?" },
  { id: 93,  cat: "faq", clinic: "pvi",      msg: "Moet ik een consult doen voor fillers?" },
  { id: 94,  cat: "faq", clinic: "pvi",      msg: "Kan ik op afbetaling?" },
  { id: 95,  cat: "faq", clinic: "radiance", msg: "Wat is Radiance Clinic?" },
  { id: 96,  cat: "faq", clinic: null,       msg: "Do you speak English?" },
  { id: 97,  cat: "faq", clinic: "pvi",      msg: "Kan ik als man ook terecht?" },
  { id: 98,  cat: "faq", clinic: "pvi",      msg: "Vanaf welke leeftijd kan ik botox?" },
  { id: 99,  cat: "faq", clinic: "pvi",      msg: "Is het veilig?" },
  { id: 100, cat: "faq", clinic: "pvi",      msg: "Review van andere klanten?" },

  // ── GROETEN / CHITCHAT (101-110) ──────────────────────────────────────
  { id: 101, cat: "groet", clinic: null, msg: "Hallo" },
  { id: 102, cat: "groet", clinic: null, msg: "Goedemorgen" },
  { id: 103, cat: "groet", clinic: null, msg: "Hi" },
  { id: 104, cat: "groet", clinic: null, msg: "Hey, zijn jullie open?" },
  { id: 105, cat: "groet", clinic: null, msg: "Goedemiddag, ik heb een vraag" },
  { id: 106, cat: "groet", clinic: null, msg: "Hello" },
  { id: 107, cat: "groet", clinic: null, msg: "Bedankt voor de info" },
  { id: 108, cat: "groet", clinic: null, msg: "Dankjewel!" },
  { id: 109, cat: "groet", clinic: null, msg: "👍" },
  { id: 110, cat: "groet", clinic: null, msg: "Ok top" },

  // ── MULTI-INTENT (111-125) ────────────────────────────────────────────
  { id: 111, cat: "multi", clinic: "pvi", msg: "Wat kost botox en waar zitten jullie?" },
  { id: 112, cat: "multi", clinic: "pvi", msg: "Ik wil botox, wat kost dat en kan ik boeken?" },
  { id: 113, cat: "multi", clinic: "pvi", msg: "Prijs fillers en openingstijden?" },
  { id: 114, cat: "multi", clinic: "pvi", msg: "Wanneer zijn jullie open en waar in Amsterdam?" },
  { id: 115, cat: "multi", clinic: "pvi", msg: "Afspraak lip filler, hoeveel kost dat?" },
  { id: 116, cat: "multi", clinic: "pvi", msg: "Wat is profhilo, hoeveel kost het, en kan ik boeken?" },
  { id: 117, cat: "multi", clinic: "pvi", msg: "Prijzen en locaties?" },
  { id: 118, cat: "multi", clinic: "pvi", msg: "Hebben jullie botox en hoe duur is het?" },
  { id: 119, cat: "multi", clinic: "pvi", msg: "I want Botox, what does it cost and where are you?" },
  { id: 120, cat: "multi", clinic: null,  msg: "Prijzen, locaties en openingstijden graag" },

  // ── TAAL (121-135) ────────────────────────────────────────────────────
  { id: 121, cat: "taal", clinic: "pvi", msg: "What treatments do you offer?" },
  { id: 122, cat: "taal", clinic: "pvi", msg: "How much is Botox?" },
  { id: 123, cat: "taal", clinic: "pvi", msg: "Where are you located?" },
  { id: 124, cat: "taal", clinic: "pvi", msg: "مرحبا، أريد حجز موعد" },
  { id: 125, cat: "taal", clinic: "pvi", msg: "Bonjour, je voudrais prendre rendez-vous" },
  { id: 126, cat: "taal", clinic: "pvi", msg: "Ich möchte einen Termin buchen" },
  { id: 127, cat: "taal", clinic: "pvi", msg: "Cuánto cuesta el botox?" },
  { id: 128, cat: "taal", clinic: "pvi", msg: "Сколько стоит ботокс?" },
  { id: 129, cat: "taal", clinic: "pvi", msg: "Türkçe konuşuyor musunuz?" },
  { id: 130, cat: "taal", clinic: "pvi", msg: "ボトックスの値段はいくらですか？" },

  // ── ESCALATIE (131-140) ───────────────────────────────────────────────
  { id: 131, cat: "escalatie", clinic: "pvi", msg: "Ik heb een klacht over mijn behandeling" },
  { id: 132, cat: "escalatie", clinic: "pvi", msg: "Er is iets misgegaan met mijn fillers" },
  { id: 133, cat: "escalatie", clinic: "pvi", msg: "Ik wil mijn geld terug" },
  { id: 134, cat: "escalatie", clinic: "pvi", msg: "Mijn gezicht is scheef na botox" },
  { id: 135, cat: "escalatie", clinic: "pvi", msg: "Ik wil de arts spreken over complicaties" },
  { id: 136, cat: "escalatie", clinic: "pvi", msg: "Ik heb een allergische reactie" },
  { id: 137, cat: "escalatie", clinic: "pvi", msg: "Het resultaat bevalt me helemaal niet" },
  { id: 138, cat: "escalatie", clinic: "pvi", msg: "Ik wil een schadeclaim indienen" },
  { id: 139, cat: "escalatie", clinic: "pvi", msg: "Er zit een bult na mijn filler" },
  { id: 140, cat: "escalatie", clinic: "pvi", msg: "I need to speak to a doctor urgently" },

  // ── EDGE CASES (141-150) ──────────────────────────────────────────────
  { id: 141, cat: "edge", clinic: null, msg: "" },
  { id: 142, cat: "edge", clinic: null, msg: "😊" },
  { id: 143, cat: "edge", clinic: null, msg: "Kan je mijn medicijnen voorschrijven?" },
  { id: 144, cat: "edge", clinic: null, msg: "Ik voel me niet lekker" },
  { id: 145, cat: "edge", clinic: null, msg: "Wat is de zin van het leven?" },
  { id: 146, cat: "edge", clinic: null, msg: "Kun je een pizza bestellen?" },
  { id: 147, cat: "edge", clinic: "pvi", msg: "Kunnen jullie ook borstvergrotingen doen?" },
  { id: 148, cat: "edge", clinic: null, msg: "..." },
  { id: 149, cat: "edge", clinic: null, msg: "Hallo hallo hallo hallo hallo" },
  { id: 150, cat: "edge", clinic: "pvi", msg: "Ik wil botox maar ik ben 16 jaar oud" },
];

// ── Runner ───────────────────────────────────────────────────────────────

async function run() {
  const db = new Database(DB_PATH);
  const results = [];
  const startTime = Date.now();

  console.log(`\n🧪 WhatsApp Bot Test Suite v2 — ${TESTS.length} scenarios\n`);
  console.log("─".repeat(70));

  for (const test of TESTS) {
    const jid = makeJid(test.id);

    // Set clinic context if specified
    if (test.clinic) {
      setClinic(db, jid, test.clinic);
    }

    const t0 = Date.now();
    let result;
    try {
      result = await runGraph(jid, test.msg || " ");
      const ms = Date.now() - t0;

      const entry = {
        id: test.id,
        cat: test.cat,
        clinic: test.clinic,
        input: test.msg,
        output: result?.proposed_reply || null,
        labels: (result?.intent || "").split(",").filter(Boolean),
        node_trace: result?.node_trace || "",
        mode: result?.action || "watch",
        latency_ms: result?.latency_ms || ms,
        ms,
        ok: true,
        error: result?.safety_reason || null,
      };

      results.push(entry);

      // Compact console output
      const reply = (entry.output || "").replace(/\n/g, " ").substring(0, 80);
      const status = entry.output ? "✅" : "⚠️";
      console.log(`${status} #${String(test.id).padStart(3)} [${test.cat.padEnd(11)}] ${ms}ms | ${reply}`);

    } catch (err) {
      const ms = Date.now() - t0;
      results.push({
        id: test.id,
        cat: test.cat,
        clinic: test.clinic,
        input: test.msg,
        output: null,
        labels: [],
        node_trace: "",
        mode: "watch",
        ms,
        ok: false,
        error: err.message,
      });
      console.log(`❌ #${String(test.id).padStart(3)} [${test.cat.padEnd(11)}] ${ms}ms | ERROR: ${err.message}`);
    }

    // Small delay between tests to not overwhelm LLM
    await sleep(200);
  }

  const totalMs = Date.now() - startTime;

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(70));
  console.log(`\n📊 RESULTATEN SAMENVATTING\n`);

  const cats = [...new Set(results.map(r => r.cat))];
  for (const cat of cats) {
    const catResults = results.filter(r => r.cat === cat);
    const ok = catResults.filter(r => r.ok && r.output).length;
    const fail = catResults.filter(r => !r.ok).length;
    const empty = catResults.filter(r => r.ok && !r.output).length;
    const avgMs = Math.round(catResults.reduce((s, r) => s + r.ms, 0) / catResults.length);
    console.log(`  ${cat.padEnd(12)} ${ok}/${catResults.length} OK | ${fail} errors | ${empty} empty | avg ${avgMs}ms`);
  }

  const totalOk = results.filter(r => r.ok && r.output).length;
  const totalFail = results.filter(r => !r.ok).length;
  const totalEmpty = results.filter(r => r.ok && !r.output).length;

  console.log(`\n  TOTAAL: ${totalOk}/${results.length} OK | ${totalFail} errors | ${totalEmpty} empty | ${Math.round(totalMs/1000)}s totaal\n`);

  // ── Booking Link Analyse ─────────────────────────────────────────────
  console.log("📎 BOOKING LINK CHECK\n");
  const bookingResults = results.filter(r => r.cat === "booking" && r.output);
  const withLink = bookingResults.filter(r =>
    r.output.includes("clinicminds.com") || r.output.includes("booking") || r.output.includes("boek")
  );
  console.log(`  ${withLink.length}/${bookingResults.length} booking antwoorden bevatten een link of booking-referentie\n`);

  // ── Taal Mirror Check ────────────────────────────────────────────────
  console.log("🌍 TAAL MIRROR CHECK\n");
  const taalResults = results.filter(r => r.cat === "taal" && r.output);
  for (const r of taalResults) {
    const lang = detectResponseLang(r.input, r.output);
    console.log(`  #${r.id} input="${r.input.substring(0,30)}" → response lang: ${lang}`);
  }

  // ── Save JSON ────────────────────────────────────────────────────────
  const report = {
    timestamp: new Date().toISOString(),
    version: "v2",
    total: results.length,
    ok: totalOk,
    fail: totalFail,
    empty: totalEmpty,
    duration_s: Math.round(totalMs / 1000),
    results,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n💾 Resultaten opgeslagen: ${OUTPUT_PATH}\n`);

  // Cleanup test JIDs from conversations table
  db.prepare(`DELETE FROM conversations WHERE jid LIKE '316TEST%'`).run();
  db.close();

  process.exit(0);
}

function detectResponseLang(input, output) {
  // Very simple heuristic
  if (/[а-яА-Я]/.test(output)) return "RU";
  if (/[أ-ي]/.test(output)) return "AR";
  if (/[ぁ-ん]|[ァ-ン]|[一-龥]/.test(output)) return "JA/ZH";
  if (/[äöüß]/i.test(output) && /[äöüß]/i.test(input)) return "DE";
  if (/rendez-vous|bonjour/i.test(output)) return "FR";
  if (/cuesta|precio/i.test(output)) return "ES";
  if (/randevu|fiyat/i.test(output)) return "TR";
  if (/the |and |you |your /i.test(output) && /the |and |you |your /i.test(input)) return "EN";
  return "NL";
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
