import { logEvent } from "../logging/logger.js";

export function normalizePhone(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");

  // Handle various Dutch phone number formats
  if (digits.startsWith("316") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0031")) return `+31${digits.slice(4)}`;
  if (digits.startsWith("31") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("06") && digits.length === 10) return `+31${digits.slice(1)}`;
  if (digits.length === 9) return `+31${digits}`;
  // Default: prepend +
  return `+${digits}`;
}

export function maskPhone(jid) {
  if (!jid || typeof jid !== "string") return "unknown";
  // "+31652076089@s.whatsapp.net" → "+316520***89@s.whatsapp.net"
  const [phone, suffix] = jid.split("@");
  if (!phone || phone.length < 7) return jid;
  const masked = phone.slice(0, 7) + "***" + phone.slice(-2);
  return suffix ? `${masked}@${suffix}` : masked;
}

export async function lookupPatientByPhone(rawPhone) {
  const normalized = normalizePhone(rawPhone);
  if (!normalized || normalized.length < 8) return null;

  try {
    const res = await fetch(
      `https://app.clinicminds.com/api/triggers-actions/patients?phone=${encodeURIComponent(normalized)}`,
      {
        headers: {
          "X-Api-Key": process.env.CLINICMINDS_TA_API_KEY ?? "",
          "User-Agent": "Radiance-WhatsApp-Bot/2.0",  // Required, else 403
        },
        signal: AbortSignal.timeout(2000), // 2s timeout — non-fatal
      }
    );

    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      logEvent({ type: "clinicminds_auth_error", status: res.status });
      return null;
    }
    if (!res.ok) {
      throw new Error(`Clinicminds T&A error: ${res.status}`);
    }

    const data = await res.json();
    return data.patient ?? null;
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      logEvent({ type: "clinicminds_timeout" });
      return null;
    }
    throw err;
  }
}
