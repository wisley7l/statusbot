// Chat commands and who may use them. TELEGRAM_CHAT_ID is the admin: it gets the alerts and approves
// who else may ask the bot.
import { escapeHtml, type Entry, type State } from "./engine.ts";
import { EMOJI } from "./i18n.ts";
import type { Access, Chats } from "./state.ts";
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

/** The signals, worst first. Shared by /status and the HTTP endpoint. */
export const worstFirst = (state: State): Entry[] =>
  Object.values(state.signals).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

/** A chat that may use the bot. */
export interface ChatInfo {
  id: string;
  type: string;
  admin: boolean;
}

/** "/status@my_bot args" → "/status"; undefined for plain text. */
export function commandOf(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed.startsWith("/") ? trimmed.split(/\s+/)[0].replace(/@.*$/, "").toLowerCase() : undefined;
}

/**
 * The reply to a chat that may use the bot, or undefined to stay quiet. Commands are answered anywhere;
 * plain text only in a private chat, so the bot does not talk over a group.
 */
export function answer(text: string, chat: ChatInfo, v: View): string | undefined {
  const command = commandOf(text);
  if (command === undefined) return chat.type === "private" ? help(v, chat.admin) : undefined;
  if (command === "/status") return status(v);
  if (command === "/id") return v.t.chatId(chat.id);
  return help(v, chat.admin);
}

export function help(v: View, admin = false): string {
  const signals = v.state ? Object.keys(v.state.signals).length : 0;
  return v.t.help(signals, v.services, v.t.duration(v.intervalSeconds * 1000), admin);
}

