import { lookupPatientByPhone, normalizePhone } from "../../integrations/clinicminds.js";

export async function patientLookupNode(state) {
  try {
    const phone = normalizePhone(state.jid.split("@")[0]);
    const patient = await lookupPatientByPhone(phone);

    const clinic = patient?.location?.toLowerCase().includes("radiance")
      ? "radiance"
      : patient ? "pvi" : state.clinic;

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
