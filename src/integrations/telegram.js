// src/integrations/telegram.js
// Phase 5: Telegram approval bot — grammY polling
import { Bot, InlineKeyboard } from "grammy";
import {
  rejectSuggestion, getPendingSuggestion,
  getExistingPending, supersedeSuggestion, setMoumenMsgId,
  setRogierMsgId, getPendingForStartupRecovery,
  markSuggestionTakenOver, getAllConversationModes, setConversationMode,
  claimSuggestion, resetSuggestionToPending, finalizeSuggestionApproval
} from "../dashboard/db.js";
import { sendText } from "../whatsapp/outbound.js";
import { getSocket } from "../whatsapp/connection.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ROGIER_CHAT_ID = Number(process.env.ROGIER_TELEGRAM_ID ?? "6237130967");
const MOUMEN_CHAT_ID = process.env.MOUMEN_TELEGRAM_ID ? Number(process.env.MOUMEN_TELEGRAM_ID) : null;
const ALLOWED_USERS = new Set(
  (process.env.TELEGRAM_ALLOWED_USERS ?? String(ROGIER_CHAT_ID))
    .split(",").map(Number).filter(Boolean)
);

let bot = TOKEN ? new Bot(TOKEN) : null;
const awaitingEdit = new Map();
const escalationTimers = new Map();

function isAuthorized(ctx) { return ALLOWED_USERS.has(ctx.from?.id); }
function getPrimaryChatId() { return MOUMEN_CHAT_ID ?? ROGIER_CHAT_ID; }
function normalizePhoneToJid(phone) {
  return phone.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
}
function maskPhoneDisplay(jid) {
  const num = jid.replace("@s.whatsapp.net", "");
  return num.length > 6 ? num.slice(0, 4) + "****" + num.slice(-2) : num;
}

export async function sendSuggestNotification({ chatId, suggestionId, patientName, customerMsg, proposedReply, isEscalation = false }) {
  if (!bot) { console.warn("[telegram] Bot not initialized (no TELEGRAM_BOT_TOKEN)"); return null; }
  const keyboard = new InlineKeyboard()
    .text("✅ Stuur", `approve:${suggestionId}`)
    .text("✏️ Bewerk", `edit:${suggestionId}`)
    .text("❌ Negeer", `reject:${suggestionId}`);
  const prefix = isEscalation ? "⏰ Moumen heeft niet gereageerd\n\n" : "";
  const text = `${prefix}👤 ${patientName}\n💬 "${customerMsg}"\n\n🤖 Voorstel:\n${proposedReply}`;
  const sentMsg = await bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
  return sentMsg.message_id;
}

export function scheduleEscalation(suggestionId, { patientName, customerMsg, proposedReply }) {
  const handle = setTimeout(async () => {
    escalationTimers.delete(suggestionId);
    try {
      const row = getPendingSuggestion(suggestionId);
      if (!row || row.status !== "pending") return;
      const msgId = await sendSuggestNotification({
        chatId: ROGIER_CHAT_ID, suggestionId, patientName, customerMsg, proposedReply, isEscalation: true
      });
      if (msgId) setRogierMsgId(suggestionId, msgId);
    } catch (err) { console.error("[telegram] Escalation failed:", err.message); }
  }, 30 * 60 * 1000);
  handle.unref();
  escalationTimers.set(suggestionId, handle);
}

export function cancelEscalation(suggestionId) {
  const handle = escalationTimers.get(suggestionId);
  if (handle) { clearTimeout(handle); escalationTimers.delete(suggestionId); }
}

function recoverPendingEscalations() {
  try {
    const pending = getPendingForStartupRecovery();
    const now = Date.now();
    const ESCALATION_MS = 30 * 60 * 1000;
    for (const row of pending) {
      const createdAt = typeof row.created_at === 'number' ? row.created_at : new Date(row.created_at).getTime();
      const elapsed = now - createdAt;
      const remaining = Math.max(0, ESCALATION_MS - elapsed);
      const meta = { patientName: row.patient_name ?? maskPhoneDisplay(row.jid), customerMsg: row.inbound_message, proposedReply: row.proposed_message };
      if (remaining > 0) {
        // FIX 6: use remaining time instead of fresh 30-minute timer
        const handle = setTimeout(async () => {
          escalationTimers.delete(row.id);
          try {
            const r = getPendingSuggestion(row.id);
            if (!r || r.status !== "pending") return;
            const msgId = await sendSuggestNotification({ chatId: ROGIER_CHAT_ID, suggestionId: row.id, ...meta, isEscalation: true });
            if (msgId) setRogierMsgId(row.id, msgId);
          } catch (err) { console.error("[telegram] Recovery escalation failed:", err.message); }
        }, remaining);
        handle.unref();
        escalationTimers.set(row.id, handle);
        console.log(`[telegram] Recovered escalation ${row.id} (${Math.round(remaining/1000)}s remaining)`);
      } else {
        // Already expired — escalate immediately
        (async () => {
          try {
            const r = getPendingSuggestion(row.id);
            if (!r || r.status !== "pending") return;
            const msgId = await sendSuggestNotification({ chatId: ROGIER_CHAT_ID, suggestionId: row.id, ...meta, isEscalation: true });
            if (msgId) setRogierMsgId(row.id, msgId);
          } catch (err) { console.error("[telegram] Recovery escalation (expired) failed:", err.message); }
        })();
      }
    }
    if (pending.length > 0) console.log(`[telegram] Recovered ${pending.length} pending escalation(s)`);
  } catch (err) { console.error("[telegram] Recovery error:", err.message); }
}

