// WhatsApp socket lifecycle, auth, reconnect with exponential backoff
// Source: whatsapp-api-blueprint.md (reverse-engineered from OpenClaw production)
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";
import pino from "pino";
import { logConnection, logError } from "../logging/logger.js";
import { sendDisconnectAlert } from "../integrations/telegram.js";

const AUTH_DIR = "/opt/whatsapp-bot/auth";

// Suppress Baileys internal logs — they are noisy and not useful at runtime
const silentLogger = pino({ level: "silent" });

let currentSock = null;
let reconnectAttempts = 0;

// Exponential backoff config — production-proven from OpenClaw
const RECONNECT_CONFIG = {
  initialDelay: 2000,
  maxDelay: 30000,
  factor: 1.8,
  jitter: 0.25,
  maxAttempts: 12
};

function calculateBackoff(attempt) {
  const base = RECONNECT_CONFIG.initialDelay * Math.pow(RECONNECT_CONFIG.factor, attempt);
  const capped = Math.min(base, RECONNECT_CONFIG.maxDelay);
  const jitter = capped * RECONNECT_CONFIG.jitter * (Math.random() * 2 - 1);
  return Math.round(capped + jitter);
}

export async function createSocket(onMessage) {
  // Remove listeners before creating new socket to prevent accumulation across reconnects
  // Without this, after N reconnects each event fires N times (Pitfall #13)
  if (currentSock) {
    currentSock.ev.removeAllListeners();
    currentSock.end();
    currentSock = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  let version;
  try {
    const result = await fetchLatestBaileysVersion();
    version = result.version;
  } catch (err) {
    // Fallback to bundled version if WhatsApp servers unreachable at startup
    logError(err, { context: "fetchLatestBaileysVersion_fallback" });
    version = [2, 3000, 1023126643];
  }

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger)
    },
    version,
    logger: silentLogger,
    printQRInTerminal: false,    // No QR — we have existing auth from OpenClaw
    browser: ["RadianceBot", "cli", "1.0.0"],
    syncFullHistory: false,       // Don't load historical messages on connect
    markOnlineOnConnect: false    // Don't expose presence as "online"
  });

  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // QR appearing means auth is invalid — auth corruption or session was invalidated
      logConnection("qr_requested");
      console.error("[FATAL] QR code requested — auth state invalid. Check /opt/whatsapp-bot/auth/");
      process.exit(1);
    }

    if (connection === "open") {
      reconnectAttempts = 0;
      logConnection("connected");
      console.log("[WA] Connected to WhatsApp");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        // Account banned or forcibly logged out — auto-reconnect would be harmful
        logConnection("logged_out", { statusCode });
        console.error("[FATAL] Logged out (banned?). StatusCode:", statusCode);
        process.exit(1);
      }

      if (reconnectAttempts >= RECONNECT_CONFIG.maxAttempts) {
        logConnection("max_reconnects_reached", { attempts: reconnectAttempts });
        console.error("[FATAL] Max reconnect attempts reached. Exiting.");
        process.exit(1);
      }

      const delay = calculateBackoff(reconnectAttempts++);
      logConnection("reconnecting", { attempt: reconnectAttempts, delayMs: delay, statusCode });
      console.log(`[WA] Disconnected. Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

      // Phase 5: stuur Telegram alert bij disconnect (non-blocking — mag reconnect flow niet vertragen)
      sendDisconnectAlert(lastDisconnect?.error?.message ?? 'onbekend').catch(() => {});

      setTimeout(() => createSocket(onMessage), delay);
    }
  });

  // Register inbound handler — passed from index.js so it survives reconnects
  sock.ev.on("messages.upsert", onMessage);

  return sock;
}

export function getSocket() {
  return currentSock;
}
