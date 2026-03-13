/**
 * WhatsApp Bot — 200-scenario Test Suite
 * Roept runGraph direct aan, geen echte WA berichten nodig.
 * Gebruik: node /tmp/test-bot.mjs 2>&1 | tee /tmp/test-results.txt
 */

import dotenv from "dotenv";
dotenv.config({ path: "/opt/whatsapp-bot/.env" });
import { runGraph } from "/opt/whatsapp-bot/src/ai/graph.js";

const TEST_JID = "31600000001@s.whatsapp.net";

const TESTS = [
  // ── AFSPRAAK BOEKEN (1-35) ──────────────────────────────────────────────
  { id:  1, cat:"booking", msg:"Ik wil een afspraak maken voor fillers" },
  { id:  2, cat:"booking", msg:"Hoe kan ik een afspraak inplannen?" },
  { id:  3, cat:"booking", msg:"Kunnen jullie me een boekingslink sturen?" },
  { id:  4, cat:"booking", msg:"Ik wil botox laten zetten, wanneer kunnen jullie me inplannen?" },
  { id:  5, cat:"booking", msg:"Afspraak maken voor lip filler" },
  { id:  6, cat:"booking", msg:"Is er deze week nog een gaatje?" },
  { id:  7, cat:"booking", msg:"Ik wil een afspraak voor volgende week" },
  { id:  8, cat:"booking", msg:"Kan ik morgen al terecht?" },
  { id:  9, cat:"booking", msg:"Hoe boek ik online?" },
  { id: 10, cat:"booking", msg:"Ik wil graag een consult inplannen" },
  { id: 11, cat:"booking", msg:"Afspraak annuleren kan dat ook?" },
  { id: 12, cat:"booking", msg:"Kan ik mijn afspraak verzetten?" },
  { id: 13, cat:"booking", msg:"Ik wil een vervolgafspraak maken" },
  { id: 14, cat:"booking", msg:"Zijn er nog plekken vrij deze maand?" },
  { id: 15, cat:"booking", msg:"Boekingslink graag!" },
  { id: 16, cat:"booking", msg:"Stuur me een link om te boeken" },
  { id: 17, cat:"booking", msg:"Ik wil een afspraak voor neusfillers" },
  { id: 18, cat:"booking", msg:"Jawliner behandeling boeken" },
  { id: 19, cat:"booking", msg:"Kan ik een gratis consult krijgen?" },
  { id: 20, cat:"booking", msg:"First appointment please" },
  { id: 21, cat:"booking", msg:"Ik wil ringen laten weghalen" },
  { id: 22, cat:"booking", msg:"Afspraak voor wallen behandeling" },
  { id: 23, cat:"booking", msg:"Wanneer heeft de dokter ruimte?" },
  { id: 24, cat:"booking", msg:"Kan ik bij u terecht voor mesotherapie?" },
  { id: 25, cat:"booking", msg:"Skin booster afspraak" },
  { id: 26, cat:"booking", msg:"Is er een wachtlijst?" },
  { id: 27, cat:"booking", msg:"Wil een afspraak, snel graag" },
  { id: 28, cat:"booking", msg:"Ik wil profhilo laten doen, hoe plan ik dat in?" },
  { id: 29, cat:"booking", msg:"Kan ik 's avonds terecht?" },
  { id: 30, cat:"booking", msg:"I want to book an appointment for Botox" },
  { id: 31, cat:"booking", msg:"I'd like to schedule a filler treatment" },
  { id: 32, cat:"booking", msg:"Book me in for next week" },
  { id: 33, cat:"booking", msg:"How do I make an appointment?" },
  { id: 34, cat:"booking", msg:"Can I book online?" },
  { id: 35, cat:"booking", msg:"Ik wil een afspraak voor PRP haar behandeling" },

  // ── PRIJS (36-65) ────────────────────────────────────────────────────────
  { id: 36, cat:"prijs", msg:"Wat kost botox?" },
  { id: 37, cat:"prijs", msg:"Wat zijn de prijzen voor fillers?" },
  { id: 38, cat:"prijs", msg:"Hoeveel kost een lipliner?" },
  { id: 39, cat:"prijs", msg:"Prijzen profhilo" },
  { id: 40, cat:"prijs", msg:"Wat kost een behandeling bij jullie?" },
  { id: 41, cat:"prijs", msg:"Is er een prijslijst?" },
  { id: 42, cat:"prijs", msg:"Skin booster prijs?" },
  { id: 43, cat:"prijs", msg:"Wat is de prijs van jawline filler?" },
  { id: 44, cat:"prijs", msg:"Hoeveel kost wallen behandeling?" },
  { id: 45, cat:"prijs", msg:"Zijn er kortingen?" },
  { id: 46, cat:"prijs", msg:"Hebben jullie een introductieaanbieding?" },
  { id: 47, cat:"prijs", msg:"Wat zijn de kosten voor mezotherapie?" },
  { id: 48, cat:"prijs", msg:"Prijs botox voorhoofd?" },
  { id: 49, cat:"prijs", msg:"Wat kost 1 ml filler?" },
  { id: 50, cat:"prijs", msg:"Hoe duur is neus filler?" },
  { id: 51, cat:"prijs", msg:"What does botox cost?" },
  { id: 52, cat:"prijs", msg:"Prijzen voor PRP?" },
  { id: 53, cat:"prijs", msg:"Vergoeding zorgverzekering?" },
  { id: 54, cat:"prijs", msg:"Worden fillers vergoed?" },
  { id: 55, cat:"prijs", msg:"Hoeveel kost een behandeling globaal?" },

  // ── BEHANDELING INFO (66-100) ────────────────────────────────────────────
  { id: 56, cat:"behandeling", msg:"Wat is het verschil tussen botox en filler?" },
  { id: 57, cat:"behandeling", msg:"Hoe lang werkt botox?" },
  { id: 58, cat:"behandeling", msg:"Hoe lang duurt een filler behandeling?" },
  { id: 59, cat:"behandeling", msg:"Wat doet profhilo precies?" },
  { id: 60, cat:"behandeling", msg:"Doet botox pijn?" },
  { id: 61, cat:"behandeling", msg:"Wat is mesotherapie?" },
  { id: 62, cat:"behandeling", msg:"Hoe lang houd lip filler het vol?" },
  { id: 63, cat:"behandeling", msg:"Kan ik botox combineren met fillers?" },
  { id: 64, cat:"behandeling", msg:"Wat is een skin booster?" },
  { id: 65, cat:"behandeling", msg:"Wat is PRP en hoe werkt het?" },
  { id: 66, cat:"behandeling", msg:"Informatie over wallen behandeling" },
  { id: 67, cat:"behandeling", msg:"Hoe ziet een consult eruit?" },
  { id: 68, cat:"behandeling", msg:"Kan ik voor het eerst komen zonder consult?" },
  { id: 69, cat:"behandeling", msg:"Wat zijn de risico's van fillers?" },
  { id: 70, cat:"behandeling", msg:"Hoe snel zie ik resultaat na botox?" },
  { id: 71, cat:"behandeling", msg:"Is profhilo beter dan botox?" },
  { id: 72, cat:"behandeling", msg:"Welke behandelingen doen jullie voor de lippen?" },
  { id: 73, cat:"behandeling", msg:"Wat is het verschil tussen 0,5ml en 1ml filler?" },
  { id: 74, cat:"behandeling", msg:"Kan ik met medicijnen toch behandeld worden?" },
  { id: 75, cat:"behandeling", msg:"Zijn jullie behandelingen veilig?" },
  { id: 76, cat:"behandeling", msg:"Wat is een jawline filler?" },
  { id: 77, cat:"behandeling", msg:"Hoe oud moet je zijn voor botox?" },
  { id: 78, cat:"behandeling", msg:"Kan ik botox laten doen als ik zwanger ben?" },
  { id: 79, cat:"behandeling", msg:"Welke behandelingen zijn goed voor rimpels?" },
  { id: 80, cat:"behandeling", msg:"Wat doet een botox behandeling in het voorhoofd?" },

  // ── VESTIGING / LOCATIE (81-100) ─────────────────────────────────────────
  { id: 81, cat:"vestiging", msg:"Waar zitten jullie?" },
  { id: 82, cat:"vestiging", msg:"Hebben jullie ook een vestiging in Amsterdam?" },
  { id: 83, cat:"vestiging", msg:"Zijn jullie ook in Rotterdam?" },
  { id: 84, cat:"vestiging", msg:"Wat is het adres in Nijmegen?" },
  { id: 85, cat:"vestiging", msg:"Locatie Arnhem?" },
  { id: 86, cat:"vestiging", msg:"Jullie vestigingen?" },
  { id: 87, cat:"vestiging", msg:"Zijn er parkeerplaatsen?" },
  { id: 88, cat:"vestiging", msg:"Hoe kom ik bij jullie met de trein?" },
  { id: 89, cat:"vestiging", msg:"Adres Eindhoven vestiging?" },
  { id: 90, cat:"vestiging", msg:"Ik woon in Utrecht, welke vestiging is dichtbij?" },

  // ── OPENINGSTIJDEN (91-105) ──────────────────────────────────────────────
  { id: 91, cat:"tijden", msg:"Hoe laat zijn jullie open?" },
  { id: 92, cat:"tijden", msg:"Zijn jullie ook in het weekend open?" },
  { id: 93, cat:"tijden", msg:"Tot hoe laat kunnen jullie patiënten behandelen?" },
  { id: 94, cat:"tijden", msg:"Openingstijden?" },
  { id: 95, cat:"tijden", msg:"Op welke dagen zijn jullie open?" },
  { id: 96, cat:"tijden", msg:"Zaterdag open?" },
  { id: 97, cat:"tijden", msg:"Zijn jullie ook 's avonds open?" },
  { id: 98, cat:"tijden", msg:"Opening hours?" },
  { id: 99, cat:"tijden", msg:"Wanneer kan ik langs komen?" },
  { id:100, cat:"tijden", msg:"Zijn jullie vandaag open?" },

  // ── FAQ / ALGEMENE VRAGEN (101-140) ──────────────────────────────────────
  { id:101, cat:"faq", msg:"Doet een lipliner behandeling pijn?" },
  { id:102, cat:"faq", msg:"Hoe bereid ik me voor op mijn behandeling?" },
  { id:103, cat:"faq", msg:"Mag ik bloed verdunnende medicijnen nemen voor de behandeling?" },
  { id:104, cat:"faq", msg:"Wat mag ik niet doen na botox?" },
  { id:105, cat:"faq", msg:"Mag ik sporten na fillers?" },
  { id:106, cat:"faq", msg:"Wanneer mag ik make-up dragen na behandeling?" },
  { id:107, cat:"faq", msg:"Zijn jullie artsen bevoegd?" },
  { id:108, cat:"faq", msg:"Is de arts BIG geregistreerd?" },
  { id:109, cat:"faq", msg:"Werken jullie met FDA-goedgekeurde producten?" },
  { id:110, cat:"faq", msg:"Wat als ik niet tevreden ben?" },
  { id:111, cat:"faq", msg:"Kan ik fillers laten oplossen?" },
  { id:112, cat:"faq", msg:"Hoe lang duren de resultaten?" },
  { id:113, cat:"faq", msg:"Mag ik in de zon na botox?" },
  { id:114, cat:"faq", msg:"Kunnen mannen ook botox krijgen?" },
  { id:115, cat:"faq", msg:"Is botox verslavend?" },
  { id:116, cat:"faq", msg:"Hoe snel werkt botox na injectie?" },
  { id:117, cat:"faq", msg:"Wat is het herstel na fillers?" },
  { id:118, cat:"faq", msg:"Bruikbaar voor mensen met huidproblemen?" },
  { id:119, cat:"faq", msg:"Hoe lang van tevoren moet ik stoppen met aspirine?" },
  { id:120, cat:"faq", msg:"Welk merk filler gebruiken jullie?" },
  { id:121, cat:"faq", msg:"Kan ik contant betalen?" },
  { id:122, cat:"faq", msg:"Pinnen mogelijk?" },
  { id:123, cat:"faq", msg:"Accepteren jullie iDEAL?" },
  { id:124, cat:"faq", msg:"Factuur voor belasting?" },
  { id:125, cat:"faq", msg:"Terugbetaalbeleid?" },
  { id:126, cat:"faq", msg:"Kan ik een cadeaubon kopen?" },
  { id:127, cat:"faq", msg:"Giftcard bestellen?" },
  { id:128, cat:"faq", msg:"Loyalty korting voor vaste klanten?" },
  { id:129, cat:"faq", msg:"Do you speak English?" },
  { id:130, cat:"faq", msg:"Is the doctor Dutch or international?" },
  { id:131, cat:"faq", msg:"Do you accept credit cards?" },
  { id:132, cat:"faq", msg:"How do I prepare for my first treatment?" },
  { id:133, cat:"faq", msg:"Can men get Botox too?" },
  { id:134, cat:"faq", msg:"What brand of filler do you use?" },
  { id:135, cat:"faq", msg:"Is it safe?" },
  { id:136, cat:"faq", msg:"What is the downtime?" },
  { id:137, cat:"faq", msg:"Will it hurt?" },
  { id:138, cat:"faq", msg:"How long does it last?" },
  { id:139, cat:"faq", msg:"Can I dissolve my filler?" },
  { id:140, cat:"faq", msg:"Are you a qualified doctor?" },

  // ── SPOED / KLACHTEN / AFTERCARE (141-160) ───────────────────────────────
  { id:141, cat:"spoed", msg:"Ik heb een blauwe plek na mijn behandeling gisteren" },
  { id:142, cat:"spoed", msg:"Mijn lippen zijn enorm opgezet na fillers" },
  { id:143, cat:"spoed", msg:"Ik heb pijn na de injectie, is dat normaal?" },
  { id:144, cat:"spoed", msg:"Na botox kan ik mijn wenkbrauw niet meer bewegen" },
  { id:145, cat:"spoed", msg:"Er zit een bultje op mijn lip na filler" },
  { id:146, cat:"spoed", msg:"Ik ben allergisch voor iets" },
  { id:147, cat:"spoed", msg:"Spoed: ik heb complicaties na mijn behandeling" },
  { id:148, cat:"spoed", msg:"Blauwe plek na behandeling, wat moet ik doen?" },
  { id:149, cat:"spoed", msg:"Het effect van botox is aan één kant anders" },
  { id:150, cat:"spoed", msg:"Klacht over mijn behandeling" },
  { id:151, cat:"spoed", msg:"Ik ben niet tevreden met het resultaat" },
  { id:152, cat:"spoed", msg:"Mijn filler is scheef" },
  { id:153, cat:"spoed", msg:"I have a reaction after my treatment" },
  { id:154, cat:"spoed", msg:"Emergency: my lip is very swollen" },
  { id:155, cat:"spoed", msg:"Er is iets mis gegaan tijdens de behandeling" },

  // ── GROETEN / SMALLTALK (161-175) ─────────────────────────────────────────
  { id:156, cat:"groet", msg:"Hallo" },
  { id:157, cat:"groet", msg:"Goedemorgen!" },
  { id:158, cat:"groet", msg:"Goedemiddag" },
  { id:159, cat:"groet", msg:"Dag" },
  { id:160, cat:"groet", msg:"Hi!" },
  { id:161, cat:"groet", msg:"Hey, hoe gaat het?" },
  { id:162, cat:"groet", msg:"Goedenavond" },
  { id:163, cat:"groet", msg:"Hello" },
  { id:164, cat:"groet", msg:"Good morning" },
  { id:165, cat:"groet", msg:"Hi there!" },

  // ── COMBINATIES (176-190) ─────────────────────────────────────────────────
  { id:166, cat:"combo", msg:"Wat kost botox en kan ik meteen boeken?" },
  { id:167, cat:"combo", msg:"Prijs filler Nijmegen en openingstijden" },
  { id:168, cat:"combo", msg:"Ik wil lip filler, wat kost dat en hoe plan ik een afspraak?" },
  { id:169, cat:"combo", msg:"Zijn jullie in Amsterdam en wat zijn de prijzen?" },
  { id:170, cat:"combo", msg:"Afspraak maken voor botox, ik woon in Rotterdam" },
  { id:171, cat:"combo", msg:"Hoe lang duurt botox en wat kost het?" },
  { id:172, cat:"combo", msg:"Botox + fillers in 1 behandeling, prijs?" },
  { id:173, cat:"combo", msg:"Wanneer kunnen jullie me boeken en wat zijn de kosten?" },
  { id:174, cat:"combo", msg:"Openingstijden Amsterdam en boekingslink" },
  { id:175, cat:"combo", msg:"Wat kost profhilo, doet het pijn en hoe boek ik?" },

  // ── OUT OF SCOPE / EDGE CASES (191-200) ───────────────────────────────────
  { id:176, cat:"oos", msg:"Kunnen jullie ook tandheelkunde doen?" },
  { id:177, cat:"oos", msg:"Verkopen jullie ook skincare producten?" },
  { id:178, cat:"oos", msg:"Zijn jullie ook een ziekenhuis?" },
  { id:179, cat:"oos", msg:"Laser ontharing?" },
  { id:180, cat:"oos", msg:"Ik zoek een plastisch chirurg" },
  { id:181, cat:"oos", msg:"Kunnen jullie borstvergroting doen?" },
  { id:182, cat:"oos", msg:"Ik wil afvallen, kunnen jullie helpen?" },
  { id:183, cat:"oos", msg:"Hypotheekrente?" },
  { id:184, cat:"oos", msg:"Pizza bestellen" },
  { id:185, cat:"oos", msg:"Wat is het weer vandaag?" },
  { id:186, cat:"oos", msg:"Ik wil klachten indienen bij de IGJ" },
  { id:187, cat:"oos", msg:"asdfghjkl" },
  { id:188, cat:"oos", msg:"..." },
  { id:189, cat:"oos", msg:"🙂" },
  { id:190, cat:"oos", msg:"" },

  // ── RADIANCE / LONGEVITY (191-200) ───────────────────────────────────────
  { id:191, cat:"radiance", msg:"Wat is Radiance Clinic?" },
  { id:192, cat:"radiance", msg:"Informatie over longevity behandelingen" },
  { id:193, cat:"radiance", msg:"IV drip behandeling?" },
  { id:194, cat:"radiance", msg:"NAD+ infuus" },
  { id:195, cat:"radiance", msg:"GLP-1 afvalbehandeling" },
  { id:196, cat:"radiance", msg:"Ozempic bij jullie?" },
  { id:197, cat:"radiance", msg:"Hormoonbehandeling voor mannen" },
  { id:198, cat:"radiance", msg:"Bloedonderzoek voor veroudering" },
  { id:199, cat:"radiance", msg:"Biohacking behandelingen" },
  { id:200, cat:"radiance", msg:"Wat doet jullie longevity pakket?" },
];

