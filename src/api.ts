// Optional read-only HTTP endpoint: GET /api/status returns in JSON what /status shows in Telegram.
// On with HTTP_PORT. With HTTP_TOKEN, every request needs `Authorization: Bearer <token>`. Without it,
// the server only listens on localhost.
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { worstFirst } from "./commands.ts";
import { ConfigError } from "./config.ts";
import type { State } from "./engine.ts";

export interface ApiConfig {
  port: number;
  host: string;
  token?: string;
}

/** What the endpoint reads on each request: the latest state, as the Telegram commands see it. */
export interface Snapshot {
  state?: State;
  /** When the current process last finished a reading. Missing = still on the first one. */
  checkedAt?: number;
  services: number;
  intervalSeconds: number;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
export const isLoopback = (host: string) => LOOPBACK.has(host) || host.startsWith("127.");

/** Off (undefined) without HTTP_PORT. HTTP_HOST defaults to localhost; the Docker image sets 0.0.0.0. */
export function apiConfig(env: NodeJS.ProcessEnv): ApiConfig | undefined {
  if (!env.HTTP_PORT) return undefined;
  const port = Number(env.HTTP_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError(`HTTP_PORT must be a port number, got "${env.HTTP_PORT}"`);
  return { port, host: env.HTTP_HOST || "127.0.0.1", token: env.HTTP_TOKEN || undefined };
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The JSON body. 503 before the first reading, like /status answering "not read yet". */
export function statusBody(s: Snapshot): { code: number; body: unknown } {
  const read = s.state !== undefined && s.checkedAt !== undefined;
  const entries = read ? worstFirst(s.state!) : [];
  return {
    code: read ? 200 : 503,
    body: {
      checkedAt: read ? iso(s.checkedAt!) : null,
      intervalSeconds: s.intervalSeconds,
      services: s.services,
      signals: entries.length,
      notUp: entries.filter((e) => e.status !== "up").length,
      items: entries.map((e) => ({
        label: e.label,
        status: e.status,
        since: iso(e.since),
        ...(e.detail !== undefined && { detail: e.detail }),
        ...(e.link !== undefined && { link: e.link }),
      })),
    },
  };
}

function authorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true; // no token: only reachable from localhost (see serve)
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function send(res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

export function handler(cfg: ApiConfig, snapshot: () => Snapshot) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const path = new URL(req.url ?? "/", "http://x").pathname.replace(/\/+$/, "");
    if (path !== "/api/status") return send(res, 404, { error: "not found" });
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
    if (!authorized(req, cfg.token)) return send(res, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
    const { code, body } = statusBody(snapshot());
    send(res, code, body);
  };
}

/** Starts listening; resolves once the port is open. Closes when `signal` aborts. */
export async function serve(cfg: ApiConfig, snapshot: () => Snapshot, signal: AbortSignal, log: (msg: string) => void): Promise<Server> {
  const server = createServer(handler(cfg, snapshot));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, cfg.host, () => (server.off("error", reject), resolve()));
  });
  signal.addEventListener("abort", () => server.close(), { once: true });
  const addr = server.address();
  const where = typeof addr === "object" && addr ? `${addr.address}:${addr.port}` : `${cfg.host}:${cfg.port}`;
  const guard = cfg.token ? "token required" : isLoopback(cfg.host) ? "no token, localhost only" : "no token — keep the port private";
  log(`HTTP: GET /api/status on ${where} (${guard})`);
  return server;
}
