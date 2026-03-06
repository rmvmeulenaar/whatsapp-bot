const BOOKING_BASE = "https://schedule.clinicminds.com/book";

const TREATMENT_SLUGS = {
  botox: "botox",
  filler: "filler",
  lip: "lip-filler",
  "lip filler": "lip-filler",
  skinbooster: "skinbooster",
  microneedling: "microneedling",
  "chemical peel": "chemical-peel",
  peel: "chemical-peel",
  prp: "prp",
  laser: "laser",
};

const LOCATION_IDS = {
  nijmegen: "nijmegen",
  amsterdam: "amsterdam",
  utrecht: "utrecht",
  eindhoven: "eindhoven",
  "den haag": "den-haag",
  rotterdam: "rotterdam",
  radiance: "radiance",
};

export async function bookingLinkNode(state) {
  const text = state.body.toLowerCase();

  let treatment = null;
  for (const [key, slug] of Object.entries(TREATMENT_SLUGS)) {
    if (text.includes(key)) { treatment = slug; break; }
  }

  let location = null;
  for (const [key, id] of Object.entries(LOCATION_IDS)) {
    if (text.includes(key)) { location = id; break; }
  }

  if (!location && state.clinic && state.clinic !== "unknown") {
    location = state.clinic === "radiance" ? "radiance" : "nijmegen";
  }

  const params = new URLSearchParams();
  if (treatment) params.set("treatment", treatment);
  if (location) params.set("location", location);

  const url = params.toString() ? `${BOOKING_BASE}?${params}` : BOOKING_BASE;

  return {
    results: [{ node: "bookingLink", text: url, type: "link" }],
    node_trace: ["bookingLink:done"],
  };
}