// ── Runner ───────────────────────────────────────────────────────────────────

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  blue:   s => `\x1b[34m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
};
const trunc = (s, n=150) => s && s.length > n ? s.slice(0,n)+"…" : (s ?? "");

console.log(C.blue(C.bold("\n╔══════════════════════════════════════════════════╗")));
console.log(C.blue(C.bold("║   WHATSAPP BOT — 200-SCENARIO TEST SUITE          ║")));
console.log(C.blue(C.bold("╚══════════════════════════════════════════════════╝\n")));

const stats = { passed: 0, empty: 0, error: 0 };
const cats = {};

for (const test of TESTS) {
  if (!cats[test.cat]) cats[test.cat] = { passed: 0, total: 0 };
  cats[test.cat].total++;

  const label = `[${String(test.id).padStart(3,'0')}] [${test.cat.padEnd(10)}]`;
  process.stdout.write(`${label} ${trunc(test.msg, 50).padEnd(52)} `);

  if (!test.msg.trim()) {
    stats.empty++;
    cats[test.cat].passed++; // leeg = edge case, telt als ok als bot niet crasht
    console.log(C.yellow("SKIP (leeg)"));
    continue;
  }

  const t0 = Date.now();
  try {
    const entry = await runGraph(TEST_JID, test.msg);
    const ms = Date.now() - t0;
    const reply = entry.proposed_reply ?? entry.output;
    const action = entry.action ?? "?";
    const intent = (entry.intent?.labels ?? []).join("+") || "?";

    if (reply) {
      stats.passed++;
      cats[test.cat].passed++;
      console.log(C.green("OK") + C.yellow(` ${ms}ms`) + ` ${action} [${intent}]`);
      console.log(`       ${C.cyan("↳")} ${trunc(reply, 160)}`);
    } else {
      stats.empty++;
      console.log(C.yellow("LEEG") + C.yellow(` ${ms}ms`) + ` ${action} [${intent}]`);
    }
  } catch (err) {
    stats.error++;
    console.log(C.red("ERROR") + " " + err.message.slice(0,80));
  }
}

// ── Samenvatting per categorie ───────────────────────────────────────────────
console.log(C.blue(C.bold("\n╔══════════════════════════════════════════════════╗")));
console.log(C.blue(C.bold("║   RESULTATEN PER CATEGORIE                        ║")));
console.log(C.blue(C.bold("╚══════════════════════════════════════════════════╝")));
for (const [cat, s] of Object.entries(cats)) {
  const pct = Math.round(s.passed/s.total*100);
  const bar = "█".repeat(Math.round(pct/5)) + "░".repeat(20-Math.round(pct/5));
  const col = pct === 100 ? C.green : pct >= 70 ? C.yellow : C.red;
  console.log(col(`  ${cat.padEnd(12)} ${bar} ${s.passed}/${s.total} (${pct}%)`));
}

const total = TESTS.filter(t => t.msg.trim()).length;
const pct = Math.round(stats.passed/total*100);
console.log(C.blue(C.bold("\n─────────────────────────────────────────────────")));
console.log(C.bold(`  TOTAAL: ${C.green(stats.passed + " OK")} | ${C.yellow(stats.empty + " leeg")} | ${C.red(stats.error + " error")} | ${pct}% pass rate`));
console.log(C.blue(C.bold("─────────────────────────────────────────────────\n")));

process.exit(0);
