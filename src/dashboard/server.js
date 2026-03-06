import polka from "polka";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  getRecentEntries, updateFeedback, subscribers,
  getAllPendingSuggestions, getPendingSuggestion,
  rejectSuggestion, claimSuggestion, resetSuggestionToPending,
  finalizeSuggestionApproval
} from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT ?? 3001);

// Auth is handled by Nginx basic auth on port 80 (proxy → 3001).
// Port 3001 must be blocked externally by UFW: ufw deny in on eth0 to any port 3001
let UI_HTML = "";
try {
  UI_HTML = readFileSync(join(__dirname, "ui.html"), "utf8");
} catch {
  UI_HTML = "<html><head></head><body><h1>Dashboard UI not found</h1></body></html>";
}

export function startDashboard() {
  polka()
    .get("/", (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(UI_HTML);
    })
    .get("/api/entries", (req, res) => {
      const limit = parseInt(req.query?.limit ?? "50", 10);
      const entries = getRecentEntries.all(Math.min(limit, 200));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(entries));
    })
    .get("/api/stream", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      subscribers.add(res);
      req.socket.on("close", () => subscribers.delete(res));
      res.write(": connected\n\n");
    })
    .post("/api/feedback", async (req, res) => {
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
    .get("/api/pending", (_req, res) => {
      const rows = getAllPendingSuggestions();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(rows));
    })
    .post("/api/approve", async (req, res) => {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { id, editedMessage } = JSON.parse(body);
        const numId = Number(id);
        // Atomic claim: pending → sending (prevents double-send race)
        const claimed = claimSuggestion(numId);
        if (!claimed.ok) {
          res.statusCode = 409;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Already handled" }));
          return;
        }
        // We own this suggestion — send WhatsApp message
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
        // Send succeeded — finalize (sending → approved)
        finalizeSuggestionApproval(numId, 0, editedMessage || null);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    })
    .post("/api/reject", async (req, res) => {
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
