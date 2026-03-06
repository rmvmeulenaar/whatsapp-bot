import { setTakeover } from "../../whatsapp/takeover.js";

export async function escalationNode(state) {
  setTakeover(state.jid);

  return {
    output: "Ik schakel een collega in die je verder kan helpen. Een moment alsjeblieft.",
    node_trace: ["escalation:triggered"],
  };
}
