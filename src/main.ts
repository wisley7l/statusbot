import { CHECKS } from "./checks/index.ts";
import { listComponents } from "./checks/statuspage.ts";
import { dirname, join } from "node:path";
import { answer, listen } from "./commands.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { message, startMessage, step, type State } from "./engine.ts";
import { MESSAGES } from "./i18n.ts";
import { loadChats, loadState, saveChats, saveState } from "./state.ts";
import { answerCallback, console_, editMessage, getUpdates, recentChats, setCommands, telegram, type Telegram } from "./telegram.ts";
import type { CheckContext, Config, Signal } from "./types.ts";

const USER_AGENT = "statusbot (+https://github.com/wisley7l/statusbot)";
const env = process.env;
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const fetchWithTimeout: CheckContext["fetch"] = (url, init = {}) => {
  const { timeoutMs = 15_000, headers, ...rest } = init;
  return fetch(url, {
    ...rest,
    headers: { "user-agent": USER_AGENT, ...(headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(timeoutMs),
  });
};

async function readAll(config: Config): Promise<Signal[]> {
  const ctx: CheckContext = { fetch: fetchWithTimeout, t: MESSAGES[config.language] };
  const services = config.services.filter((s) => s.enabled !== false);
  const results = await Promise.all(services.map(async (s) => {
    try {
      return await CHECKS[s.type](s, ctx);
    } catch (err) {
      // The status page itself could not be read: that is "no reading", not "the service is down".
      const detail = err instanceof Error && err.name === "TimeoutError" ? ctx.t.timeout(s.timeoutMs ?? 15_000) : String((err as Error).message ?? err);
      const keys = s.components?.length ? s.components.map((c) => `${s.name} · ${c}`) : [s.name];
      return keys.map((key): Signal => ({ key, label: key, status: "unknown", detail, confirmations: 1 }));
    }
  }));
  return results.flat();
}

async function deliver(bot: Telegram, state: State, texts: string[]): Promise<void> {
  const queue = [...state.outbox, ...texts];
  state.outbox = [];
  for (const [i, text] of queue.entries()) {
    try {
      await bot.send(text);
    } catch (err) {
      log(`could not send (${(err as Error).message}) — ${queue.length - i} message(s) kept for the next cycle`);
      state.outbox = queue.slice(i).slice(-50);
      return;
    }
  }
}

async function cycle(config: Config, bot: Telegram, statePath: string, prev: State | undefined): Promise<State> {
  const signals = await readAll(config);
  const { state, changes } = step(prev ?? { signals: {}, outbox: [] }, signals, Date.now());
  const t = MESSAGES[config.language];
  const texts = changes.map((c) => message(c, t));
  if (!prev && config.notifyOnStart) texts.unshift(startMessage(state, config.services.filter((s) => s.enabled !== false).length, t));
  await deliver(bot, state, texts);
  await saveState(statePath, state);
  const off = Object.values(state.signals).filter((e) => e.status !== "up").length;
  log(`${signals.length} signals, ${off} not up, ${changes.length} change(s)${state.outbox.length ? `, ${state.outbox.length} unsent` : ""}`);
  return state;
}

async function run(once: boolean): Promise<void> {
  const config = await loadConfig(env.STATUSBOT_CONFIG ?? "services.json", env);
  const statePath = env.STATUSBOT_STATE ?? "state.json";
  const dry = env.DRY_RUN === "1";
  if (!dry && (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)) {
    throw new ConfigError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required (or DRY_RUN=1 to print instead of sending)");
  }
  const bot = dry ? console_ : telegram(env.TELEGRAM_BOT_TOKEN!, env.TELEGRAM_CHAT_ID!);
  const services = config.services.filter((s) => s.enabled !== false).length;
  log(`watching ${services} services every ${config.intervalSeconds}s, language=${config.language}${dry ? ", DRY_RUN" : ""}`);

  // A restart is not a first run: the saved state keeps alerts from repeating.
  let state = await loadState(statePath);
  let checkedAt: number | undefined;
  const stop = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => stop.abort());

  let listening: Promise<void> | undefined;
  if (!dry && !once) {
    const token = env.TELEGRAM_BOT_TOKEN!;
    const t = MESSAGES[config.language];
    const admin = env.TELEGRAM_CHAT_ID!;
    // Who else may use the bot, approved by the admin in the chat. Next to state.json, in the volume.
    const chatsPath = env.STATUSBOT_CHATS ?? join(dirname(statePath), "chats.json");
    const chats = await loadChats(chatsPath);
    const count = (a: string) => Object.values(chats).filter((c) => c.access === a).length;
    log(`admin is TELEGRAM_CHAT_ID; ${count("allowed")} other chat(s) approved, ${count("pending")} pending, ${count("blocked")} blocked`);
    const menu = (...names: ("status" | "help" | "id" | "leave" | "chats")[]) =>
      names.map((command) => ({ command, description: t.commandDescriptions[command] }));
    Promise.all([
      setCommands(token, menu("status", "help", "id", "leave")),
      setCommands(token, menu("status", "help", "id", "chats"), admin),
    ]).catch((err) => log(`could not set the command menu (${(err as Error).message})`));
    listening = listen({
      poll: (offset, timeoutSec, signal) => getUpdates(token, offset, timeoutSec, signal),
      send: (chatId, text, buttons) => bot.send(text, chatId, buttons),
      edit: (chatId, messageId, text, buttons) => editMessage(token, chatId, messageId, text, buttons),
      ack: (callbackId, text) => answerCallback(token, callbackId, text),
      answer: (text, chat) =>
        answer(text, chat, { state, checkedAt, services, intervalSeconds: config.intervalSeconds, now: Date.now(), t }),
      admin,
      chats,
      save: (c) => saveChats(chatsPath, c),
      t,
      signal: stop.signal,
      log,
    });
  }

  while (!stop.signal.aborted) {
    try {
      state = await cycle(config, bot, statePath, state);
      checkedAt = Date.now();
    } catch (err) {
      log(`cycle failed: ${(err as Error).stack ?? err}`);
    }
    if (once) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.intervalSeconds * 1000);
      stop.signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });
  }
  await listening;
  log("stopped");
}

async function main(args: string[]): Promise<void> {
  const [cmd, arg] = args;
  if (cmd === "chat-id") {
    if (!env.TELEGRAM_BOT_TOKEN) throw new ConfigError("set TELEGRAM_BOT_TOKEN first");
    const chats = await recentChats(env.TELEGRAM_BOT_TOKEN);
    console.log(chats.length
      ? `chat_id\ttype\tname\n${chats.join("\n")}`
      : "No chats yet. Send any message to your bot (in a group: /start@your_bot) and run this again.\n" +
        "If the bot is already running, stop it first: it reads the messages before this command can.");
    return;
  }
  if (cmd === "components") {
    if (!arg) throw new ConfigError("usage: components <status page url>, e.g. components https://www.cloudflarestatus.com");
    console.log((await listComponents(arg, fetchWithTimeout as typeof fetch)).join("\n"));
    return;
  }
  if (cmd && cmd !== "--once") throw new ConfigError(`unknown command "${cmd}" — use: (nothing) | --once | chat-id | components <url>`);
  await run(cmd === "--once");
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof ConfigError ? `error: ${err.message}` : err);
  process.exit(1);
});
