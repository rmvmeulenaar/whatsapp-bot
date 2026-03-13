import OpenAI from "openai";

const geminiClient = new OpenAI({
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  apiKey: process.env.GEMINI_API_KEY,
});

// Keep openrouterClient for backwards compat (unused if OpenRouter key is invalid)
const openrouterClient = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://radianceclinic.nl",
    "X-Title": "Radiance WhatsApp Bot",
  },
});

export { geminiClient, openrouterClient };
