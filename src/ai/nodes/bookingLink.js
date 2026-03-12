import { getPendingBooking, setPendingBooking, clearPendingBooking } from "../../dashboard/db.js";

const API_BASE = process.env.PVI_API_BASE ?? "https://pvi-voicebot.vercel.app";
const API_SECRET = process.env.PVI_WEBHOOK_SECRET ?? "";

// ── PVI Booking fallback URL ──────────────────────────────────────────────
const BOOKING_FALLBACK = `${API_BASE}/boek`;

// Treatment keyword → API treatment keyword + display label
const SERVICE_MAP = {
  "lip filler":    { label: "lip filler",       apiKey: "lip filler" },
  "lip":           { label: "lip filler",       apiKey: "lip filler" },
  "lippen":        { label: "lip filler",       apiKey: "lippen" },
  "filler":        { label: "filler",           apiKey: "filler" },
  "botox":         { label: "botox",            apiKey: "botox" },
  "rimpels":       { label: "rimpelbehandeling", apiKey: "rimpels" },
  "consult":       { label: "consult",          apiKey: "consult" },
  "skinbooster":   { label: "skinbooster",      apiKey: "consult" },
  "skin booster":  { label: "skinbooster",      apiKey: "consult" },
  "microneedling": { label: "microneedling",    apiKey: "consult" },
  "peel":          { label: "chemical peel",    apiKey: "consult" },
  "profhilo":      { label: "profhilo",         apiKey: "consult" },
  "jawline":       { label: "jawline filler",   apiKey: "filler" },
  "kaaklijn":      { label: "kaaklijn filler",  apiKey: "filler" },
  "wallen":        { label: "wallen",           apiKey: "filler" },
  "neus":          { label: "neuscorrectie",    apiKey: "filler" },
  "prp":           { label: "PRP",              apiKey: "consult" },
  "mesotherapie":  { label: "mesotherapie",      apiKey: "consult" },
  "anti-aging":    { label: "anti-aging",       apiKey: "anti-aging" },
  "hormonen":      { label: "hormoontherapie",  apiKey: "hormonen" },
  "menopauze":     { label: "menopauze",        apiKey: "menopauze" },
  "testosteron":   { label: "testosteron",      apiKey: "testosteron" },
  "laser":         { label: "laser (Fotona)",   apiKey: "laser",   forceLocation: "nijmegen" },
  "fotona":        { label: "laser (Fotona)",   apiKey: "fotona",  forceLocation: "nijmegen" },
  "cryolipolyse":  { label: "cryolipolyse",    apiKey: "cryolipolyse" },
  "afvallen":      { label: "afvallen",         apiKey: "afvallen" },
  "ozempic":       { label: "afvallen (GLP-1)", apiKey: "ozempic" },
  "wegovy":        { label: "afvallen (GLP-1)", apiKey: "wegovy" },
  "mounjaro":      { label: "afvallen (GLP-1)", apiKey: "mounjaro" },
  "saxenda":       { label: "afvallen (GLP-1)", apiKey: "saxenda" },
  "glp-1":         { label: "afvallen (GLP-1)", apiKey: "glp-1" },
  "gewicht":       { label: "afvallen",         apiKey: "afvallen" },
  "dieet":         { label: "afvallen",         apiKey: "afvallen" },
  "recept":        { label: "recept",           apiKey: "recept" },
};

// City → location key
const LOCATION_MAP = {
  nijmegen:  { label: "Nijmegen",  key: "nijmegen" },
  enschede:  { label: "Enschede",  key: "enschede" },
  sittard:   { label: "Sittard",   key: "sittard" },
};

const ALL_PVI_LOCATIONS = ["Nijmegen", "Enschede", "Sittard"];

// ── API: Gepersonaliseerde booking link genereren ─────────────────────────

