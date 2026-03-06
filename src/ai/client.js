import OpenAI from "openai";

const openrouterClient = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://radiance.clinic",
    "X-Title": "Radiance WhatsApp Bot",
  },
});

export { openrouterClient };
