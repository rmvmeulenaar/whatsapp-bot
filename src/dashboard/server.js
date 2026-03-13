import polka from "polka";
import { getPatientInfoSync, getPatientNameSync } from "../integrations/clinicminds.js";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createHmac, randomBytes } from "crypto";
import {
  db,
  getRecentEntries, updateFeedback, subscribers,
  getAllPendingSuggestions, getPendingSuggestion,
  rejectSuggestion, claimSuggestion, resetSuggestionToPending,
  finalizeSuggestionApproval,
  getConversationList, getConversationMessages, getConversationMode,
  getDailyWatchMetrics, getDailySuggestionMetrics, getLastMessagesForJid,
  setConversationMode
} from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT ?? 3001);

// ── Auth config ──────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const SESSION_SECRET = process.env.DASHBOARD_SESSION_SECRET ?? randomBytes(32).toString("hex");
const SESSION_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds
const ALLOWED_EMAILS = new Set([
  "info@praktijkvoorinjectables.nl",
  "rmvmeulenaar@gmail.com",
]);

// ── Cookie helpers (signed, no dependencies) ─────────────────────────────
function signValue(value) {
  return value + "." + createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function verifySignedValue(signed) {
  if (!signed || typeof signed !== "string") return null;
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const expected = signValue(value);
  if (signed.length !== expected.length) return null;
  // Constant-time comparison
  let match = true;
  for (let i = 0; i < signed.length; i++) {
    if (signed[i] !== expected[i]) match = false;
  }
  return match ? value : null;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) cookies[k.trim()] = decodeURIComponent(v.join("="));
  }
  return cookies;
}

