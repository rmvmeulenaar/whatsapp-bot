import { readFileSync } from "fs";
import { join } from "path";

const KENNIS_DIR = process.env.KENNIS_DIR ?? "/opt/whatsapp-bot/kennis";

export function loadKennis(files) {
  return files
    .map(name => {
      try {
        return readFileSync(join(KENNIS_DIR, name), "utf8");
      } catch {
        return ""; // Missing file → empty, silent (log in prod)
      }
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function getKennisBlock(clinicContext) {
  const base = ["faq.md", "openingstijden.md", "vestigingen.md", "prijzen.md"];
  const behandelingen = clinicContext === "radiance"
    ? ["behandelingen-radiance.md"]
    : clinicContext === "pvi"
    ? ["behandelingen-pvi.md"]
    : ["behandelingen-radiance.md", "behandelingen-pvi.md"];

  return loadKennis([...behandelingen, ...base]);
}
