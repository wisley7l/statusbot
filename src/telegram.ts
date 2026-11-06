import type { Update } from "./commands.ts";

const API = "https://api.telegram.org";

export interface Telegram {
  send(text: string): Promise<void>;
}

export function telegram(token: string, chatId: string): Telegram {
  return {
    async send(text) {
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(`${API}/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } };
        const wait = body.parameters?.retry_after;
        if (res.status === 429 && wait && attempt < 3) {
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        throw new Error(`Telegram ${res.status}: ${body.description ?? "no description"}`);
      }
    },
  };
}

/** Prints instead of sending — for DRY_RUN=1 and for trying the config without a bot. */
export const console_: Telegram = {
  async send(text) {
    console.log(`\n--- message ---\n${text.replace(/<\/?b>/g, "")}\n---------------`);
  },
};

async function call<T>(token: string, method: string, params: object, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: T };
  if (!body.ok) throw new Error(`Telegram ${res.status}: ${body.description ?? "no description"}`);
  return body.result as T;
}

/** Long-polls for new messages. The request outlives Telegram's own timeout by a margin. */
export const getUpdates = (token: string, offset: number, timeoutSec: number, signal: AbortSignal): Promise<Update[]> =>
  call<Update[]>(token, "getUpdates", { offset, timeout: timeoutSec }, AbortSignal.any([signal, AbortSignal.timeout((timeoutSec + 15) * 1000)]));

/** The menu Telegram shows when you type "/". */
export const setCommands = (token: string, commands: { command: string; description: string }[]): Promise<void> =>
  call<void>(token, "setMyCommands", { commands }, AbortSignal.timeout(15_000));

/** Chats that have talked to the bot recently — how you find your TELEGRAM_CHAT_ID. */
export async function recentChats(token: string): Promise<string[]> {
  const res = await fetch(`${API}/bot${token}/getUpdates`, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { message?: { chat: Chat }; my_chat_member?: { chat: Chat }; channel_post?: { chat: Chat } }[];
  };
  if (!body.ok) throw new Error(`Telegram: ${body.description ?? res.status}`);
  const seen = new Map<number, string>();
  for (const u of body.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (chat) seen.set(chat.id, `${chat.id}\t${chat.type}\t${chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? ""}${chat.username ? ` (@${chat.username})` : ""}`);
  }
  return [...seen.values()];
}

interface Chat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}
