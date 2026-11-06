import assert from "node:assert/strict";
import { test } from "node:test";
import { message, startMessage, step, type State } from "../src/engine.ts";
import { MESSAGES } from "../src/i18n.ts";
import type { Signal, Status } from "../src/types.ts";

const MIN = 60_000;
const sig = (status: Status, extra: Partial<Signal> = {}): Signal =>
  ({ key: "Cloudflare · D1", label: "Cloudflare · D1", status, confirmations: 1, ...extra });
const empty: State = { signals: {}, outbox: [] };

test("first reading is a baseline, not an alert", () => {
  const { state, changes } = step(empty, [sig("down")], 0);
  assert.equal(changes.length, 0);
  assert.equal(state.signals["Cloudflare · D1"].status, "down");
});

test("same status twice says nothing", () => {
  const a = step(empty, [sig("up")], 0).state;
  assert.deepEqual(step(a, [sig("up")], MIN).changes, []);
});

test("going down alerts once, coming back reports how long it lasted", () => {
  let s = step(empty, [sig("up")], 0).state;
  const down = step(s, [sig("down", { detail: "Elevated errors", link: "https://stspg.io/x" })], 10 * MIN);
  assert.equal(down.changes.length, 1);
  assert.deepEqual([down.changes[0].from, down.changes[0].to], ["up", "down"]);
  s = step(down.state, [sig("down")], 15 * MIN).state;
  const back = step(s, [sig("up")], 33 * MIN);
  assert.equal(back.changes[0].lasted, 23 * MIN);
  assert.equal(message(back.changes[0], MESSAGES.pt), "🟢 <b>Cloudflare · D1</b> voltou — fora do ar por 23 min");
  assert.equal(message(back.changes[0], MESSAGES.en), "🟢 <b>Cloudflare · D1</b> is back — down for 23 min");
});

test("confirmations hold the alert until the new status repeats", () => {
  let s = step(empty, [sig("up", { confirmations: 2 })], 0).state;
  const first = step(s, [sig("down", { confirmations: 2 })], MIN);
  assert.equal(first.changes.length, 0, "one failure is not enough");
  s = first.state;
  assert.equal(step(s, [sig("down", { confirmations: 2 })], 2 * MIN).changes.length, 1);
});

test("a blip that recovers before confirming never alerts", () => {
  let s = step(empty, [sig("up", { confirmations: 2 })], 0).state;
  s = step(s, [sig("down", { confirmations: 2 })], MIN).state;
  s = step(s, [sig("up", { confirmations: 2 })], 2 * MIN).state;
  assert.equal(step(s, [sig("down", { confirmations: 2 })], 3 * MIN).changes.length, 0);
});

test("an unreadable status page needs 3 readings and is not reported as an outage", () => {
  let s = step(empty, [sig("up")], 0).state;
  for (let i = 1; i <= 2; i++) {
    const r = step(s, [sig("unknown", { detail: "HTTP 502" })], i * MIN);
    assert.equal(r.changes.length, 0);
    s = r.state;
  }
  const third = step(s, [sig("unknown", { detail: "HTTP 502" })], 3 * MIN);
  assert.equal(message(third.changes[0], MESSAGES.pt), "⚪ <b>Cloudflare · D1</b> — não consegui ler o status (HTTP 502)");
  const back = step(third.state, [sig("up")], 4 * MIN);
  assert.equal(message(back.changes[0], MESSAGES.pt), "🟢 <b>Cloudflare · D1</b> — a leitura voltou, operando normalmente");
});

test("message escapes HTML from incident names", () => {
  const s = step(empty, [sig("up")], 0).state;
  const r = step(s, [sig("degraded", { detail: "Errors on <script> & KV" })], MIN);
  assert.equal(message(r.changes[0], MESSAGES.en), "🟡 <b>Cloudflare · D1</b> — degraded\nErrors on &lt;script&gt; &amp; KV");
});

test("services removed from the config are dropped from the state", () => {
  const s = step(empty, [sig("up"), sig("up", { key: "Old", label: "Old" })], 0).state;
  assert.deepEqual(Object.keys(step(s, [sig("up")], MIN).state.signals), ["Cloudflare · D1"]);
});

test("start message lists what is not up", () => {
  const s = step(empty, [sig("up"), sig("maintenance", { key: "Shopify", label: "Shopify", detail: "Scheduled" })], 0).state;
  assert.equal(startMessage(s, 2, MESSAGES.pt),
    "🤖 statusbot no ar — vigiando 2 sinais de 2 serviços.\n\nAgora, fora do normal:\n• Shopify — em manutenção (Scheduled)");
});

test("durations", () => {
  const d = MESSAGES.pt.duration;
  assert.equal(d(30_000), "menos de 1 min");
  assert.equal(d(60 * MIN), "1 h");
  assert.equal(d(125 * MIN), "2 h 5 min");
  assert.equal(d(27 * 60 * MIN), "1 d 3 h");
});
