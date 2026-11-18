// Where alerts go. Messages are written in a small HTML subset (<b>, <code>, &amp; &lt; &gt;) and
// each channel converts them to its own format. Any combination can be on at once.
import { ConfigError } from "./config.ts";
import { telegram } from "./telegram.ts";

export interface Channel {
  /** Also the key of its queue of unsent messages in state.json. */
  name: string;
  send(text: string): Promise<void>;
}

/** Unsent messages per channel, retried on the next cycle. */
export type Outbox = Record<string, string[]>;

type Fetch = typeof fetch;

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Plain text: tags dropped, entities back to characters. */
export const toPlain = (html: string): string => unescape(html.replace(/<\/?(b|code)>/g, ""));

/** Slack mrkdwn: *bold*, `code`. Slack wants &, < and > escaped as well, so the entities stay. */
export const toSlack = (html: string): string => html.replace(/<\/?b>/g, "*").replace(/<\/?code>/g, "`");

/** POST JSON, waiting once or twice when the service says 429 with a Retry-After. */
async function post(f: Fetch, url: string, body: object, headers: Record<string, string> = {}): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const wait = Number(res.headers.get("retry-after"));
    if (res.status === 429 && wait > 0 && wait <= 30 && attempt < 3) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    return res;
  }
}

/** Short reason from an error body. Never the URL: webhook URLs are secrets and logs may be public. */
const reason = async (res: Response) => (await res.text().catch(() => "")).trim().slice(0, 200) || "no description";

export function slackWebhook(url: string, f: Fetch = fetch): Channel {
  return {
    name: "slack",
    async send(text) {
      const res = await post(f, url, { text: toSlack(text), unfurl_links: false });
      if (!res.ok) throw new Error(`Slack ${res.status}: ${await reason(res)}`);
    },
  };
}

/** chat.postMessage: the app must be in the channel. With `threadTs`, every alert is a reply in that thread. */
export function slackBot(token: string, channel: string, threadTs?: string, f: Fetch = fetch): Channel {
  return {
    name: "slack",
    async send(text) {
      const res = await post(f, "https://slack.com/api/chat.postMessage",
        { channel, text: toSlack(text), unfurl_links: false, ...(threadTs && { thread_ts: threadTs }) },
        { authorization: `Bearer ${token}` });
      // Slack answers 200 with { ok: false, error } for most failures.
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!body.ok) throw new Error(`Slack ${res.status}: ${body.error ?? "no description"}`);
    },
  };
}

/** Any service that takes POST {"text": "..."}: Google Chat, Mattermost, n8n, Discord (URL ending in /slack)… */
export function webhook(url: string, f: Fetch = fetch): Channel {
  return {
    name: "webhook",
    async send(text) {
      const res = await post(f, url, { text: toPlain(text) });
      if (!res.ok) throw new Error(`webhook ${res.status}: ${await reason(res)}`);
    },
  };
}

/** Prints instead of sending — for DRY_RUN=1. */
export const consoleChannel: Channel = {
  name: "console",
  async send(text) {
    console.log(`\n--- message ---\n${toPlain(text)}\n---------------`);
  },
};

const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s);

/** The channels the environment turns on. A half-set channel is an error, not silently off. */
export function channelsFromEnv(env: NodeJS.ProcessEnv, f: Fetch = fetch): Channel[] {
  const out: Channel[] = [];
  const { TELEGRAM_BOT_TOKEN: tgToken, TELEGRAM_CHAT_ID: tgChat } = env;
  if (tgToken || tgChat) {
    if (!tgToken || !tgChat) throw new ConfigError("Telegram needs both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID");
    const bot = telegram(tgToken, tgChat);
    out.push({ name: "telegram", send: (text) => bot.send(text) });
  }

  const { SLACK_WEBHOOK_URL: slackUrl, SLACK_BOT_TOKEN: slackToken, SLACK_CHANNEL: slackChannel, SLACK_THREAD_TS: threadTs } = env;
  if (slackUrl && (slackToken || slackChannel)) {
    throw new ConfigError("Slack: use SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN + SLACK_CHANNEL, not both");
  }
  if (slackUrl) {
    if (!isUrl(slackUrl)) throw new ConfigError("SLACK_WEBHOOK_URL must be a URL (https://hooks.slack.com/...)");
    if (threadTs) throw new ConfigError("SLACK_THREAD_TS needs SLACK_BOT_TOKEN + SLACK_CHANNEL: a webhook cannot reply in a thread");
    out.push(slackWebhook(slackUrl, f));
  } else if (slackToken || slackChannel || threadTs) {
    if (!slackToken || !slackChannel) throw new ConfigError("Slack needs both SLACK_BOT_TOKEN and SLACK_CHANNEL");
    out.push(slackBot(slackToken, slackChannel, threadTs, f));
  }

  if (env.WEBHOOK_URL) {
    if (!isUrl(env.WEBHOOK_URL)) throw new ConfigError("WEBHOOK_URL must be a URL");
    out.push(webhook(env.WEBHOOK_URL, f));
  }
  return out;
}

/**
 * Sends the queued and the new messages to every channel at once, in order. What a channel could not
 * take stays in its own queue (the last 50); a channel that is no longer configured loses its queue.
 */
export async function deliver(channels: Channel[], outbox: Outbox, texts: string[], log: (msg: string) => void): Promise<Outbox> {
  const next: Outbox = {};
  await Promise.all(channels.map(async (ch) => {
    const queue = [...(outbox[ch.name] ?? []), ...texts];
    for (const [i, text] of queue.entries()) {
      try {
        await ch.send(text);
      } catch (err) {
        log(`${ch.name}: could not send (${(err as Error).message}) — ${queue.length - i} message(s) kept for the next cycle`);
        next[ch.name] = queue.slice(i).slice(-50);
        return;
      }
    }
  }));
  return next;
}
