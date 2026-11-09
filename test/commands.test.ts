import assert from "node:assert/strict";
import { test } from "node:test";
import { answer, listen, type Button, type ChatInfo, type Update, type View } from "../src/commands.ts";
import { step, type State } from "../src/engine.ts";
import { MESSAGES } from "../src/i18n.ts";
import type { Chats } from "../src/state.ts";
import type { Signal, Status } from "../src/types.ts";

const MIN = 60_000;
const sig = (key: string, status: Status, detail?: string): Signal => ({ key, label: key, status, detail, confirmations: 1 });
const empty: State = { signals: {}, outbox: [] };
const chat = (type = "private", admin = false, id = "42"): ChatInfo => ({ id, type, admin });

function view(signals: Signal[], extra: Partial<View> = {}): View {
  const state = step(empty, signals, 0).state;
  return { state, checkedAt: 10 * MIN, services: 2, intervalSeconds: 300, now: 12 * MIN, t: MESSAGES.pt, ...extra };
}

test("/status with everything up", () => {
  assert.equal(answer("/status", chat("private"), view([sig("Cloudflare · D1", "up"), sig("GoPay API", "up")])),
    "🟢 <b>Tudo normal</b> — 2 sinais\n\n🟢 Cloudflare · D1\n🟢 GoPay API\n\nÚltima leitura há 2 min.");
});

test("/status puts the worst first, with how long and why", () => {
  const v = view([sig("Cloudflare · D1", "up"), sig("GoPay API", "down", "HTTP 502"), sig("Shopify", "degraded")]);
  assert.equal(answer("/status", chat("private"), v), [
    "⚠️ <b>2 de 3 sinais fora do normal</b>",
    "",
    "🔴 <b>GoPay API</b> — fora do ar há 12 min (HTTP 502)",
    "🟡 <b>Shopify</b> — degradado há 12 min",
    "🟢 Cloudflare · D1",
    "",
    "Última leitura há 2 min.",
  ].join("\n"));
});

test("/status in English escapes HTML", () => {
  const v = view([sig("A <b>", "down", "x & y")], { t: MESSAGES.en });
  assert.equal(answer("/status", chat("private"), v),
    "⚠️ <b>1 of 1 signal not normal</b>\n\n🔴 <b>A &lt;b&gt;</b> — down for 12 min (x &amp; y)\n\nLast read 2 min ago.");
});

test("/status before the first reading", () => {
  assert.equal(answer("/status", chat("private"), view([sig("A", "up")], { checkedAt: undefined })), MESSAGES.pt.notReadYet);
});

test("/help, /start, unknown commands and /cmd@bot all get help", () => {
  const v = view([sig("A", "up"), sig("B", "up")]);
  const help = answer("/help", chat("private"), v);
  assert.match(help!, /\/status — como está tudo agora/);
  assert.match(help!, /Vigiando 2 sinais de 2 serviços, lendo a cada 5 min\./);
  assert.equal(answer("/start", chat("private"), v), help);
  assert.equal(answer("/whatever", chat("group"), v), help);
  assert.equal(answer("/STATUS@my_status_bot", chat("supergroup"), v), answer("/status", chat("private"), v));
});

test("plain text: help in a private chat, silence in a group", () => {
  const v = view([sig("A", "up")]);
  assert.equal(answer("oi", chat("private"), v), answer("/help", chat("private"), v));
  assert.equal(answer("oi", chat("group"), v), undefined);
});

test("/id answers the chat_id; the admin's help lists /chats, everyone else's /leave", () => {
  const v = view([sig("A", "up")]);
  assert.equal(answer("/id@my_status_bot", chat("supergroup", false, "-100123"), v), "🆔 O chat_id desta conversa é <code>-100123</code>.");
  assert.equal(answer("/id", chat("private"), { ...v, t: MESSAGES.en }), "🆔 This chat's chat_id is <code>42</code>.");
  const admin = answer("/help", chat("private", true), v)!;
  const other = answer("/help", chat("private"), v)!;
  assert.match(admin, /aviso aqui quando um serviço cai[\s\S]*\/chats — quem mais pode usar o bot/);
  assert.doesNotMatch(admin, /\/leave/);
  assert.match(other, /te conto como eles estão[\s\S]*\/leave — parar de usar o bot/);
  assert.doesNotMatch(other, /\/chats/);
});

