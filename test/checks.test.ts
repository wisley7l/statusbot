import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { http } from "../src/checks/http.ts";
import { parseItems, rss } from "../src/checks/rss.ts";
import { statuspage } from "../src/checks/statuspage.ts";
import { MESSAGES } from "../src/i18n.ts";
import type { CheckContext } from "../src/types.ts";

const fake = (body: unknown, status = 200): CheckContext => ({
  t: MESSAGES.en,
  fetch: async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
});

const summary = {
  status: { indicator: "major", description: "Partial System Outage" },
  components: [
    { id: "g", name: "Developer Platform", status: "operational", group: true },
    { id: "w", name: "Workers", status: "operational" },
    { id: "d", name: "D1", status: "major_outage" },
    { id: "r1", name: "us-east-1", status: "operational" },
    { id: "r2", name: "us-east-1", status: "partial_outage" },
  ],
  incidents: [
    { name: "Something else", shortlink: "https://stspg.io/other", components: [{ id: "x" }] },
    { name: "D1 queries failing", shortlink: "https://stspg.io/d1", components: [{ id: "d" }] },
  ],
};

test("statuspage: each component gets its own status and its own incident", async () => {
  const s = await statuspage({ name: "Cloudflare", type: "statuspage", url: "https://x/", components: ["Workers", "d1"] }, fake(summary));
  assert.deepEqual(s.map((x) => [x.label, x.status, x.detail]), [
    ["Cloudflare · Workers", "up", undefined],
    ["Cloudflare · d1", "down", "D1 queries failing"],
  ]);
  assert.equal(s[1].link, "https://stspg.io/d1");
});

test("statuspage: a repeated name takes the worst of its matches", async () => {
  const [s] = await statuspage({ name: "P", type: "statuspage", url: "https://x", components: ["us-east-1"] }, fake(summary));
  assert.equal(s.status, "degraded");
});

test("statuspage: unknown component is reported, not ignored", async () => {
  const [s] = await statuspage({ name: "P", type: "statuspage", url: "https://x", components: ["Nope"] }, fake(summary));
  assert.equal(s.status, "unknown");
  assert.match(s.detail ?? "", /Nope/);
});

test("statuspage: without components the page indicator decides", async () => {
  const [s] = await statuspage({ name: "Cloudflare", type: "statuspage", url: "https://x" }, fake(summary));
  assert.deepEqual([s.key, s.status, s.detail], ["Cloudflare", "down", "Something else"]);
});

test("statuspage: a page without incidents or components keys still reads", async () => {
  const page = { status: { indicator: "none", description: "All Systems Operational" } };
  const [whole] = await statuspage({ name: "PlanetScale", type: "statuspage", url: "https://x" }, fake(page));
  assert.deepEqual([whole.status, whole.detail], ["up", undefined]);
  const ctx: CheckContext = {
    t: MESSAGES.en,
    fetch: async (url) => Response.json(url.endsWith("components.json")
      ? { components: [{ id: "r", name: "us-east-1", status: "partial_outage" }] }
      : page),
  };
  const [comp] = await statuspage({ name: "PlanetScale", type: "statuspage", url: "https://x", components: ["us-east-1"] }, ctx);
  assert.equal(comp.status, "degraded", "falls back to components.json when the summary has no components");
});

test("statuspage: a broken page throws, so the runner reports no reading", async () => {
  await assert.rejects(statuspage({ name: "C", type: "statuspage", url: "https://x" }, fake("bad gateway", 502)), /HTTP 502/);
});

const feed = (items: string) => `<?xml version="1.0"?><rss><channel><link>https://status.aws.amazon.com/</link>${items}</channel></rss>`;
const item = (title: string, date: string) =>
  `<item><title><![CDATA[${title}]]></title><link>https://status.aws.amazon.com/#x</link><pubDate>${date}</pubDate></item>`;

test("rss: empty feed is up", async () => {
  const [s] = await rss({ name: "AWS Lambda", type: "rss", url: "https://x" }, fake(feed("")));
  assert.equal(s.status, "up");
});

test("rss: the latest item decides, whatever the order in the file", async () => {
  const xml = feed(
    item("Service is operating normally: [RESOLVED] Increased Error Rates", "Fri, 06 Nov 2026 10:00:00 PST") +
      item("Informational message: Increased Error Rates", "Fri, 06 Nov 2026 09:00:00 PST"),
  );
  assert.equal(parseItems(xml)[0].title.startsWith("Service is operating normally"), true);
  const [up] = await rss({ name: "AWS Lambda", type: "rss", url: "https://x" }, fake(xml));
  assert.equal(up.status, "up");

  const open = feed(item("Informational message: Increased Error Rates &amp; latency", "Fri, 06 Nov 2026 11:00:00 PST") + xml);
  const [down] = await rss({ name: "AWS Lambda", type: "rss", url: "https://x" }, fake(open));
  assert.deepEqual([down.status, down.detail], ["degraded", "Informational message: Increased Error Rates & latency"]);
});

test("http: status, body and timeout against a real local server", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/ok") return res.end("all good");
    if (req.url === "/slow") return setTimeout(() => res.end("late"), 500);
    res.statusCode = 503;
    res.end("nope");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ctx: CheckContext = {
    t: MESSAGES.pt,
    fetch: (url, init = {}) => fetch(url, { headers: init.headers, signal: AbortSignal.timeout(init.timeoutMs ?? 5000) }),
  };
  const one = async (path: string, extra = {}) => (await http({ name: "API", type: "http", url: base + path, ...extra }, ctx))[0];
  try {
    assert.equal((await one("/ok")).status, "up");
    assert.equal((await one("/ok", { contains: "good" })).status, "up");
    assert.deepEqual([(await one("/ok", { contains: "bad" })).status, (await one("/ok", { contains: "bad" })).detail],
      ["down", 'a resposta não contém "bad"']);
    assert.deepEqual([(await one("/fail")).status, (await one("/fail")).detail], ["down", "HTTP 503"]);
    assert.equal((await one("/fail", { expectStatus: [503] })).status, "up");
    const slow = await one("/slow", { timeoutMs: 100 });
    assert.deepEqual([slow.status, slow.detail], ["down", "sem resposta em 0 s"]);
    assert.equal((await one("/ok")).confirmations, 2, "http waits for two failures by default");
  } finally {
    server.close();
  }
});
