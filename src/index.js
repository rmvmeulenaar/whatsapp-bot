// Entry point — wires connection, inbound pipeline, logger, and dashboard
// Phase 1: receive and log only. No AI. No responses.
// Phase 2: AI pipeline + dashboard added
import { createSocket } from "./whatsapp/connection.js";
import { createInboundHandler } from "./whatsapp/inbound.js";
import { logConnection, logError } from "./logging/logger.js";
import { startDashboard } from "./dashboard/server.js";

logConnection("starting");

// Phase 1: handler logs the event (already done in inbound.js) and prints to console
const onMessage = createInboundHandler(async (event) => {
  console.log(`[MSG] ${event.name} (${event.jid}): ${event.body || "[media/no-text]"}`);
});

try {
  await createSocket(onMessage);
  logConnection("socket_created");
} catch (err) {
  logError(err, { context: "startup" });
  process.exit(1);
}

// Start dashboard server (Phase 2)
startDashboard();

// Graceful shutdown on SIGTERM (PM2 stop / system shutdown)
process.on("SIGTERM", () => {
  logConnection("shutdown", { reason: "SIGTERM" });
  process.exit(0);
});
