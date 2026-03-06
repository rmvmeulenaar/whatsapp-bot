import { validateOutput } from "../safety.js";
import { loadPriceWhitelist } from "../priceWhitelist.js";

const priceWhitelist = loadPriceWhitelist();

export async function guardrailNode(state) {
  if (!state.output) {
    return { node_trace: ["guardrail:no_output"] };
  }

  const safetyResult = validateOutput(state.output, state.body, priceWhitelist);

  if (!safetyResult.pass) {
    return {
      output: safetyResult.text,
      error: `guardrail_blocked: ${safetyResult.reason}`,
      node_trace: [`guardrail:blocked:${safetyResult.reason}`],
    };
  }

  return {
    output: safetyResult.text,
    node_trace: ["guardrail:passed"],
  };
}
