import { readFile } from "node:fs/promises";
import { CHECKS } from "./checks/index.ts";
import type { Config, Language } from "./types.ts";

export class ConfigError extends Error {}

const LANGUAGES: Language[] = ["pt", "en"];

export async function loadConfig(path: string, env: NodeJS.ProcessEnv): Promise<Config> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(`${path} not found — copy services.example.json and mount it there (see README)`);
    }
    throw new ConfigError(`${path}: ${(err as Error).message}`);
  }
  return parseConfig(raw, env, path);
}

export function parseConfig(raw: unknown, env: NodeJS.ProcessEnv, where = "config"): Config {
  const fail = (msg: string): never => {
    throw new ConfigError(`${where}: ${msg}`);
  };
  if (typeof raw !== "object" || raw === null) fail("must be a JSON object");
  const c = raw as Record<string, unknown>;

  const language = (env.STATUSBOT_LANGUAGE ?? c.language ?? "pt") as Language;
  if (!LANGUAGES.includes(language)) fail(`"language" must be one of ${LANGUAGES.join(", ")}`);

  const intervalSeconds = Number(env.STATUSBOT_INTERVAL ?? c.intervalSeconds ?? 300);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 30) fail(`"intervalSeconds" must be a number >= 30`);

  if (!Array.isArray(c.services) || c.services.length === 0) fail(`"services" must be a non-empty list`);
  const services = (c.services as Record<string, unknown>[]).map((s, i) => {
    const at = `services[${i}]`;
    if (typeof s?.name !== "string" || !s.name) fail(`${at}.name is required`);
    if (typeof s.url !== "string" || !/^https?:\/\//.test(s.url)) fail(`${at}.url must start with http:// or https://`);
    if (typeof s.type !== "string" || !(s.type in CHECKS)) fail(`${at}.type must be one of ${Object.keys(CHECKS).join(", ")}`);
    if (s.components !== undefined && !(Array.isArray(s.components) && s.components.every((x) => typeof x === "string"))) {
      fail(`${at}.components must be a list of names`);
    }
    return s as unknown as Config["services"][number];
  });

  const names = new Set<string>();
  for (const s of services) {
    if (names.has(s.name)) fail(`two services named "${s.name}" — names must be unique`);
    names.add(s.name);
  }

  return { language, intervalSeconds, notifyOnStart: c.notifyOnStart !== false, services };
}
