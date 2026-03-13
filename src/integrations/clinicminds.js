import { logEvent } from "../logging/logger.js";

// ── Phone normalization ──────────────────────────────────────────────────

export function normalizePhone(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");

  if (digits.startsWith("316") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0031")) return `+31${digits.slice(4)}`;
  if (digits.startsWith("31") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("06") && digits.length === 10) return `+31${digits.slice(1)}`;
  if (digits.length === 9) return `+31${digits}`;
  return `+${digits}`;
}

export function maskPhone(jid) {
  if (!jid || typeof jid !== "string") return "unknown";
  const [phone, suffix] = jid.split("@");
  if (!phone || phone.length < 7) return jid;
  const masked = phone.slice(0, 7) + "***" + phone.slice(-2);
  return suffix ? `${masked}@${suffix}` : masked;
}

// ── Patient cache (pre-loaded from Analytics API) ────────────────────────

const patientCache = new Map();       // phone → patient object
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
let lastRefresh = 0;
let refreshTimer = null;

/**
 * Normalize phone for cache key: strip everything except digits, ensure +31 format.
 * Handles both "Telefoonnummer" and "Mobiel nummer" fields from Clinicminds.
 */
function normalizeForCache(raw) {
  if (!raw) return null;
  const normalized = normalizePhone(raw.replace(/\D/g, ""));
  return normalized.length >= 10 ? normalized : null;
}

/**
 * Load all patients from Analytics API into memory.
 * Called at startup and every week.
 */
export async function loadPatientCache() {
  const apiKey = process.env.CLINICMINDS_ANALYTICS_API_KEY ?? "";
  if (!apiKey) {
    console.warn("[clinicminds] No CLINICMINDS_ANALYTICS_API_KEY — cache disabled");
    return;
  }

  try {
    const res = await fetch(
      "https://app.clinicminds.com/api/analytics/patients?date_from=2020-01-01&date_to=2030-01-01",
      {
        headers: {
          "X-Api-Key": apiKey,
          "User-Agent": "Radiance-WhatsApp-Bot/2.0",
        },
        signal: AbortSignal.timeout(30000), // 30s for bulk load
      }
    );

    if (!res.ok) {
      console.error(`[clinicminds] Analytics API error: ${res.status}`);
      return;
    }

    const data = await res.json();
    const prevSize = patientCache.size;
    patientCache.clear();

    for (const p of data) {
      // Build enriched patient object
      const patient = {
        fullName: [p.Voornaam, p.Achternaam].filter(Boolean).join(" "),
        firstName: p.Voornaam ?? null,
        lastName: p.Achternaam ?? null,
        patientNumber: p["Patiëntnummer"] ?? null,
        gender: p.Geslacht ?? null,
        dateOfBirth: p.Geboortedatum ?? null,
        email: p["E-mailadres"] ?? null,
        phone: p.Telefoonnummer ?? p["Mobiel nummer"] ?? null,
        // Location & address
        city: p.Plaats ?? null,
        postcode: p.Postcode ?? null,
        address: p["Adresregel 1"] ?? null,
        province: p["Staat/provincie/county"] ?? null,
        // History
        registered: p.Geregistreerd ?? null,
        firstVisit: p["Eerste dossier"] ?? null,
        lastVisit: p["Laatste dossier"] ?? null,
        visitCount: p.Dossiers ?? 0,
        treatmentCount: p.Behandelingsdossiers ?? 0,
        totalSpend: p["Totale besteding (incl. belastingen, excl. cadeaubonnen)"] ?? 0,
        referral: p.Referentie ?? null,
        // Flags — critical for bot behavior
        notWelcome: p["Niet welkom"] === true,
        blockOnlineBooking: p["Verbied online boeken"] === true,
        // Staff notes — shown to Moumen in Telegram
        attention: p.Attentie ?? null,
        warning: p.Waarschuwing ?? null,
        notes: p.Notities ?? null,
      };

      // Index by both phone and mobile number
      const phone1 = normalizeForCache(p.Telefoonnummer);
      const phone2 = normalizeForCache(p["Mobiel nummer"]);
      if (phone1) patientCache.set(phone1, patient);
      if (phone2) patientCache.set(phone2, patient);
    }

    lastRefresh = Date.now();
    console.log(`[clinicminds] Cache loaded: ${patientCache.size} entries from ${data.length} patients (was ${prevSize})`);
    logEvent({ type: "clinicminds_cache_loaded", entries: patientCache.size, patients: data.length });
  } catch (err) {
    console.error("[clinicminds] Cache load failed:", err.message);
    logEvent({ type: "clinicminds_cache_error", error: err.message });
  }
}

/**
 * Start auto-refresh timer (every 2 weeks).
 */
export function startCacheRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    loadPatientCache().catch(err =>
      console.error("[clinicminds] Auto-refresh failed:", err.message)
    );
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref();
}

/**
 * Lookup patient by phone — instant from cache, fallback to T&A API.
 */
export async function lookupPatientByPhone(rawPhone) {
  const normalized = normalizePhone(rawPhone);
  if (!normalized || normalized.length < 8) return null;

  // 1. Check cache (instant)
  const cached = patientCache.get(normalized);
  if (cached) {
    logEvent({ type: "clinicminds_cache_hit" });
    return cached;
  }

  // 2. Cache miss — try T&A API (for brand new patients not yet in cache)
  try {
    const res = await fetch(
      `https://app.clinicminds.com/api/triggers-actions/patients?phone=${encodeURIComponent(normalized)}`,
      {
        headers: {
          "X-Api-Key": process.env.CLINICMINDS_TA_API_KEY ?? "",
          "User-Agent": "Radiance-WhatsApp-Bot/2.0",
        },
        signal: AbortSignal.timeout(2000),
      }
    );

    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      logEvent({ type: "clinicminds_auth_error", status: res.status });
      return null;
    }
    if (!res.ok) throw new Error(`Clinicminds T&A error: ${res.status}`);

    const data = await res.json();
    const patient = data.patient ?? null;

    // Add to cache so next message is instant
    if (patient) patientCache.set(normalized, patient);

    logEvent({ type: "clinicminds_cache_miss" });
    return patient;
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      logEvent({ type: "clinicminds_timeout" });
      return null;
    }
    throw err;
  }
}

export function getCacheStats() {
  return {
    size: patientCache.size,
    lastRefresh: lastRefresh ? new Date(lastRefresh).toISOString() : null,
    refreshIntervalDays: 7,
  };
}

// ── Sync lookups (cache-only, voor dashboard server.js) ──────────────────

/**
 * Sync lookup van patiëntobject op basis van JID of telefoonnummer.
 * Werkt alleen vanuit de in-memory cache (geen async API calls).
 * Geeft null terug als de patiënt niet in de cache staat.
 */
export function getPatientInfoSync(jidOrPhone) {
  const raw = String(jidOrPhone).replace(/@.+/, '');
  const normalized = normalizePhone(raw);
  return patientCache.get(normalized) ?? null;
}

/**
 * Sync lookup van patiëntnaam. Verkorte versie van getPatientInfoSync.
 */
export function getPatientNameSync(jidOrPhone) {
  return getPatientInfoSync(jidOrPhone)?.fullName ?? null;
}
