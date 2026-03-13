import { prijsNode } from "./prijs.js";
import { vestigingNode } from "./vestiging.js";
import { tijdenNode } from "./tijden.js";
import { behandelingNode } from "./behandeling.js";
import { faqNode } from "./faq.js";
import { bookingLinkNode } from "./bookingLink.js";

const NODE_MAP = { prijs: prijsNode, vestiging: vestigingNode, tijden: tijdenNode, behandeling: behandelingNode, faq: faqNode, bookingLink: bookingLinkNode };

// BUG 13 FIX: Only skip nodes that OVERLAP with bookingLink content.
// bookingLink overlaps with: behandeling (treatment info), vestiging (location info)
// bookingLink does NOT overlap with: prijs, tijden, faq
const BOOKING_OVERLAPS = new Set(["behandeling", "vestiging"]);

export async function dispatcherNode(state) {
  const labels = state.intent?.labels ?? [];
  const validNodes = Object.keys(NODE_MAP);
  const mapped = labels.map(l => l === "booking" ? "bookingLink" : l);
  const targets = mapped.filter(l => validNodes.includes(l));

  let toRun;
  if (targets.includes("bookingLink")) {
    // BUG 13 FIX: Keep prijs, tijden, faq alongside bookingLink — only skip overlapping nodes
    toRun = targets.filter(t => t === "bookingLink" || !BOOKING_OVERLAPS.has(t));
    if (toRun.length === 0) toRun = ["bookingLink"];
  } else {
    toRun = targets.length > 0 ? targets : ["faq"];
  }

  // Run relevant content nodes in parallel
  const results = await Promise.all(
    toRun.map(name => NODE_MAP[name](state).catch(err => ({
      results: [{ node: name, text: null, type: "text" }],
      node_trace: [name + ":error:" + err.message.slice(0, 40)],
    })))
  );

  const combined = results.flatMap(r => r.results ?? []);
  const traces = results.flatMap(r => r.node_trace ?? []);

  return {
    results: combined,
    node_trace: ["dispatcher:done:" + toRun.join("+"), ...traces],
  };
}
