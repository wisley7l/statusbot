import assert from "node:assert/strict";
import { test } from "node:test";
import { answer, listen, type Update, type View } from "../src/commands.ts";
import { step, type State } from "../src/engine.ts";
import { MESSAGES } from "../src/i18n.ts";
import type { Signal, Status } from "../src/types.ts";

const MIN = 60_000;
const sig = (key: string, status: Status, detail?: string): Signal => ({ key, label: key, status, detail, confirmations: 1 });
const empty: State = { signals: {}, outbox: [] };

function view(signals: Signal[], extra: Partial<View> = {}): View {
  const state = step(empty, signals, 0).state;
  return { state, checkedAt: 10 * MIN, services: 2, intervalSeconds: 300, now: 12 * MIN, t: MESSAGES.pt, ...extra };
}

test("/status with everything up", () => {
  assert.equal(answer("/status", "private", view([sig("Cloudflare · D1", "up"), sig("GoPay API", "up")])),
    "🟢 <b>Tudo normal</b> — 2 sinais\n\n🟢 Cloudflare · D1\n🟢 GoPay API\n\nÚltima leitura há 2 min.");
});

test("/status puts the worst first, with how long and why", () => {
  const v = view([sig("Cloudflare · D1", "up"), sig("GoPay API", "down", "HTTP 502"), sig("Shopify", "degraded")]);
  assert.equal(answer("/status", "private", v), [
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
  assert.equal(answer("/status", "private", v),
    "⚠️ <b>1 of 1 signal not normal</b>\n\n🔴 <b>A &lt;b&gt;</b> — down for 12 min (x &amp; y)\n\nLast read 2 min ago.");
});

test("/status before the first reading", () => {
  assert.equal(answer("/status", "private", view([sig("A", "up")], { checkedAt: undefined })), MESSAGES.pt.notReadYet);
});

test("/help, /start, unknown commands and /cmd@bot all get help", () => {
  const v = view([sig("A", "up"), sig("B", "up")]);
  const help = answer("/help", "private", v);
  assert.match(help!, /\/status — como está tudo agora/);
  assert.match(help!, /Vigiando 2 sinais de 2 serviços, lendo a cada 5 min\./);
  assert.equal(answer("/start", "private", v), help);
  assert.equal(answer("/whatever", "group", v), help);
  assert.equal(answer("/STATUS@my_status_bot", "supergroup", v), answer("/status", "private", v));
});

test("plain text: help in a private chat, silence in a group", () => {
  const v = view([sig("A", "up")]);
  assert.equal(answer("oi", "private", v), answer("/help", "private", v));
  assert.equal(answer("oi", "group", v), undefined);
});

const msg = (update_id: number, text: string, chatId = 42, type = "private"): Update =>
  ({ update_id, message: { chat: { id: chatId, type }, text } });

/** Runs `listen` over scripted getUpdates responses; stops when they run out. */
async function run(responses: (Update[] | Error)[]) {
  const stop = new AbortController();
  const calls: { offset: number; timeout: number }[] = [];
  const replies: string[] = [];
  const logs: string[] = [];
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
    reply: async (text) => void replies.push(text),
    answer: (text) => `re: ${text}`,
    chatId: "42",
    signal: stop.signal,
    log: (m) => void logs.push(m),
    sleep: async () => {},
  });
  return { calls, replies, logs };
}

test("listen skips what was sent while the bot was off, then answers in order", async () => {
  const r = await run([[msg(7, "/status")], [msg(8, "/status"), msg(9, "/help")], [msg(10, "/status")]]);
  assert.deepEqual(r.calls.map((c) => c.offset), [-1, 8, 10, 11]);
  assert.equal(r.calls[0].timeout, 0);
  assert.deepEqual(r.replies, ["re: /status", "re: /help", "re: /status"]);
});

test("listen answers only the configured chat", async () => {
  const r = await run([[], [msg(1, "/status", 999), msg(2, "/status")]]);
  assert.deepEqual(r.replies, ["re: /status"]);
  assert.match(r.logs[0], /ignored a message from chat 999/);
});

test("listen survives Telegram errors and keeps its offset", async () => {
  const r = await run([[], [msg(1, "/help")], new Error("Telegram 502: Bad Gateway"), [msg(2, "/status")]]);
  assert.deepEqual(r.calls.map((c) => c.offset), [-1, 0, 2, 2, 3]);
  assert.deepEqual(r.replies, ["re: /help", "re: /status"]);
  assert.match(r.logs[0], /Bad Gateway\) — retrying in 2s/);
});