const ADMIN = 42;
type Who = { first_name?: string; username?: string; title?: string };
const msg = (update_id: number, text: string, chatId = ADMIN, type = "private", name?: Who, from?: Who): Update =>
  ({ update_id, message: { message_id: update_id, chat: { id: chatId, type, ...name }, from: from && { id: 1, ...from }, text } });
const tap = (update_id: number, data: string, chatId = ADMIN, message_id = 500): Update =>
  ({ update_id, callback_query: { id: `cb${update_id}`, data, message: { message_id, chat: { id: chatId } } } });

/** Runs `listen` over scripted getUpdates responses; stops when they run out. */
async function run(responses: (Update[] | Error)[], chats: Chats = {}, failSendTo?: string) {
  const stop = new AbortController();
  const calls: { offset: number; timeout: number }[] = [];
  const sent: { to: string; text: string; buttons?: Button[][] }[] = [];
  const edits: { to: string; id: number; text: string; buttons?: Button[][] }[] = [];
  const acks: (string | undefined)[] = [];
  const logs: string[] = [];
  let saves = 0;
  await listen({
    poll: async (offset, timeout) => {
      calls.push({ offset, timeout });
      const next = responses.shift();
      if (!next) {
        stop.abort();
        return [];
      }
      if (next instanceof Error) throw next;
      return next;
    },
    send: async (to, text, buttons) => {
      if (to === failSendTo) throw new Error("Telegram 403: Forbidden: bot was blocked by the user");
      sent.push({ to, text, ...(buttons && { buttons }) });
    },
    edit: async (to, id, text, buttons) => void edits.push({ to, id, text, ...(buttons && { buttons }) }),
    ack: async (_id, text) => void acks.push(text),
    answer: (text, c) => `re: ${text}${c.admin ? " (admin)" : ""}`,
    admin: String(ADMIN),
    chats,
    save: async () => void saves++,
    t: MESSAGES.pt,
    now: () => 1000,
    signal: stop.signal,
    log: (m) => void logs.push(m),
    sleep: async () => {},
  });
  const texts = sent.map((s) => `${s.to}: ${s.text}`);
  return { calls, sent, texts, edits, acks, logs, chats, saves };
}

const t = MESSAGES.pt;

test("listen skips what was sent while the bot was off, then answers in order", async () => {
  const r = await run([[msg(7, "/status")], [msg(8, "/status"), msg(9, "/help")], [msg(10, "/status")]]);
  assert.deepEqual(r.calls.map((c) => c.offset), [-1, 8, 10, 11]);
  assert.equal(r.calls[0].timeout, 0);
  assert.deepEqual(r.texts, ["42: re: /status (admin)", "42: re: /help (admin)", "42: re: /status (admin)"]);
});

test("a new chat asks the admin once, with buttons, and every message is logged with its chat_id", async () => {
  const ana = { first_name: "Ana", username: "ana" };
  const r = await run([[], [msg(1, "/start", 555, "private", ana), msg(2, "/status", 555, "private", ana), msg(3, "/status")]]);
  assert.deepEqual(r.sent, [
    { to: "42", text: "🔔 <b>Ana @ana</b> quer usar o bot.\nchat_id <code>555</code>",
      buttons: [[
        { text: "✅ Aprovar", callback_data: "a:555" },
        { text: "❌ Recusar", callback_data: "r:555" },
        { text: "🚫 Bloquear", callback_data: "x:555" },
      ]] },
    { to: "555", text: t.requested },
    { to: "555", text: t.waiting },
    { to: "42", text: "re: /status (admin)" },
  ]);
  assert.deepEqual(r.chats, { "555": { access: "pending", name: "Ana @ana", since: 1000 } });
  assert.equal(r.saves, 1);
  assert.deepEqual(r.logs, [
    "chat 555 (Ana @ana): /start — asking the admin",
    "chat 555 (Ana @ana): /status — waiting for the admin",
    "chat 42: /status",
  ]);
});

