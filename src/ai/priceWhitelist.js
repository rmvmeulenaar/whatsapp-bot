import { readFileSync } from "fs";

const PRIJZEN_PATH = (process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis") + "/prijzen.md";

export function loadPriceWhitelist() {
  try {
    const content = readFileSync(PRIJZEN_PATH, "utf8");
    const matches = content.match(/\b\d+\b/g) ?? [];
    return [...new Set(matches.map(Number))];
  } catch {
    return []; // fail-safe: empty whitelist — all prices flagged
  }
}
