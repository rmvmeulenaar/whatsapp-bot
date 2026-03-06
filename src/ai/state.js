import { Annotation } from "@langchain/langgraph";

export const BotStateAnnotation = Annotation.Root({
  jid:     Annotation(),
  body:    Annotation(),
  ts:      Annotation(),
  mode:    Annotation(),
  clinic:  Annotation(),
  patient: Annotation({ default: () => null }),
  intent:  Annotation({
    reducer: (cur, upd) => ({ ...cur, ...upd }),
    default: () => ({ labels: [], confidence: 0, method: "none" }),
  }),
  results: Annotation({
    reducer: (cur, upd) => cur.concat(Array.isArray(upd) ? upd : [upd]),
    default: () => [],
  }),
  history: Annotation({
    reducer: (cur, upd) => cur.concat(Array.isArray(upd) ? upd : [upd]).slice(-2),
    default: () => [],
  }),
  output:  Annotation({ default: () => null }),
  error:   Annotation({ default: () => null }),
  node_trace: Annotation({
    reducer: (cur, upd) => cur.concat(Array.isArray(upd) ? upd : [upd]),
    default: () => [],
  }),
});
