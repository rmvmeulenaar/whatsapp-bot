import { geminiClient } from "./client.js";
import { Langfuse } from "langfuse";

const PRIMARY_MODEL = "gemini-2.0-flash";
const FALLBACK_MODEL = "gemini-2.5-flash";

// Langfuse singleton — reads LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL from env
let lf;
try {
  lf = new Langfuse({ flushAtExit: true });
} catch {
  lf = null;
}

export async function generateReply(systemPrompt, history, userMessage, temperature = 0.3, meta = {}) {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10),
    { role: "user", content: userMessage },
  ];

  const t0 = Date.now();
  let model = PRIMARY_MODEL;

  // Langfuse trace (non-blocking — errors must never propagate)
  let trace = null, generation = null;
  try {
    if (lf) {
      trace = lf.trace({
        name: "molty-suggestion",
        input: { userMessage, systemPromptPreview: systemPrompt.slice(0, 400) },
        metadata: { intent: meta.intent ?? null, jid: meta.jid ?? null },
      });
      generation = trace.generation({
        name: "llm-call",
        model,
        input: messages,
        modelParameters: { max_tokens: 350, temperature },
      });
    }
  } catch {}

  try {
    const completion = await geminiClient.chat.completions.create(
      { model, messages, max_tokens: 350, temperature },
      { signal: AbortSignal.timeout(8000) }
    );

    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error("Empty response from LLM");

    const result = {
      text: text.trim().replace(/\*\*/g, "").replace(/#{1,6} /g, ""),
      model,
      tokens: completion.usage,
      latencyMs: Date.now() - t0,
    };

    try {
      if (generation) generation.end({ output: result.text, usage: completion.usage });
      if (trace) trace.update({ output: result.text });
    } catch {}

    return result;
  } catch (err) {
    if (err.status === 429 || err.status === 503 || (err.status >= 500 && err.status < 600)) {
      model = FALLBACK_MODEL;
      try {
        if (generation) generation.end({ level: "WARNING", statusMessage: `fallback: ${err.message}` });
        if (trace) {
          generation = trace.generation({
            name: "llm-call-fallback",
            model,
            input: messages,
            modelParameters: { max_tokens: 350, temperature },
          });
        }
      } catch {}

      const completion = await geminiClient.chat.completions.create(
        { model, messages, max_tokens: 350, temperature },
        { signal: AbortSignal.timeout(8000) }
      );
      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("Empty fallback response from LLM");

      const result = {
        text: text.trim().replace(/\*\*/g, "").replace(/#{1,6} /g, ""),
        model,
        tokens: completion.usage,
        latencyMs: Date.now() - t0,
      };

      try {
        if (generation) generation.end({ output: result.text, usage: completion.usage });
        if (trace) trace.update({ output: result.text });
      } catch {}

      return result;
    }

    try {
      if (generation) generation.end({ level: "ERROR", statusMessage: err.message });
    } catch {}

    throw err;
  }
}