function setSessionCookie(res, email) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = JSON.stringify({ email, expires });
  const signed = signValue(Buffer.from(payload).toString("base64url"));
  const expDate = new Date(expires * 1000).toUTCString();
  res.setHeader("Set-Cookie", `molty_session=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}; Expires=${expDate}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "molty_session=; Path=/; HttpOnly; Max-Age=0");
}

function getSessionEmail(req) {
  const cookies = parseCookies(req.headers.cookie);
  const signed = cookies.molty_session;
  if (!signed) return null;
  const decoded = verifySignedValue(signed);
  if (!decoded) return null;
  try {
    const payload = JSON.parse(Buffer.from(decoded, "base64url").toString());
    if (payload.expires < Math.floor(Date.now() / 1000)) return null;
    if (!ALLOWED_EMAILS.has(payload.email)) return null;
    return payload.email;
  } catch { return null; }
}

// ── Google token verification (no library needed) ────────────────────────
async function verifyGoogleToken(credential) {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Verify audience matches our client ID
    if (data.aud !== GOOGLE_CLIENT_ID) return null;
    // Verify email is verified
    if (data.email_verified !== "true") return null;
    return data.email?.toLowerCase() ?? null;
  } catch { return null; }
}

// ── Auth middleware ──────────────────────────────────────────────────────
function requireAuth(req, res) {
  if (!GOOGLE_CLIENT_ID) {
    // OAuth not configured — allow access (backwards compatible)
    return true;
  }
  const email = getSessionEmail(req);
  if (!email) {
    // Not authenticated — serve login page
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(LOGIN_HTML);
    return false;
  }
  return true;
}

// ── Load HTML templates ─────────────────────────────────────────────────
let UI_HTML = "";
try {
  UI_HTML = readFileSync(join(__dirname, "ui.html"), "utf8");
} catch {
  UI_HTML = "<html><head></head><body><h1>Dashboard UI not found</h1></body></html>";
}

let LOGIN_HTML = "";
try {
  LOGIN_HTML = readFileSync(join(__dirname, "login.html"), "utf8");
} catch {
  LOGIN_HTML = "<html><body><h1>Login page not found</h1></body></html>";
}
// Inject the Google Client ID into login page
LOGIN_HTML = LOGIN_HTML.replace("__GOOGLE_CLIENT_ID__", GOOGLE_CLIENT_ID);

// ── Dashboard server ────────────────────────────────────────────────────
export function startDashboard() {
  polka()
    // Auth endpoints (no auth required)
    .post("/auth/google", async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (!GOOGLE_CLIENT_ID) {
        res.statusCode = 503;
        res.end(JSON.stringify({ ok: false, error: "Google OAuth niet geconfigureerd." }));
        return;
      }
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { credential } = JSON.parse(body);
        const email = await verifyGoogleToken(credential);
        if (!email) {
          res.statusCode = 401;
          res.end(JSON.stringify({ ok: false, error: "Ongeldig Google-token." }));
          return;
        }
        if (!ALLOWED_EMAILS.has(email)) {
          res.statusCode = 403;
          res.end(JSON.stringify({ ok: false, error: `${email} heeft geen toegang tot dit dashboard.` }));
          return;
        }
        setSessionCookie(res, email);
        res.end(JSON.stringify({ ok: true, email }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    })
    .get("/auth/logout", (_req, res) => {
      clearSessionCookie(res);
      res.writeHead(302, { Location: "/" });
      res.end();
    })
    .get("/login", (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(LOGIN_HTML);
    })
    .get("/assets/clinic-bg.png", (_req, res) => {
      const imgPath = join(__dirname, "clinic-bg.png");
      if (existsSync(imgPath)) {
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.end(readFileSync(imgPath));
      } else {
        res.statusCode = 404;
        res.end("Not found");
      }
    })

    // Protected routes
    .get("/", (req, res) => {
      if (!requireAuth(req, res)) return;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(UI_HTML);
    })
    .get("/api/entries", (req, res) => {
      if (!requireAuth(req, res)) return;
      const limit = parseInt(req.query?.limit ?? "50", 10);
      const entries = getRecentEntries.all(Math.min(limit, 200));
      const enriched = entries.map(e => ({
        ...e,
        display_name: getPatientNameSync(e.jid),
      }));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(enriched));
    })
    .get("/api/stream", (req, res) => {
      if (!requireAuth(req, res)) return;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      subscribers.add(res);
      req.socket.on("close", () => subscribers.delete(res));
      res.write(": connected\n\n");
    })
    .post("/api/feedback", async (req, res) => {
      if (!requireAuth(req, res)) return;
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { id, feedback, correction } = JSON.parse(body);
        updateFeedback.run({ id: Number(id), feedback: feedback ?? null, correction: correction ?? null });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    })
    .get("/api/pending", (req, res) => {
      if (!requireAuth(req, res)) return;
      const rows = getAllPendingSuggestions();
      const enriched = rows.map(row => {
        const context = getLastMessagesForJid.all(row.jid);
        return {
          ...row,
          display_name: getPatientNameSync(row.jid),
          context: context.reverse(), // reverse: oldest first
        };
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(enriched));
    })
    .post("/api/approve", async (req, res) => {
      if (!requireAuth(req, res)) return;
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { id, editedMessage } = JSON.parse(body);
        const numId = Number(id);
        const claimed = claimSuggestion(numId);
        if (!claimed.ok) {
          res.statusCode = 409;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Already handled" }));
          return;
        }
        const pending = getPendingSuggestion(numId);
        try {
          const { sendText } = await import("../whatsapp/outbound.js");
          const { getSocket } = await import("../whatsapp/connection.js");
          const sock = getSocket();
          const textToSend = editedMessage || pending.proposed_message;
          const sendResult = await sendText(sock, pending.jid, textToSend);
          if (sendResult && sendResult.sent === false) {
            resetSuggestionToPending(numId);
            res.statusCode = 429;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: 'Rate limited — probeer opnieuw' }));
            return;
          }
        } catch (sendErr) {
          console.error("[dashboard] WhatsApp send failed, resetting claim:", sendErr.message);
          resetSuggestionToPending(numId);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: 'Sturen mislukt: ' + sendErr.message }));
          return;
        }
        finalizeSuggestionApproval(numId, 0, editedMessage || null);
        if (pending.sms_params) {
          const apiBase = process.env.PVI_API_BASE ?? 'https://pvi-voicebot.vercel.app';
          const secret = process.env.PVI_WEBHOOK_SECRET ?? '';
          fetch(`${apiBase}/tools/send-booking-sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret },
            body: pending.sms_params,
            signal: AbortSignal.timeout(8000),
          }).catch(e => console.error('[dashboard] SMS failed:', e.message));
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    })
    .post("/api/reject", async (req, res) => {
      if (!requireAuth(req, res)) return;
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { id } = JSON.parse(body);
        const result = rejectSuggestion(Number(id), 0);
        if (!result.ok) {
          res.statusCode = 409;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Already handled" }));
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    })
    .get("/api/conversations", (req, res) => {
      if (!requireAuth(req, res)) return;
      const list = getConversationList.all();
      const modes = getConversationMode.all();
      const modeMap = Object.fromEntries(modes.map(m => [m.jid, m]));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(list.map(c => {
        const patient = getPatientInfoSync(c.jid);
        return {
          ...c,
          mode: modeMap[c.jid]?.mode ?? "suggest",
          display_name: patient?.fullName ?? null,
          patient: patient ? {
            fullName: patient.fullName,
            visitCount: patient.visitCount,
            totalSpend: patient.totalSpend,
            city: patient.city,
            lastVisit: patient.lastVisit,
            notWelcome: patient.notWelcome,
            blockOnlineBooking: patient.blockOnlineBooking,
            warning: patient.warning,
            attention: patient.attention,
          } : null,
        };
      })));
    })
    .get("/api/conversations/:jid/messages", (req, res) => {
      if (!requireAuth(req, res)) return;
      const jid = decodeURIComponent(req.params.jid);
      // Phase 10: UNION query needs jid twice (watch_entries + outgoing_messages)
      const messages = getConversationMessages.all(jid, jid);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(messages));
    })
    .post("/api/entries/:id/feedback", async (req, res) => {
      if (!requireAuth(req, res)) return;
      const entryId = Number(req.params.id);
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { feedback } = JSON.parse(body); // 'good' | 'bad' | 'irrelevant'
        if (!["good", "bad", "irrelevant"].includes(feedback)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "Invalid feedback value" }));
          return;
        }
        db.prepare("UPDATE watch_entries SET feedback = ? WHERE id = ?").run(feedback, entryId);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    })
    .post("/api/conversations/:jid/mode", async (req, res) => {
      if (!requireAuth(req, res)) return;
      const jid = decodeURIComponent(req.params.jid);
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { mode } = JSON.parse(body);
        if (!["watch", "suggest", "auto"].includes(mode)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Invalid mode — use watch, suggest, or auto" }));
          return;
        }
        setConversationMode.run({ jid, mode });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    })
    .get("/api/metrics/daily", (req, res) => {
      if (!requireAuth(req, res)) return;
      const watchMetrics = getDailyWatchMetrics.all();
      const suggMetrics = getDailySuggestionMetrics.all();
      const suggMap = Object.fromEntries(suggMetrics.map(s => [s.day, s]));
      const merged = watchMetrics.map(w => ({
        day: w.day,
        total_messages: w.total_messages,
        avg_latency_ms: w.avg_latency_ms,
        with_reply: w.with_reply,
        safety_fails: w.safety_fails,
        suggestions: suggMap[w.day]?.total_suggestions ?? 0,
        approved: suggMap[w.day]?.approved ?? 0,
        rejected: suggMap[w.day]?.rejected ?? 0,
        approval_rate: (suggMap[w.day]?.total_suggestions > 0)
          ? Math.round((suggMap[w.day].approved / suggMap[w.day].total_suggestions) * 100)
          : null,
      }));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(merged));
    })
    .listen(PORT, (err) => {
      if (err) {
        console.error("Dashboard failed to start:", err);
        return;
      }
      console.log(`Dashboard: http://localhost:${PORT}`);
      if (GOOGLE_CLIENT_ID) {
        console.log(`[dashboard] Google OAuth active — ${ALLOWED_EMAILS.size} whitelisted emails`);
      } else {
        console.log("[dashboard] ⚠️  No GOOGLE_CLIENT_ID — dashboard is UNPROTECTED");
      }
    });
}