async function createBookingLink(phone, treatmentKey, locationKey, patientName) {
  try {
    const res = await fetch(`${API_BASE}/api/booking/create-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": API_SECRET },
      body: JSON.stringify({
        phone,
        treatment: treatmentKey ?? "consult",
        location: locationKey ?? "nijmegen",
        patient_name: patientName ?? "",
        channel: "whatsapp",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.booking_url) return data.booking_url;
    }
  } catch { /* fallback to static URL */ }

  // Fallback: PVI booking homepage
  return BOOKING_FALLBACK;
}

// ── API: Beschikbaarheid checken ──────────────────────────────────────────

async function checkAvailability(treatmentKey, locationKey) {
  try {
    const res = await fetch(`${API_BASE}/tools/check-availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": API_SECRET },
      body: JSON.stringify({
        treatment_type: treatmentKey ?? "consult",
        location: locationKey ?? "nijmegen",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.available_slots?.length > 0) {
        return {
          slotsText: data.available_slots.slice(0, 3).map(s => `• ${s}`).join("\n"),
          serviceName: data.service_name ?? null,
        };
      }
    }
  } catch { /* non-fatal */ }
  return null;
}

// (static Clinicminds URL builder removed — all links go through PVI booking system)

// ── Multi-language templates ─────────────────────────────────────────────

function getLocationQuestion(treatmentLabel, language, genericUrl) {
  const locs = ALL_PVI_LOCATIONS.map(l => `*${l}*`).join(", ");
  const lang = language ?? "nl";

  if (lang === "fr") {
    const forText = treatmentLabel ? ` pour *${treatmentLabel}*` : "";
    return `Dans quelle clinique souhaitez-vous prendre rendez-vous${forText} ?\n\nNous sommes disponibles à ${locs}.\n\nVous pouvez déjà réserver ici :\n${genericUrl}`;
  }

  if (lang === "de") {
    const forText = treatmentLabel ? ` für *${treatmentLabel}*` : "";
    return `An welchem Standort möchten Sie einen Termin buchen${forText}?\n\nWir sind verfügbar in ${locs}.\n\nSie können hier bereits buchen:\n${genericUrl}`;
  }

  if (lang === "ar") {
    const forText = treatmentLabel ? ` لـ *${treatmentLabel}*` : "";
    return `في أي فرع تريد حجز موعد${forText}؟\n\nنحن متواجدون في ${locs}.\n\nيمكنك الحجز هنا:\n${genericUrl}`;
  }

  if (lang === "es") {
    const forText = treatmentLabel ? ` para *${treatmentLabel}*` : "";
    return `¿En qué ubicación desea reservar una cita${forText}?\n\nEstamos disponibles en ${locs}.\n\nYa puede reservar aquí:\n${genericUrl}`;
  }

  if (lang !== "nl") {
    const forText = treatmentLabel ? ` for *${treatmentLabel}*` : "";
    return `Which location would you like to book an appointment${forText}?\n\nWe are available in ${locs}.\n\nYou can already book here:\n${genericUrl}`;
  }

  const labelText = treatmentLabel ? ` voor *${treatmentLabel}*` : "";
  return `Voor welke vestiging wil je een afspraak${labelText}?\n\nWe zijn beschikbaar in ${locs}.\n\nJe kunt hier alvast een afspraak boeken:\n${genericUrl}`;
}

function getBookingMessage(displayName, locLabel, bookingUrl, language) {
  const lang = language ?? "nl";

  if (lang === "fr") {
    if (displayName) return `Vous pouvez réserver un rendez-vous pour *${displayName}* à ${locLabel} ici :\n${bookingUrl}\n\nOu appelez-nous au 085-4013678.`;
    return `Vous pouvez réserver un rendez-vous à ${locLabel} ici :\n${bookingUrl}\n\nOu appelez-nous au 085-4013678.`;
  }

  if (lang === "de") {
    if (displayName) return `Sie können hier einen Termin für *${displayName}* in ${locLabel} buchen:\n${bookingUrl}\n\nOder rufen Sie uns an: 085-4013678.`;
    return `Sie können hier einen Termin in ${locLabel} buchen:\n${bookingUrl}\n\nOder rufen Sie uns an: 085-4013678.`;
  }

  if (lang === "ar") {
    if (displayName) return `يمكنك حجز موعد لـ *${displayName}* في ${locLabel} هنا:\n${bookingUrl}\n\nأو اتصل بنا على 4013678-085.`;
    return `يمكنك حجز موعد في ${locLabel} هنا:\n${bookingUrl}\n\nأو اتصل بنا على 4013678-085.`;
  }

  if (lang === "es") {
    if (displayName) return `Puede reservar una cita para *${displayName}* en ${locLabel} aquí:\n${bookingUrl}\n\nO llámenos al 085-4013678.`;
    return `Puede reservar una cita en ${locLabel} aquí:\n${bookingUrl}\n\nO llámenos al 085-4013678.`;
  }

  if (lang !== "nl") {
    if (displayName) return `You can book an appointment for *${displayName}* in ${locLabel} here:\n${bookingUrl}\n\nOr call us at 085-4013678.`;
    return `You can book an appointment in ${locLabel} here:\n${bookingUrl}\n\nOr call us at 085-4013678.`;
  }

  if (displayName) return `Je kunt hier een afspraak boeken voor *${displayName}* in ${locLabel}:\n${bookingUrl}\n\nOf bel ons op 085-4013678.`;
  return `Je kunt hier een afspraak boeken in ${locLabel}:\n${bookingUrl}\n\nOf bel ons op 085-4013678.`;
}

function getSlotsMessage(displayName, locLabel, slotsText, bookingUrl, language) {
  const lang = language ?? "nl";

  if (lang === "fr") return `Premiers créneaux disponibles pour *${displayName}* à ${locLabel} :\n\n${slotsText}\n\nRéservez directement ici :\n${bookingUrl}\n\nOu appelez-nous au 085-4013678.`;
  if (lang === "de") return `Nächste verfügbare Termine für *${displayName}* in ${locLabel}:\n\n${slotsText}\n\nDirekt hier buchen:\n${bookingUrl}\n\nOder rufen Sie uns an: 085-4013678.`;
  if (lang !== "nl") return `First available times for *${displayName}* in ${locLabel}:\n\n${slotsText}\n\nBook directly here:\n${bookingUrl}\n\nOr call us at 085-4013678.`;

  return `Eerstvolgende beschikbare tijden voor *${displayName}* in ${locLabel}:\n\n${slotsText}\n\nJe kunt hier direct een afspraak boeken:\n${bookingUrl}\n\nOf bel ons op 085-4013678.`;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function jidToPhone(jid) {
  const raw = jid.split("@")[0];
  if (raw.startsWith("31") && raw.length >= 11) return "0" + raw.slice(2);
  return "+" + raw;
}

function matchTreatment(text) {
  for (const [key, val] of Object.entries(SERVICE_MAP)) {
    if (text.includes(key)) return { ...val, matchedKey: key };
  }
  return null;
}

function matchLocation(text) {
  for (const [key, val] of Object.entries(LOCATION_MAP)) {
    if (text.includes(key)) return val;
  }
  return null;
}

// ── Node ─────────────────────────────────────────────────────────────────

export async function bookingLinkNode(state) {
  const text = state.body.toLowerCase();
  const language = state.language ?? "nl";
  const phone = jidToPhone(state.jid);

  // Radiance guard — no PVI booking URLs for Radiance patients
  if (state.clinic === 'radiance') {
    return {
      results: [{ node: "bookingLink", text: "Voor Radiance afspraken kun je ons bereiken op 085-4013678. Online boeken wordt binnenkort beschikbaar.", type: "text" }],
      node_trace: ["bookingLink:radiance_fallback"],
    };
  }

  // FIX: Block online booking for flagged patients
  if (state.patient?.blockOnlineBooking) {
    clearPendingBooking(state.jid);
    const lang = language;
    const msg = lang === "nl"
      ? "Voor het boeken van een afspraak kun je ons bellen op 085-4013678. Een medewerker helpt je graag verder."
      : lang === "de"
      ? "Um einen Termin zu buchen, rufen Sie uns bitte an unter 085-4013678."
      : lang === "fr"
      ? "Pour prendre rendez-vous, appelez-nous au 085-4013678."
      : "To book an appointment, please call us at 085-4013678. A team member will be happy to help you.";
    return {
      results: [{ node: "bookingLink", text: msg, type: "text" }],
      node_trace: ["bookingLink:blocked_online"],
    };
  }

  // Check pending booking (user was asked for location)
  const pending = getPendingBooking(state.jid);

  // Match treatment
  let treatment = null;
  if (pending?.treatment) {
    treatment = SERVICE_MAP[pending.treatment] ?? { label: pending.treatment, apiKey: pending.treatment };
  }
  const freshMatch = matchTreatment(text);
  if (freshMatch) treatment = freshMatch;

  // Match location
  let location = matchLocation(text);

  // forceLocation override (laser = alleen Nijmegen)
  if (treatment?.forceLocation) {
    location = LOCATION_MAP[treatment.forceLocation];
  }

  // Fallback: use clinic from state
  if (!location && state.clinic && LOCATION_MAP[state.clinic]) {
    location = LOCATION_MAP[state.clinic];
  }

  // FIX: Auto-detect location from patient's registered city
  if (!location && state.patient?.city) {
    const patientCity = state.patient.city.toLowerCase().trim();
    location = matchLocation(patientCity);
  }

  // Geen locatie en niet geforceerd → vraag om vestiging
  if (!location && !treatment?.forceLocation) {
    const treatmentLabel = treatment?.label ?? null;
    setPendingBooking(state.jid, treatmentLabel);
    const genericUrl = BOOKING_FALLBACK;
    return {
      results: [{
        node: "bookingLink",
        text: getLocationQuestion(treatmentLabel, language, genericUrl),
        type: "text",
      }],
      node_trace: ["bookingLink:asking_location"],
    };
  }

  clearPendingBooking(state.jid);

  const locKey = location?.key ?? "nijmegen";
  const locLabel = location?.label ?? "onze kliniek";
  const treatmentApiKey = treatment?.apiKey ?? "consult";

  // Parallel: booking link genereren + beschikbaarheid checken
  const patientName = state.patient?.firstName ?? null;
  const [bookingUrl, availability] = await Promise.all([
    createBookingLink(phone, treatmentApiKey, locKey, patientName),
    treatment?.label ? checkAvailability(treatmentApiKey, locKey) : Promise.resolve(null),
  ]);

  // Build response message
  const displayName = availability?.serviceName ?? treatment?.label ?? null;
  let msg;

  if (availability?.slotsText && displayName) {
    msg = getSlotsMessage(displayName, locLabel, availability.slotsText, bookingUrl, language);
  } else {
    msg = getBookingMessage(displayName, locLabel, bookingUrl, language);
  }

  return {
    results: [{ node: "bookingLink", text: msg, type: "text" }],
    node_trace: ["bookingLink:ready" + (availability ? "+slots" : "") + `:${locLabel}`],
  };
}
