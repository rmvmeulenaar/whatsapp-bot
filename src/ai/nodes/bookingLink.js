import { getPendingBooking, setPendingBooking, clearPendingBooking } from "../../dashboard/db.js";

const API_BASE = process.env.PVI_API_BASE ?? "https://pvi-voicebot.vercel.app";
const API_SECRET = process.env.PVI_WEBHOOK_SECRET ?? "";
// Indien gezet: gebruik als fallback zonder te vragen. Indien niet gezet: vraag patient.
const DEFAULT_LOCATION = process.env.BOOKING_DEFAULT_LOCATION ?? null;

const TREATMENT_KEYWORDS = {
  "lip filler": "lip filler",
  "anti-aging": "anti-aging",
  botox: "botox",
  filler: "filler",
  lip: "lip filler",
  skinbooster: "skinbooster",
  microneedling: "microneedling",
  peel: "chemical peel",
  laser: "laser",
  afvallen: "afvallen",
  ozempic: "ozempic",
  wegovy: "wegovy",
  mounjaro: "mounjaro",
  saxenda: "saxenda",
  hormonen: "anti-aging",
  menopauze: "anti-aging",
  gewicht: "afvallen",
  dieet: "afvallen",
};

// Location keywords → API location key
const LOCATION_KEYWORDS = {
  nijmegen: "nijmegen",
  enschede: "enschede",
  sittard: "sittard",
};

// Clinic field → API location key
const CLINIC_MAP = {
  nijmegen: "nijmegen",
  enschede: "enschede",
  sittard: "sittard",
};

function jidToPhone(jid) {
  // "31612345678@s.whatsapp.net" → "0612345678"
  const raw = jid.split("@")[0];
  if (raw.startsWith("31") && raw.length >= 11) {
    return "0" + raw.slice(2);
  }
  return raw;
}

async function fetchHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Webhook-Secret": API_SECRET,
  };
}

export async function bookingLinkNode(state) {
  const text = state.body.toLowerCase();

  // Herstel behandeling uit pending state (als patient eerder al noemde)
  const pending = getPendingBooking(state.jid);

  // Detecteer behandeling uit huidig bericht (overschrijft pending indien gevonden)
  let treatment = pending?.treatment ?? null;
  for (const [key, val] of Object.entries(TREATMENT_KEYWORDS)) {
    if (text.includes(key)) { treatment = val; break; }
  }

  // Detecteer locatie: bericht → state.clinic → DEFAULT_LOCATION env var
  let location = null;
  for (const [key, val] of Object.entries(LOCATION_KEYWORDS)) {
    if (text.includes(key)) { location = val; break; }
  }
  if (!location) location = CLINIC_MAP[state.clinic] ?? DEFAULT_LOCATION;

  // Locatie onbekend → vraag specifiek
  if (!location) {
    setPendingBooking(state.jid, treatment);
    const treatmentLabel = treatment ? ` voor *${treatment}*` : "";
    return {
      results: [{
        node: "bookingLink",
        text: `Voor welke vestiging wil je een afspraak${treatmentLabel}? We zijn beschikbaar in *Nijmegen*, *Enschede* en *Sittard*.`,
        type: "text",
      }],
      node_trace: ["bookingLink:asking_location"],
    };
  }

  // Locatie bekend — wis pending state en ga verder
  clearPendingBooking(state.jid);

  const phone = jidToPhone(state.jid);
  const headers = await fetchHeaders();

  // Step 1: check-availability — get real slots from Clinicminds
  let slotsText = null;
  let serviceName = null;
  if (treatment) {
    try {
      const availRes = await fetch(`${API_BASE}/tools/check-availability`, {
        method: "POST",
        headers,
        body: JSON.stringify({ treatment_type: treatment, location }),
        signal: AbortSignal.timeout(8000),
      });
      if (availRes.ok) {
        const avail = await availRes.json();
        if (avail.available_slots?.length > 0) {
          slotsText = avail.available_slots.slice(0, 3).map(s => `• ${s}`).join("\n");
          serviceName = avail.service_name ?? null;
        }
      }
    } catch { /* non-fatal — continue without slots */ }
  }

  // Step 2: send-booking-sms — pre-filled link for treatment + location
  try {
    const smsPayload = { phone, location };
    if (treatment) smsPayload.treatment = treatment;

    const smsRes = await fetch(`${API_BASE}/tools/send-booking-sms`, {
      method: "POST",
      headers,
      body: JSON.stringify(smsPayload),
      signal: AbortSignal.timeout(8000),
    });

    if (!smsRes.ok) {
      const err = await smsRes.json().catch(() => ({}));
      throw new Error(`${smsRes.status}: ${err.error ?? "api_error"}`);
    }

    const locLabel = location.charAt(0).toUpperCase() + location.slice(1);
    let msg;

    if (slotsText && serviceName) {
      msg = `Eerstvolgende beschikbare tijden voor *${serviceName}* in ${locLabel}:\n\n${slotsText}\n\nIk heb je een SMS gestuurd met een boekingslink — klik op de link om je afspraak te bevestigen. 📅`;
    } else if (slotsText) {
      msg = `Beschikbare tijden in ${locLabel}:\n\n${slotsText}\n\nIk heb je een SMS gestuurd met een boekingslink. 📅`;
    } else {
      msg = `Ik heb je een SMS gestuurd met een boekingslink voor ${locLabel}. Klik op de link om zelf een tijdstip te kiezen. 📅`;
    }

    return {
      results: [{ node: "bookingLink", text: msg, type: "text" }],
      node_trace: ["bookingLink:sms_sent" + (slotsText ? "+slots" : "")],
    };
  } catch (err) {
    return {
      results: [{
        node: "bookingLink",
        text: "Je kunt een afspraak maken via onze website of door ons te bellen. 📞",
        type: "text",
      }],
      node_trace: ["bookingLink:fallback"],
      error: "booking_api_failed: " + err.message,
    };
  }
}
