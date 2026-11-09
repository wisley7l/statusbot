import type { Button, Update } from "./commands.ts";

const API = "https://api.telegram.org";

export interface Telegram {
  /** Sends to `to`, or to the alerts chat when it is missing. `buttons` = inline keyboard rows. */
  send(text: string, to?: string, buttons?: Button[][]): Promise<void>;
}

export function telegram(token: string, chatId: string): Telegram {
  return {
    async send(text, to = chatId, buttons) {
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(`${API}/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: to,
            text,
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            ...(buttons && { reply_markup: { inline_keyboard: buttons } }),
          }),
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

/** Long-polls for new messages and button taps. The request outlives Telegram's own timeout by a margin. */
export const getUpdates = (token: string, offset: number, timeoutSec: number, signal: AbortSignal): Promise<Update[]> =>
  call<Update[]>(
    token,
    "getUpdates",
    { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] },
    AbortSignal.any([signal, AbortSignal.timeout((timeoutSec + 15) * 1000)]),
  );

/** Replaces a message the bot sent — text and buttons. No buttons = the buttons go away. */
export async function editMessage(token: string, chatId: string, messageId: number, text: string, buttons: Button[][] = []): Promise<void> {
  try {
    await call<unknown>(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: buttons },
    }, AbortSignal.timeout(15_000));
  } catch (err) {
    // A double tap re-renders the same thing: nothing to change is not a failure.
    if (!/message is not modified/.test((err as Error).message)) throw err;
  }
}

/** Stops the loading spinner on a tapped button, with an optional toast. */
export const answerCallback = (token: string, callbackId: string, text?: string): Promise<void> =>
  call<void>(token, "answerCallbackQuery", { callback_query_id: callbackId, text }, AbortSignal.timeout(15_000));

/** The menu Telegram shows when you type "/". `chatId` = a menu just for that chat. */
export const setCommands = (token: string, commands: { command: string; description: string }[], chatId?: string): Promise<void> =>
  call<void>(token, "setMyCommands", { commands, ...(chatId && { scope: { type: "chat", chat_id: chatId } }) }, AbortSignal.timeout(15_000));

/** Chats that have talked to the bot recently — how you find your TELEGRAM_CHAT_ID. */
export async function recentChats(token: string): Promise<string[]> {
  // allowed_updates sticks between calls: the running bot narrows it, so ask for what this needs.
  const allowed = encodeURIComponent(JSON.stringify(["message", "my_chat_member", "channel_post"]));
  const res = await fetch(`${API}/bot${token}/getUpdates?allowed_updates=${allowed}`, { signal: AbortSignal.timeout(15_000) });
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
