// Chat commands: /status and /help. Only the configured chat gets an answer.
import { escapeHtml, type State } from "./engine.ts";
import { EMOJI } from "./i18n.ts";
import type { Messages, Status } from "./types.ts";

/** What a command can see: the latest state and when it was read. */
export interface View {
  state?: State;
  /** When the current process last finished a reading. Missing = still on the first one. */
  checkedAt?: number;
  services: number;
  intervalSeconds: number;
  now: number;
  t: Messages;
}

/** Worst first, so what matters is at the top of /status. */
const ORDER: Status[] = ["down", "degraded", "unknown", "maintenance", "up"];

/**
 * The reply to a message, or undefined to stay quiet. Commands are answered anywhere; plain text only
 * in a private chat, so the bot does not talk over a group.
 */
export function answer(text: string, chatType: string, v: View): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return chatType === "private" ? help(v) : undefined;
  const command = trimmed.split(/\s+/)[0].replace(/@.*$/, "").toLowerCase();
  return command === "/status" ? status(v) : help(v);
}

export function help(v: View): string {
  const signals = v.state ? Object.keys(v.state.signals).length : 0;
  return v.t.help(signals, v.services, v.t.duration(v.intervalSeconds * 1000));
}

export function status(v: View): string {
  if (!v.state || v.checkedAt === undefined) return v.t.notReadYet;
  const entries = Object.values(v.state.signals).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const off = entries.filter((e) => e.status !== "up");
  const lines = [v.t.statusSummary(off.length, entries.length), ""];
  for (const e of entries) {
    const label = escapeHtml(e.label);
    if (e.status === "up") {
      lines.push(`${EMOJI.up} ${label}`);
      continue;
    }
    const detail = e.detail ? ` (${escapeHtml(e.detail)})` : "";
    lines.push(`${EMOJI[e.status]} <b>${label}</b> — ${v.t.statusName[e.status]} ${v.t.lasting(v.t.duration(v.now - e.since))}${detail}`);
  }
  lines.push("", v.t.lastRead(v.t.duration(v.now - v.checkedAt)));
  return lines.join("\n");
}

export interface Update {
  update_id: number;
  message?: { chat: { id: number; type: string }; text?: string };
}

export interface Listener {
  /** getUpdates: long-polls for up to `timeoutSec`. */
  poll(offset: number, timeoutSec: number, signal: AbortSignal): Promise<Update[]>;
  reply(text: string): Promise<void>;
  answer(text: string, chatType: string): string | undefined;
  chatId: string;
  signal: AbortSignal;
  log(msg: string): void;
  pollSeconds?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Answers commands until `signal` aborts. Messages sent while the bot was off are skipped, not answered late. */
export async function listen(l: Listener): Promise<void> {
  const sleep = l.sleep ?? abortableSleep;
  let offset: number | undefined;
  let failures = 0;
  while (!l.signal.aborted) {
    try {
      if (offset === undefined) {
        // offset -1 returns only the newest update and confirms everything before it.
        const last = await l.poll(-1, 0, l.signal);
        offset = last.length ? last[last.length - 1].update_id + 1 : 0;
        continue;
      }
      const updates = await l.poll(offset, l.pollSeconds ?? 50, l.signal);
      failures = 0;
      for (const u of updates) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m?.text) continue;
        if (String(m.chat.id) !== l.chatId) {
          l.log(`ignored a message from chat ${m.chat.id} — only TELEGRAM_CHAT_ID gets answers`);
          continue;
        }
        const text = l.answer(m.text, m.chat.type);
        if (text) await l.reply(text).catch((err) => l.log(`could not answer (${(err as Error).message})`));
      }
    } catch (err) {
      if (l.signal.aborted) return;
      failures++;
      const wait = Math.min(60, 2 ** failures);
      l.log(`could not read Telegram messages (${(err as Error).message}) — retrying in ${wait}s`);
      await sleep(wait * 1000, l.signal);
    }
  }
}
