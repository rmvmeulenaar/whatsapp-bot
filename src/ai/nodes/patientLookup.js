import { lookupPatientByPhone, normalizePhone } from "../../integrations/clinicminds.js";

export async function patientLookupNode(state) {
  try {
    const phone = normalizePhone(state.jid.split("@")[0]);
    const patient = await lookupPatientByPhone(phone);

    // BUG-08 FIX: Preserve state.clinic when it has been set (not "unknown")
    // Only fall back to "pvi" when no admin has set a clinic AND patient is found
    const clinic = state.clinic !== "unknown" ? state.clinic : (patient ? "pvi" : "unknown");

    return {
      patient,
      clinic,
      node_trace: [patient ? "patientLookup:found" : "patientLookup:not_found"],
    };
  } catch (err) {
    return {
      patient: null,
      node_trace: ["patientLookup:error"],
    };
  }
}
