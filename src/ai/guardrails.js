export function withGuardrails(nodeFn, rules = []) {
  const wrapped = async function guardedNode(state) {
    try {
      const result = await nodeFn(state);
      for (const rule of rules) {
        const violation = rule(result, state);
        if (violation) {
          return { error: violation, node_trace: [nodeFn.name + ":guardrail_fail"] };
        }
      }
      return result;
    } catch (err) {
      return { error: err.message, node_trace: [nodeFn.name + ":error"] };
    }
  };
  Object.defineProperty(wrapped, "name", { value: nodeFn.name });
  return wrapped;
}
