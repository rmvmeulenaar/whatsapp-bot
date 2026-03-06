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

let UI_HTML = "";
try {
  UI_HTML = readFileSync(join(__dirname, "ui.html"), "utf8");
} catch {
  UI_HTML = "<html><body><h1>Dashboard UI not found</h1></body></html>";
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
      // Send a heartbeat comment to keep connection alive
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
    .get("/api/pending", (req, res) => {
      const rows = getAllPendingSuggestions();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(rows));
    })
    .post("/api/approve", async (req, res) => {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { id, editedMessage } = JSON.parse(body);
        const result = approveSuggestion(Number(id), 0, editedMessage || null);
        if (!result.ok) {
          res.statusCode = 409;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Already handled" }));
          return;
        }
        const pending = getPendingSuggestion(Number(id));
        if (pending) {
          try {
            const { sendText } = await import("../whatsapp/outbound.js");
            const { getSocket } = await import("../whatsapp/connection.js");
            const sock = getSocket();
            const textToSend = editedMessage || pending.proposed_message;
            await sendText(sock, pending.jid, textToSend);
          } catch (sendErr) {
            console.error("[dashboard] WhatsApp send failed after approve:", sendErr.message);
          }
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
