// JSONL structured logger with daily file rotation via pino-roll
// Source: STACK.md (pino + pino-roll), ARCHITECTURE.md (JSONL format)
import pino from "pino";
import { join } from "path";
import { mkdirSync } from "fs";

const LOG_DIR = "/opt/whatsapp-bot/logs";

// Ensure log dir exists before transport initializes
mkdirSync(LOG_DIR, { recursive: true });

// pino-roll rotates daily and also on 50MB size limit
const transport = pino.transport({
  target: "pino-roll",
  options: {
    file: join(LOG_DIR, "bot.jsonl"),
    frequency: "daily",
    mkdir: true,
    size: "50m"
  }
});

const logger = pino(
  {
    level: "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    base: null,    // Omit pid and hostname from every log line
    formatters: {
      level: (label) => ({ level: label })
    }
  },
  transport
);

// Log a structured inbound/outbound/system event
export function logEvent(data) {
  logger.info(data);
}

// Log connection lifecycle state changes
export function logConnection(state, details = {}) {
  logger.info({ type: "connection", state, ...details });
}

// Log errors with stack trace
export function logError(error, context = {}) {
  logger.error({ type: "error", message: error.message, stack: error.stack, ...context });
}

export default logger;