test("in a group, only a command asks the admin, naming who asked", async () => {
  const r = await run([[], [msg(1, "bom dia", -100123, "supergroup", { title: "Time <dev>" }), msg(2, "/status@my_bot", -100123, "supergroup", { title: "Time <dev>" }, { first_name: "Bia" })]]);
  assert.deepEqual(r.texts, [
    "42: 🔔 <b>Bia</b> quer usar o bot no grupo <b>Time &lt;dev&gt;</b>.\nchat_id <code>-100123</code>",
    `-100123: ${t.requested}`,
  ]);
  assert.equal(r.logs[0], "chat -100123 (Time <dev>): text — ignored, not approved");
});

test("approving: the request turns into a note, the person is told and gets answers", async () => {
  const r = await run([[], [tap(1, "a:555"), msg(2, "/status", 555)]], { "555": { access: "pending", name: "Ana", since: 0 } });
  assert.equal(r.chats["555"].access, "allowed");
  assert.deepEqual(r.edits, [{ to: "42", id: 500, text: "✅ Acesso aprovado: <b>Ana</b> · <code>555</code>" }]);
  assert.deepEqual(r.acks, [undefined]);
  assert.deepEqual(r.texts, [`555: ${t.welcome}`, "555: re: /status"]);
  assert.deepEqual(r.logs, ["admin: approved chat 555 (Ana)", "chat 555: /status"]);
});

test("refusing: the person is told and may ask again", async () => {
  const r = await run([[], [tap(1, "r:555"), msg(2, "/start", 555, "private", { first_name: "Ana" })]], { "555": { access: "pending", name: "Ana", since: 0 } });
  assert.deepEqual(r.edits, [{ to: "42", id: 500, text: "❌ Pedido recusado: <b>Ana</b> · <code>555</code>" }]);
  assert.deepEqual(r.texts, [
    `555: ${t.notApproved}`,
    "42: 🔔 <b>Ana</b> quer usar o bot.\nchat_id <code>555</code>",
    `555: ${t.requested}`,
  ]);
  assert.equal(r.chats["555"].access, "pending");
  assert.deepEqual(r.logs, ["admin: refused chat 555 (Ana)", "chat 555 (Ana): /start — asking the admin"]);
});

test("blocking from the request: not told, then silence — not even /id", async () => {
  const r = await run([[], [tap(1, "x:555"), msg(2, "/status", 555), msg(3, "/id", 555)]], { "555": { access: "pending", name: "Ana", since: 0 } });
  assert.equal(r.chats["555"].access, "blocked");
  assert.equal(r.edits[0].text, "🚫 Bloqueado: <b>Ana</b> · <code>555</code>");
  assert.deepEqual(r.texts, []);
  assert.deepEqual(r.logs, ["admin: blocked chat 555 (Ana)", "chat 555: /status — blocked, ignored", "chat 555: /id — blocked, ignored"]);
});

