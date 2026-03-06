const API_BASE = process.env.PVI_API_BASE ?? "https://pvi-voicebot.vercel.app";
const API_SECRET = process.env.PVI_WEBHOOK_SECRET ?? "";
const DEFAULT_LOCATION = process.env.BOOKING_DEFAULT_LOCATION ?? "nijmegen";

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

// Clinic field → API location key (for when state.clinic is set)
const CLINIC_MAP = {
  nijmegen: "nijmegen",
  enschede: "enschede",
  sittard: "sittard",
  radiance: DEFAULT_LOCATION,
};

function jidToPhone(jid) {
  // "31612345678@s.whatsapp.net" → "0612345678"
  const raw = jid.split("@")[0];
  if (raw.startsWith("31") && raw.length >= 11) {
    return "0" + raw.slice(2);
  }
  return raw;
}

export async function bookingLinkNode(state) {
  const text = state.body.toLowerCase();

  // Detect treatment from message (longest match first via key ordering above)
  let treatment = null;
  for (const [key, val] of Object.entries(TREATMENT_KEYWORDS)) {
    if (text.includes(key)) { treatment = val; break; }
  }

  // Detect location: message body → state.clinic → default
  let location = null;
  for (const [key, val] of Object.entries(LOCATION_KEYWORDS)) {
    if (text.includes(key)) { location = val; break; }
  }
  if (!location) location = CLINIC_MAP[state.clinic] ?? DEFAULT_LOCATION;

  const phone = jidToPhone(state.jid);

  const payload = { phone };
  if (treatment) payload.treatment = treatment;
  if (location) payload.location = location;

  try {
    const res = await fetch(`${API_BASE}/tools/send-booking-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": API_SECRET,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      return {
        results: [{
          node: "bookingLink",
          text: "Ik heb je een SMS gestuurd met een persoonlijke boekingslink. Klik op de link om zelf een tijdstip te kiezen. 📅",
          type: "text",
        }],
        node_trace: ["bookingLink:sms_sent"],
      };
    }

    const body = await res.json().catch(() => ({}));
    throw new Error(`${res.status}: ${body.error ?? "api_error"}`);
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
