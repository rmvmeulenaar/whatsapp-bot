// Entry point — wires connection, inbound pipeline, logger, dashboard, telegram, and patient cache
import { createSocket } from "./whatsapp/connection.js";
import { createInboundHandler } from "./whatsapp/inbound.js";
import { logConnection, logError } from "./logging/logger.js";
import { startDashboard } from "./dashboard/server.js";
import { startTelegramBot, stopTelegramBot } from "./integrations/telegram.js";
import { loadPatientCache, startCacheRefresh } from "./integrations/clinicminds.js";

logConnection("starting");

// Load patient cache from Clinicminds Analytics API (non-blocking)
loadPatientCache()
  .then(() => startCacheRefresh())
  .catch(err => console.error("[startup] Patient cache load failed:", err.message));

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

startDashboard();
startTelegramBot();

process.on("SIGTERM", async () => {
  try {
    await stopTelegramBot();
  } catch (_) {}
  logConnection("shutdown", { reason: "SIGTERM" });
  process.exit(0);
});