export function status(v: View): string {
  if (!v.state || v.checkedAt === undefined) return v.t.notReadYet;
  const entries = worstFirst(v.state);
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

interface Named {
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface Message {
  message_id: number;
  chat: Named & { id: number; type: string };
  from?: Named & { id: number };
  text?: string;
}

export interface Update {
  update_id: number;
  message?: Message;
  /** A tap on an inline button. `message` is the one the button is on. */
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
}

export interface Button {
  text: string;
  callback_data: string;
}

export interface Listener {
  /** getUpdates: long-polls for up to `timeoutSec`. */
  poll(offset: number, timeoutSec: number, signal: AbortSignal): Promise<Update[]>;
  send(chatId: string, text: string, buttons?: Button[][]): Promise<void>;
  edit(chatId: string, messageId: number, text: string, buttons?: Button[][]): Promise<void>;
  /** Stops the spinner on a tapped button, with an optional toast. */
  ack(callbackId: string, text?: string): Promise<void>;
  answer(text: string, chat: ChatInfo): string | undefined;
  /** TELEGRAM_CHAT_ID: gets the alerts and approves who else may use the bot. */
  admin: string;
  /** Everyone else who asked. Changed in place; `save` persists it. */
  chats: Chats;
  save(chats: Chats): Promise<void>;
  t: Messages;
  signal: AbortSignal;
  log(msg: string): void;
  now?: () => number;
  pollSeconds?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Answers messages and buttons until `signal` aborts. Messages sent while the bot was off are skipped, not answered late. */
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
        try {
          if (u.callback_query) await onButton(l, u.callback_query);
          else if (u.message?.text) await onMessage(l, u.message);
        } catch (err) {
          l.log(`could not handle update ${u.update_id} (${(err as Error).message})`);
        }
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

const nameOf = (c: Named) =>
  [c.title ?? [c.first_name, c.last_name].filter(Boolean).join(" "), c.username && `@${c.username}`].filter(Boolean).join(" ");

async function onMessage(l: Listener, m: Message): Promise<void> {
  const id = String(m.chat.id);
  const command = commandOf(m.text ?? "");
  const admin = id === l.admin;
  const access: Access | undefined = admin ? "allowed" : l.chats[id]?.access;
  const name = nameOf(m.chat) || id;
  // Every message leaves its chat_id in the log: that is how you find who is using the bot.
  const log = (what: string) => l.log(`chat ${id}${name !== id ? ` (${name})` : ""}: ${command ?? "text"}${what && ` — ${what}`}`);

  if (access === "blocked") return log("blocked, ignored");
  if (access !== "allowed") {
    // In a group only commands count: the bot does not ask on behalf of every line of chat.
    if (m.chat.type !== "private" && !command) return log("ignored, not approved");
    if (access === "pending") {
      log("waiting for the admin");
      return l.send(id, l.t.waiting);
    }
    log("asking the admin");
    const by = m.chat.type !== "private" && m.from ? nameOf(m.from) : "";
    await l.send(l.admin, l.t.request(escapeHtml(name), id, by && escapeHtml(by)), [[
      { text: l.t.approve, callback_data: `a:${id}` },
      { text: l.t.refuse, callback_data: `r:${id}` },
      { text: l.t.block(), callback_data: `x:${id}` },
    ]]);
    l.chats[id] = { access: "pending", name, since: (l.now ?? Date.now)() };
    await l.save(l.chats);
    return l.send(id, l.t.requested);
  }

  log("");
  if (command === "/leave") {
    if (admin) return l.send(id, l.t.adminCannotLeave);
    delete l.chats[id];
    await l.save(l.chats);
    await l.send(id, l.t.left);
    return l.send(l.admin, l.t.leftAdmin(escapeHtml(name), id));
  }
  if (command === "/chats" && admin) return l.send(id, ...chatList(l));
  const text = l.answer(m.text ?? "", { id, type: m.chat.type, admin });
  if (text) await l.send(id, text);
}

/**
 * On a request — a: approve, r: refuse (they may ask again), x: block. On the /chats list — d: remove
 * (they may ask again), b: block, u: unblock. A block is silent: the person is never told.
 */
async function onButton(l: Listener, q: NonNullable<Update["callback_query"]>): Promise<void> {
  const chat = q.message && String(q.message.chat.id);
  const [action, id] = (q.data ?? "").split(":");
  // Buttons only go to the admin chat; a tap anywhere else changes nothing.
  if (!q.message || chat !== l.admin || !id) {
    l.log(`ignored a button from chat ${chat ?? "?"}`);
    return l.ack(q.id);
  }
  const msg = q.message.message_id;
  const entry = l.chats[id];
  const who = entry?.name ?? id;
  const tell = (text: string) => l.send(id, text).catch((err) => l.log(`could not tell chat ${id} (${(err as Error).message})`));
  const done = ({ a: "approved", r: "refused", x: "blocked", d: "removed", b: "blocked", u: "unblocked" } as Record<string, string>)[action];
  l.log(`admin: ${done ?? action} chat ${id}${who !== id ? ` (${who})` : ""}`);

  if (action === "a" || action === "r" || action === "x") {
    if (!entry) {
      await l.edit(l.admin, msg, l.t.gone);
      return l.ack(q.id, l.t.gone);
    }
    if (action === "r") delete l.chats[id];
    else entry.access = action === "a" ? "allowed" : "blocked";
    await l.save(l.chats);
    const note = { a: l.t.approved, r: l.t.refused, x: l.t.blockedNote }[action];
    await l.edit(l.admin, msg, note(escapeHtml(who), id));
    await l.ack(q.id);
    if (action !== "x") await tell(action === "a" ? l.t.welcome : l.t.notApproved);
    return;
  }

  if (entry && (action === "d" || action === "b" || action === "u")) {
    if (action === "b") entry.access = "blocked";
    else delete l.chats[id];
    await l.save(l.chats);
    if (action === "d") await tell(l.t.removedNotice);
  }
  await l.edit(l.admin, msg, ...chatList(l));
  return l.ack(q.id, entry ? undefined : l.t.gone);
}

const ICON: Record<Access, string> = { allowed: "✅", pending: "⏳", blocked: "🚫" };
const RANK: Access[] = ["allowed", "pending", "blocked"];

/** /chats: everyone who asked, with a button to change each one. Pending requests keep their own buttons. */
function chatList(l: Listener): [string, Button[][]] {
  const entries = Object.entries(l.chats).sort(([, a], [, b]) => RANK.indexOf(a.access) - RANK.indexOf(b.access) || a.name.localeCompare(b.name));
  const lines = entries.map(([id, e]) => `${ICON[e.access]} ${escapeHtml(e.name)} · <code>${id}</code>`);
  const buttons = entries.flatMap(([id, e]): Button[][] =>
    e.access === "allowed" ? [[{ text: l.t.remove(e.name), callback_data: `d:${id}` }, { text: l.t.block(e.name), callback_data: `b:${id}` }]]
    : e.access === "blocked" ? [[{ text: l.t.unblock(e.name), callback_data: `u:${id}` }]]
    : []);
  return [l.t.chatsList(lines), buttons];
}
