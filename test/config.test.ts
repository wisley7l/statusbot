import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ConfigError, parseConfig } from "../src/config.ts";

const svc = { name: "A", type: "http", url: "https://a" };

test("the example config is valid", async () => {
  const c = parseConfig(JSON.parse(await readFile("services.example.json", "utf8")), {});
  assert.equal(c.language, "pt");
  assert.equal(c.intervalSeconds, 300);
});

test("defaults and env overrides", () => {
  const c = parseConfig({ services: [svc] }, {});
  assert.deepEqual([c.language, c.intervalSeconds, c.notifyOnStart], ["pt", 300, true]);
  const e = parseConfig({ language: "pt", services: [svc] }, { STATUSBOT_LANGUAGE: "en", STATUSBOT_INTERVAL: "60" });
  assert.deepEqual([e.language, e.intervalSeconds], ["en", 60]);
});

test("errors say what to fix", () => {
  const bad = (raw: unknown, re: RegExp) => assert.throws(() => parseConfig(raw, {}), (e: Error) => e instanceof ConfigError && re.test(e.message));
  bad({ services: [] }, /non-empty/);
  bad({ services: [{ ...svc, type: "ping" }] }, /type must be one of statuspage, rss, http/);
  bad({ services: [{ ...svc, url: "a.com" }] }, /url must start with/);
  bad({ services: [svc, svc] }, /two services named "A"/);
  bad({ language: "es", services: [svc] }, /language/);
  bad({ intervalSeconds: 5, services: [svc] }, />= 30/);
});
