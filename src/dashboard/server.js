import polka from "polka";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  getRecentEntries, updateFeedback, subscribers,
  getAllPendingSuggestions, approveSuggestion, rejectSuggestion, getPendingSuggestion
} from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT ?? 3001);
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'radiance-dashboard';

let UI_HTML_RAW = "";
try {
  UI_HTML_RAW = readFileSync(join(__dirname, "ui.html"), "utf8");
} catch {
  UI_HTML_RAW = "<html><head></head><body><h1>Dashboard UI not found</h1></body></html>";
}

// Inject dashboard token into ui.html at serve time so fetch() calls can use it
function buildHtml() {
  const tokenScript = `<script>window.__DASHBOARD_TOKEN__ = '${DASHBOARD_API_KEY}';</script>`;
  return UI_HTML_RAW.replace('</head>', tokenScript + '</head>');
}

// Check API token from header
function checkToken(req) {
  return (req.headers['x-dashboard-token'] || '') === DASHBOARD_API_KEY;
}

function unauthorizedJson(res) {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
}

export function startDashboard() {
  const UI_HTML = buildHtml();

  polka()
    .get("/", (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(UI_HTML);
    })
    .get("/api/entries", (req, res) => {
      if (!checkToken(req)) { unauthorizedJson(res); return; }
      const limit = parseInt(req.query?.limit ?? "50", 10);
      const entries = getRecentEntries.all(Math.min(limit, 200));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(entries));
    })
    .get("/api/stream", (req, res) => {
      // SSE: token via query param (EventSource API doesn't support custom headers)
      const urlToken = req.query?.token || '';
      if (urlToken !== DASHBOARD_API_KEY) {
        res.statusCode = 401;
        res.end("Unauthorized");
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      subscribers.add(res);
      req.socket.on("close", () => subscribers.delete(res));
      res.write(": connected\n\n");
    })
    .post("/api/feedback", async (req, res) => {
      if (!checkToken(req)) { unauthorizedJson(res); return; }
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
      if (!checkToken(req)) { unauthorizedJson(res); return; }
      const rows = getAllPendingSuggestions();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(rows));
    })
    .post("/api/approve", async (req, res) => {
      if (!checkToken(req)) { unauthorizedJson(res); return; }
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { id, editedMessage } = JSON.parse(body);
        // FIX 4: send FIRST, approve only after successful send
        const pending = getPendingSuggestion(Number(id));
        if (pending && pending.status === 'pending') {
          try {
            const { sendText } = await import("../whatsapp/outbound.js");
            const { getSocket } = await import("../whatsapp/connection.js");
            const sock = getSocket();
            const textToSend = editedMessage || pending.proposed_message;
            const sendResult = await sendText(sock, pending.jid, textToSend);
            if (sendResult && sendResult.sent === false) {
              res.statusCode = 429;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: 'Rate limited — probeer opnieuw' }));
              return;
            }
          } catch (sendErr) {
            console.error("[dashboard] WhatsApp send failed, not approving:", sendErr.message);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: 'Sturen mislukt: ' + sendErr.message }));
            return;
          }
        }
        // Send succeeded (or no pending row) — now approve in DB
        const result = approveSuggestion(Number(id), 0, editedMessage || null);
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
    .post("/api/reject", async (req, res) => {
      if (!checkToken(req)) { unauthorizedJson(res); return; }
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
    .listen(PORT, (err) => {
      if (err) {
        console.error("Dashboard failed to start:", err);
        return;
      }
      console.log(`Dashboard: http://localhost:${PORT}`);
    });
}