export async function replacePendingForJid(jid, newSuggestionId) {
  const existing = getExistingPending(jid);
  if (existing && existing.id !== newSuggestionId) {
    cancelEscalation(existing.id);
    supersedeSuggestion(existing.id);
    const updateMsg = "🔄 Vervangen door nieuw voorstel";
    if (existing.telegram_msg_id_moumen && bot) {
      try { await bot.api.editMessageText(getPrimaryChatId(), existing.telegram_msg_id_moumen, updateMsg, { reply_markup: new InlineKeyboard() }); } catch (_) {}
    }
    if (existing.telegram_msg_id_rogier && bot) {
      try { await bot.api.editMessageText(ROGIER_CHAT_ID, existing.telegram_msg_id_rogier, updateMsg, { reply_markup: new InlineKeyboard() }); } catch (_) {}
    }
  }
}

export async function sendDisconnectAlert(reason = "onbekend") {
  if (!bot) return;
  try {
    await bot.api.sendMessage(ROGIER_CHAT_ID, `⚠️ WhatsApp verbinding verbroken!\nReden: ${reason}\n\nBot probeert opnieuw te verbinden.`);
  } catch (err) { console.error("[telegram] Disconnect alert failed:", err.message); }
}

export function startTelegramBot() {
  if (!bot) { console.warn("[telegram] Skipping — no TELEGRAM_BOT_TOKEN"); return; }

  // CALLBACK HANDLERS (must be before message:text)
  bot.callbackQuery(/^approve:(\d+)$/, async (ctx) => {
    if (!isAuthorized(ctx)) { await ctx.answerCallbackQuery({ text: "Niet geautoriseerd." }); return; }
    const id = Number(ctx.match[1]);
    // Atomic claim: pending → sending (prevents double-send race)
    const claimed = claimSuggestion(id);
    if (!claimed.ok) {
      await ctx.answerCallbackQuery({ text: "Al afgehandeld door iemand anders." });
      return;
    }
    const row = getPendingSuggestion(id);
    try {
      const sock = getSocket();
      const sendResult = await sendText(sock, row.jid, row.proposed_message);
      if (sendResult && sendResult.sent === false) {
        resetSuggestionToPending(id);
        await ctx.answerCallbackQuery({ text: "Sturen mislukt: rate limited — probeer opnieuw." });
        return;
      }
    } catch (err) {
      resetSuggestionToPending(id);
      await ctx.answerCallbackQuery({ text: "Sturen mislukt: " + err.message });
      return;
    }
    // Send succeeded — finalize (sending → approved)
    finalizeSuggestionApproval(id, ctx.from.id);
    cancelEscalation(id);
    await ctx.answerCallbackQuery({ text: "✅ Verstuurd!" });
    try { await ctx.editMessageText((ctx.msg?.text ?? "") + "\n\n✅ Verstuurd door " + (ctx.from.first_name ?? "onbekend"), { reply_markup: new InlineKeyboard() }); } catch (_) {}
  });

  bot.callbackQuery(/^edit:(\d+)$/, async (ctx) => {
    if (!isAuthorized(ctx)) { await ctx.answerCallbackQuery({ text: "Niet geautoriseerd." }); return; }
    const id = Number(ctx.match[1]);
    const row = getPendingSuggestion(id);
    if (!row || row.status !== "pending") { await ctx.answerCallbackQuery({ text: "Al afgehandeld." }); return; }
    awaitingEdit.set(ctx.chat.id, { suggestionId: id, jid: row.jid });
    await ctx.answerCallbackQuery();
    await ctx.reply("✏️ Typ je aangepaste tekst:");
  });

  bot.callbackQuery(/^reject:(\d+)$/, async (ctx) => {
    if (!isAuthorized(ctx)) { await ctx.answerCallbackQuery({ text: "Niet geautoriseerd." }); return; }
    const id = Number(ctx.match[1]);
    const result = rejectSuggestion(id, ctx.from.id);
    if (!result.ok) { await ctx.answerCallbackQuery({ text: "Al afgehandeld." }); return; }
    cancelEscalation(id);
    await ctx.answerCallbackQuery({ text: "❌ Genegeerd." });
    try { await ctx.editMessageText((ctx.msg?.text ?? "") + "\n\n❌ Genegeerd door " + (ctx.from.first_name ?? "onbekend"), { reply_markup: new InlineKeyboard() }); } catch (_) {}
  });

  // MESSAGE:TEXT handler (after callback handlers)
  bot.on("message:text", async (ctx) => {
    if (!isAuthorized(ctx)) return;
    const editState = awaitingEdit.get(ctx.chat.id);
    if (editState) {
      awaitingEdit.delete(ctx.chat.id);
      const { suggestionId, jid } = editState;
      // Atomic claim: pending → sending (prevents double-send race)
      const claimed = claimSuggestion(suggestionId);
      if (!claimed.ok) { await ctx.reply("Al afgehandeld door iemand anders."); return; }
      try {
        const sendResult = await sendText(getSocket(), jid, ctx.message.text);
        if (sendResult && sendResult.sent === false) {
          resetSuggestionToPending(suggestionId);
          await ctx.reply("Sturen mislukt: rate limited — probeer opnieuw.");
          return;
        }
      } catch (err) {
        resetSuggestionToPending(suggestionId);
        await ctx.reply("Versturen mislukt: " + err.message);
        return;
      }
      finalizeSuggestionApproval(suggestionId, ctx.from.id, ctx.message.text);
      cancelEscalation(suggestionId);
      await ctx.reply("✅ Aangepaste versie verstuurd.");
      return;
    }

    const text = ctx.message.text.trim();

    if (text.startsWith("/suggest ")) {
      const phone = text.slice(9).trim();
      if (!phone.match(/^\+?\d{10,15}$/)) { await ctx.reply("Gebruik: /suggest +31612345678"); return; }
      setConversationMode.run({ jid: normalizePhoneToJid(phone), mode: "suggest" });
      await ctx.reply(`✅ Suggest-mode aan voor ${phone}`);
      return;
    }
    if (text.startsWith("/handback ")) {
      const phone = text.slice(10).trim();
      if (!phone.match(/^\+?\d{10,15}$/)) { await ctx.reply("Gebruik: /handback +31612345678"); return; }
      setConversationMode.run({ jid: normalizePhoneToJid(phone), mode: "watch" });
      await ctx.reply(`✅ Watch-mode voor ${phone} — bot observeert, stuurt niets.`);
      return;
    }
    if (text.startsWith("/takeover ")) {
      const phone = text.slice(10).trim();
      if (!phone.match(/^\+?\d{10,15}$/)) { await ctx.reply("Gebruik: /takeover +31612345678"); return; }
      setConversationMode.run({ jid: normalizePhoneToJid(phone), mode: "watch" });
      await ctx.reply(`✅ Watch-mode voor ${phone} — bot observeert, stuurt niets.`);
      return;
    }
    if (text.startsWith("/auto ")) {
      const phone = text.slice(6).trim();
      if (!phone.match(/^\+?\d{10,15}$/)) { await ctx.reply("Gebruik: /auto +31612345678"); return; }
      setConversationMode.run({ jid: normalizePhoneToJid(phone), mode: "auto" });
      await ctx.reply(`✅ Auto-mode voor ${phone} — bot stuurt automatisch.`);
      return;
    }
    if (text === "/status") {
      try {
        const rows = getAllConversationModes();
        if (!rows.length) { await ctx.reply("Geen gesprekken met mode ingesteld."); return; }
        const lines = rows.map(r => `+${r.jid.replace("@s.whatsapp.net","")} → ${r.mode}`);
        await ctx.reply("📋 Gesprekken:\n" + lines.join("\n"));
      } catch (err) { await ctx.reply("Fout: " + err.message); }
      return;
    }
  });

  bot.start({
    allowed_updates: ["message", "callback_query"],
    onStart: (botInfo) => console.log(`[telegram] Bot @${botInfo.username} polling started`),
  });

  recoverPendingEscalations();
  console.log("[telegram] Bot module initialized");
}

export async function stopTelegramBot() {
  if (!bot) return;
  try { await bot.stop(); console.log("[telegram] Bot stopped"); }
  catch (err) { console.error("[telegram] Stop error:", err.message); }
}
