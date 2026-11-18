import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { channelsFromEnv, deliver, slackBot, slackWebhook, toPlain, toSlack, webhook, type Channel } from "../src/channels.ts";
import { ConfigError } from "../src/config.ts";
import { loadState } from "../src/state.ts";

const ALERT = "🔴 <b>GoPay API &amp; Co</b> — fora do ar\nchat <code>42</code> &lt;x&gt;";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fetch that records each call and answers with the next response. */
function fakeFetch(...responses: Response[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return responses.shift() ?? new Response("ok");
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("formats: Slack keeps the entities, plain text drops tags and entities", () => {
  assert.equal(toSlack(ALERT), "🔴 *GoPay API &amp; Co* — fora do ar\nchat `42` &lt;x&gt;");
  assert.equal(toPlain(ALERT), "🔴 GoPay API & Co — fora do ar\nchat 42 <x>");
});

test("Slack webhook posts mrkdwn and reports Slack's reason", async () => {
  const { f, calls } = fakeFetch(new Response("ok"), new Response("invalid_token", { status: 403 }));
  const ch = slackWebhook("https://hooks.slack.com/services/T/B/x", f);
  await ch.send(ALERT);
  assert.equal(calls[0].url, "https://hooks.slack.com/services/T/B/x");
  assert.deepEqual(calls[0].body, { text: toSlack(ALERT), unfurl_links: false });
  await assert.rejects(ch.send("x"), /Slack 403: invalid_token/);
});

test("Slack bot posts to the channel, in a thread when asked; ok:false is an error", async () => {
  const { f, calls } = fakeFetch(Response.json({ ok: true }), Response.json({ ok: false, error: "not_in_channel" }));
  const ch = slackBot("xoxb-1", "C0CD5AB4E2Z", "1793984541.720009", f);
  await ch.send(ALERT);
  assert.equal(calls[0].url, "https://slack.com/api/chat.postMessage");
  assert.equal(calls[0].headers.authorization, "Bearer xoxb-1");
  assert.deepEqual(calls[0].body, { channel: "C0CD5AB4E2Z", text: toSlack(ALERT), unfurl_links: false, thread_ts: "1793984541.720009" });
  await assert.rejects(ch.send("x"), /Slack 200: not_in_channel/);
});

test("generic webhook posts plain text and never puts the URL in the error", async () => {
  const { f, calls } = fakeFetch(new Response("ok"), new Response("boom", { status: 500 }));
  const ch = webhook("https://n8n.example.com/webhook/secret-id", f);
  await ch.send(ALERT);
  assert.deepEqual(calls[0].body, { text: toPlain(ALERT) });
  await assert.rejects(ch.send("x"), (err: Error) => err.message === "webhook 500: boom");
});

test("a 429 with Retry-After is retried", async () => {
  const { f, calls } = fakeFetch(new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }), new Response("ok"));
  await webhook("https://x.example", f).send("hi");
  assert.equal(calls.length, 2);
});

test("channelsFromEnv: any combination, half-set channels are errors", () => {
  const names = (env: NodeJS.ProcessEnv) => channelsFromEnv(env).map((c) => c.name);
  assert.deepEqual(names({}), []);
  // Empty values (unset GitHub secrets) count as not set.
  assert.deepEqual(names({ TELEGRAM_BOT_TOKEN: "", SLACK_WEBHOOK_URL: "", WEBHOOK_URL: "" }), []);
  assert.deepEqual(names({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1", SLACK_WEBHOOK_URL: "https://hooks.slack.com/x", WEBHOOK_URL: "https://w" }),
    ["telegram", "slack", "webhook"]);
  assert.deepEqual(names({ SLACK_BOT_TOKEN: "xoxb", SLACK_CHANNEL: "C1", SLACK_THREAD_TS: "1.2" }), ["slack"]);
  for (const env of [
    { TELEGRAM_BOT_TOKEN: "t" },
    { TELEGRAM_CHAT_ID: "1" },
    { SLACK_BOT_TOKEN: "xoxb" },
    { SLACK_CHANNEL: "C1" },
    { SLACK_WEBHOOK_URL: "https://hooks.slack.com/x", SLACK_BOT_TOKEN: "xoxb", SLACK_CHANNEL: "C1" },
    { SLACK_WEBHOOK_URL: "https://hooks.slack.com/x", SLACK_THREAD_TS: "1.2" },
    { SLACK_WEBHOOK_URL: "hooks.slack.com/x" },
    { WEBHOOK_URL: "not a url" },
  ]) assert.throws(() => channelsFromEnv(env), ConfigError, JSON.stringify(env));
});

test("deliver: a failing channel keeps its own queue, the others get everything", async () => {
  const got: string[] = [];
  const ok: Channel = { name: "slack", send: async (t) => void got.push(t) };
  let fail = true;
  const flaky: Channel = { name: "telegram", send: async () => { if (fail) throw new Error("offline"); } };
  const logs: string[] = [];
  let outbox = await deliver([ok, flaky], { gone: ["old"] }, ["a", "b"], (m) => logs.push(m));
  assert.deepEqual(got, ["a", "b"]);
  // The channel no longer configured ("gone") loses its queue.
  assert.deepEqual(outbox, { telegram: ["a", "b"] });
  assert.match(logs[0], /^telegram: could not send \(offline\) — 2 message\(s\) kept/);
  fail = false;
  outbox = await deliver([ok, flaky], outbox, ["c"], () => {});
  assert.deepEqual(outbox, {});
  assert.deepEqual(got, ["a", "b", "c"]);
});

test("an old state.json with a single outbox list becomes Telegram's queue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "statusbot-"));
  const path = join(dir, "state.json");
  await writeFile(path, JSON.stringify({ signals: {}, outbox: ["x"] }));
  assert.deepEqual((await loadState(path))?.outbox, { telegram: ["x"] });
  await writeFile(path, JSON.stringify({ signals: {}, outbox: [] }));
  assert.deepEqual((await loadState(path))?.outbox, {});
});
