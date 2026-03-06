import { openrouterClient } from "./client.js";

const PRIMARY_MODEL = "deepseek/deepseek-v3.2";
const FALLBACK_MODEL = "google/gemini-2.5-flash";

export async function generateReply(systemPrompt, history, userMessage, temperature = 0.3) {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10),
    { role: "user", content: userMessage },
  ];

  const t0 = Date.now();
  let model = PRIMARY_MODEL;

  try {
    const completion = await openrouterClient.chat.completions.create(
      { model, messages, max_tokens: 350, temperature },
      { signal: AbortSignal.timeout(8000) }
    );

    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error("Empty response from LLM");

    return {
      text: text.trim().replace(/\*\*/g, "").replace(/#{1,6} /g, ""),
      model,
      tokens: completion.usage,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    if (err.status === 429 || err.status === 503 || (err.status >= 500 && err.status < 600)) {
      model = FALLBACK_MODEL;
      const completion = await openrouterClient.chat.completions.create(
        { model, messages, max_tokens: 350, temperature },
        { signal: AbortSignal.timeout(8000) }
      );
      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("Empty fallback response from LLM");
      return {
        text: text.trim().replace(/\*\*/g, "").replace(/#{1,6} /g, ""),
        model,
        tokens: completion.usage,
        latencyMs: Date.now() - t0,
      };
    }
    throw err;
  }
}
