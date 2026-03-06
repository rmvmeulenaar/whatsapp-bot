const LABEL_PRIORITY = ["prijs", "vestiging", "tijden", "behandeling", "faq", "bookingLink"];

export async function mergeNode(state) {
  const results = state.results ?? [];
  if (results.length === 0) {
    return { output: null, node_trace: ["merge:empty"] };
  }

  // Sort text results by label priority (deterministic order for multi-label)
  const textResults = results
    .filter(r => r.type !== "link")
    .sort((a, b) => LABEL_PRIORITY.indexOf(a.node) - LABEL_PRIORITY.indexOf(b.node));
  const linkResults = results.filter(r => r.type === "link");

  let output = textResults.map(r => r.text).filter(Boolean).join("\n\n");

  if (linkResults.length > 0) {
    output += (output ? "\n\n" : "") + "Je kunt hier een afspraak maken: " + linkResults[0].text;
  }

  return {
    output: output || null,
    node_trace: ["merge:done:" + results.map(r => r.node).join("+")],
  };
}
