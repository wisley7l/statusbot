import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { apiConfig, serve, type ApiConfig, type Snapshot } from "../src/api.ts";
import { ConfigError } from "../src/config.ts";
import { step, type State } from "../src/engine.ts";
import type { Signal, Status } from "../src/types.ts";

const MIN = 60_000;
const sig = (key: string, status: Status, detail?: string, link?: string): Signal => ({ key, label: key, status, detail, link, confirmations: 1 });
const empty: State = { signals: {}, outbox: [] };
const stop = new AbortController();
after(() => stop.abort());

let snapshot: Snapshot = { state: step(empty, [sig("A", "up")], 0).state, checkedAt: 2 * MIN, services: 1, intervalSeconds: 300 };

async function start(cfg: Partial<ApiConfig> = {}): Promise<string> {
  const server = await serve({ port: 0, host: "127.0.0.1", ...cfg }, () => snapshot, stop.signal, () => {});
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("apiConfig: off without HTTP_PORT, localhost by default, rejects a bad port", () => {
  assert.equal(apiConfig({}), undefined);
  assert.deepEqual(apiConfig({ HTTP_PORT: "8080" }), { port: 8080, host: "127.0.0.1", token: undefined });
  assert.deepEqual(apiConfig({ HTTP_PORT: "8080", HTTP_HOST: "0.0.0.0", HTTP_TOKEN: "s3" }), { port: 8080, host: "0.0.0.0", token: "s3" });
  assert.throws(() => apiConfig({ HTTP_PORT: "abc" }), ConfigError);
  assert.throws(() => apiConfig({ HTTP_PORT: "70000" }), ConfigError);
});

test("GET /api/status: worst first, with since and why", async () => {
  const base = await start();
  const state = step(empty, [sig("Cloudflare · D1", "up"), sig("GoPay API", "down", "HTTP 502", "https://x"), sig("Shopify", "degraded")], 0).state;
  snapshot = { state, checkedAt: 10 * MIN, services: 3, intervalSeconds: 300 };
  const res = await fetch(`${base}/api/status`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /application\/json/);
  assert.deepEqual(await res.json(), {
    checkedAt: "1970-01-01T00:10:00.000Z",
    intervalSeconds: 300,
    services: 3,
    signals: 3,
    notUp: 2,
    items: [
      { label: "GoPay API", status: "down", since: "1970-01-01T00:00:00.000Z", detail: "HTTP 502", link: "https://x" },
      { label: "Shopify", status: "degraded", since: "1970-01-01T00:00:00.000Z" },
      { label: "Cloudflare · D1", status: "up", since: "1970-01-01T00:00:00.000Z" },
    ],
  });
});

test("503 before the first reading", async () => {
  const base = await start();
  snapshot = { state: step(empty, [sig("A", "up")], 0).state, checkedAt: undefined, services: 1, intervalSeconds: 300 };
  const res = await fetch(`${base}/api/status`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.checkedAt, null);
  assert.deepEqual(body.items, []);
});

test("token: required when set, wrong or missing is 401", async () => {
  const base = await start({ token: "s3cret" });
  snapshot = { state: step(empty, [sig("A", "up")], 0).state, checkedAt: MIN, services: 1, intervalSeconds: 300 };
  assert.equal((await fetch(`${base}/api/status`)).status, 401);
  assert.equal((await fetch(`${base}/api/status`, { headers: { authorization: "Bearer nope" } })).status, 401);
  assert.equal((await fetch(`${base}/api/status`, { headers: { authorization: "Bearer s3cret" } })).status, 200);
});

test("only GET on /api/status", async () => {
  const base = await start();
  assert.equal((await fetch(`${base}/`)).status, 404);
  assert.equal((await fetch(`${base}/api/other`)).status, 404);
  assert.equal((await fetch(`${base}/api/status/`)).status, 200);
  const post = await fetch(`${base}/api/status`, { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});