test("a person who blocked the bot does not break the approval", async () => {
  const r = await run([[], [tap(1, "a:555")]], { "555": { access: "pending", name: "Ana", since: 0 } }, "555");
  assert.equal(r.chats["555"].access, "allowed");
  assert.equal(r.edits.length, 1);
  assert.match(r.logs[1], /could not tell chat 555 \(Telegram 403/);
});

test("/leave: out right away, the admin is told, and the next message asks again", async () => {
  const r = await run([[], [msg(1, "/leave", 555, "private", { first_name: "Ana" }), msg(2, "/status", 555, "private", { first_name: "Ana" })]],
    { "555": { access: "allowed", name: "Ana", since: 0 } });
  assert.deepEqual(r.texts.slice(0, 3), [`555: ${t.left}`, "42: 👋 <b>Ana</b> saiu do bot · <code>555</code>", "42: 🔔 <b>Ana</b> quer usar o bot.\nchat_id <code>555</code>"]);
  assert.equal(r.chats["555"].access, "pending");
});

test("the admin cannot /leave, and only the admin has /chats", async () => {
  const r = await run([[], [msg(1, "/leave"), msg(2, "/chats", 555)]], { "555": { access: "allowed", name: "Ana", since: 0 } });
  assert.deepEqual(r.texts, [`42: ${t.adminCannotLeave}`, "555: re: /chats"]);
});

test("/chats lists everyone who asked, with buttons to remove, block and unblock", async () => {
  const chats: Chats = {
    "777": { access: "blocked", name: "Spam", since: 0 },
    "555": { access: "allowed", name: "Ana", since: 0 },
    "666": { access: "pending", name: "João", since: 0 },
  };
  const r = await run([[], [msg(1, "/chats")]], chats);
  assert.deepEqual(r.sent, [{
    to: "42",
    text: "👥 <b>Quem mais pode usar o bot</b>\n\n✅ Ana · <code>555</code>\n⏳ João · <code>666</code>\n🚫 Spam · <code>777</code>",
    buttons: [
      [{ text: "✖ Remover Ana", callback_data: "d:555" }, { text: "🚫 Bloquear Ana", callback_data: "b:555" }],
      [{ text: "↩ Desbloquear Spam", callback_data: "u:777" }],
    ],
  }]);
  const empty = await run([[], [msg(1, "/chats")]]);
  assert.equal(empty.texts[0], `42: ${t.chatsList([])}`);
});

test("list buttons change access, tell the removed person (not the blocked one) and redraw the list", async () => {
  const chats: Chats = {
    "555": { access: "allowed", name: "Ana", since: 0 },
    "556": { access: "allowed", name: "Bia", since: 0 },
    "777": { access: "blocked", name: "Spam", since: 0 },
  };
  const r = await run([[], [tap(1, "d:555"), tap(2, "b:556"), tap(3, "u:777"), tap(4, "d:555")]], chats);
  assert.deepEqual(r.chats, { "556": { access: "blocked", name: "Bia", since: 0 } });
  assert.deepEqual(r.texts, [`555: ${t.removedNotice}`]);
  assert.equal(r.edits.length, 4);
  assert.equal(r.edits[2].text, "👥 <b>Quem mais pode usar o bot</b>\n\n🚫 Bia · <code>556</code>");
  assert.deepEqual(r.edits[2].buttons, [[{ text: "↩ Desbloquear Bia", callback_data: "u:556" }]]);
  assert.deepEqual(r.acks, [undefined, undefined, undefined, t.gone]);
});

test("a button outside the admin chat changes nothing", async () => {
  const r = await run([[], [tap(1, "a:555", 555)]], { "555": { access: "pending", name: "Ana", since: 0 } });
  assert.equal(r.chats["555"].access, "pending");
  assert.deepEqual(r.edits, []);
  assert.deepEqual(r.logs, ["ignored a button from chat 555"]);
});

test("listen survives Telegram errors and keeps its offset", async () => {
  const r = await run([[], [msg(1, "/help")], new Error("Telegram 502: Bad Gateway"), [msg(2, "/status")]]);
  assert.deepEqual(r.calls.map((c) => c.offset), [-1, 0, 2, 2, 3]);
  assert.deepEqual(r.texts, ["42: re: /help (admin)", "42: re: /status (admin)"]);
  assert.match(r.logs[1], /Bad Gateway\) — retrying in 2s/);
});

test("a failing update is logged and the next one is still handled", async () => {
  const r = await run([[], [msg(1, "/start", 555), msg(2, "/status")]], {}, "42");
  assert.deepEqual(r.chats, {});
  assert.match(r.logs[1], /could not handle update 1 \(Telegram 403/);
  assert.equal(r.logs[2], "chat 42: /status");
});
