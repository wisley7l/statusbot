# statusbot

**English** · [Português](README.md)

Telegram alerts when a service you depend on goes down — and when it comes back.

```
🔴 Cloudflare · D1 — down
D1 queries failing
https://stspg.io/abc123

🟢 Cloudflare · D1 is back — down for 23 min
```

It reads vendors' public status pages (Cloudflare, PlanetScale, Shopify, Claude and anything else
in the Statuspage format), RSS feeds (AWS) and your own endpoints. It only messages when something
**changes**: no repeated alert every 5 minutes.

- Node 24 + TypeScript, **zero dependencies**.
- One container, one state folder, one config file.
- Messages in English or Portuguese.

## How it works

Every `intervalSeconds` (default 5 min) the bot reads every service, compares with the previous
reading (kept in `/data/state.json`) and reports what changed.

| Situation | What happens |
|---|---|
| First reading | No alert. Only the startup message, listing what is already not normal. |
| Status changed | Alert. For `http`, only after **2 failures in a row** — one timeout wakes no one. |
| Back to normal | Alert with how long it lasted. |
| Could not read the status page | Becomes "no reading", not "down" — and only after 3 readings in a row. |
| Telegram failed | The message is kept and sent on the next cycle. |
| Container restarted | Nothing repeats: the state is on the volume. |

> **Run it outside what you watch.** A Cloudflare monitor on a Worker goes down with Cloudflare.
> A VPS, a Raspberry Pi or a home server will do.

## Step by step

### 1. Create the Telegram bot

1. In Telegram, open a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Pick a name (shown in chats, e.g. `My Status`) and a username ending in `bot`
   (e.g. `my_status_bot`).
4. BotFather replies with the **token**, like `123456789:AAH...`. Keep it: it is the bot's password.

### 2. Find your chat_id

A bot can only message someone who has talked to it.

1. Open the chat with your bot (`t.me/my_status_bot`) and send any message.
   - **To receive in a group:** add the bot to the group and send `/start@my_status_bot` there.
2. Run, with your token:

   ```bash
   docker run --rm -e TELEGRAM_BOT_TOKEN=123456789:AAH... ghcr.io/wisley7l/statusbot chat-id
   ```

   ```
   chat_id      type      name
   987654321    private   Your Name (@your_user)
   -1001234567  supergroup  Team alerts
   ```

   Group chat_ids are negative — copy the sign too.

### 3. Choose what to watch

```bash
mkdir statusbot && cd statusbot
curl -fsSLO https://raw.githubusercontent.com/wisley7l/statusbot/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/wisley7l/statusbot/main/services.example.json -o services.json
curl -fsSL https://raw.githubusercontent.com/wisley7l/statusbot/main/.env.example -o .env
```

Fill `.env` with the token and chat_id, set `"language": "en"` and edit `services.json` (see
[Configuration](#configuration)).

### 4. Try it without sending

```bash
docker run --rm -e DRY_RUN=1 -v ./services.json:/config/services.json:ro ghcr.io/wisley7l/statusbot --once
```

Prints the messages instead of sending them, and shows any component that was not found.

### 5. Run it

```bash
docker compose up -d
docker compose logs -f
```

The first message arrives right away: `🤖 statusbot is up — watching 12 signals from 5 services.`

Without compose:

```bash
docker run -d --name statusbot --restart unless-stopped --env-file .env \
  -v ./services.json:/config/services.json:ro -v statusbot-data:/data \
  ghcr.io/wisley7l/statusbot
```

Changed `services.json`? `docker compose restart`.

## Commands

In the bot's chat (the menu shows up when you type `/`):

| Command | Reply |
|---|---|
| `/status` | How everything is right now: what is not normal first, for how long and why. |
| `/help` | What the bot does and what it is watching. |

```
⚠️ 1 of 14 signals not normal

🔴 My API — down for 12 min (HTTP 502)
🟢 Cloudflare · Workers
...

Last read 2 min ago.
```

Only `TELEGRAM_CHAT_ID` gets answers — any other chat is ignored (and shows up in the log).
`/status` answers right away from the latest reading, without fetching anything. In a group, the
bot only answers commands.

While the bot is running, `chat-id` finds nothing: the bot reads the messages first. Stop the bot
to use it.

## Configuration

```json
{
  "language": "en",
  "intervalSeconds": 300,
  "notifyOnStart": true,
  "services": [ ... ]
}
```

| Field | Default | |
|---|---|---|
| `language` | `pt` | `pt` or `en`. The `STATUSBOT_LANGUAGE` variable takes precedence. |
| `intervalSeconds` | `300` | At least 30. The `STATUSBOT_INTERVAL` variable takes precedence. |
| `notifyOnStart` | `true` | Message when the bot starts for the first time. |

Every service has `name` (unique), `type` and `url`. Optional on all: `enabled` (`false` turns it
off without deleting), `timeoutMs`, `confirmations` (how many readings in a row confirm a change).

### `statuspage` — vendor status pages

Works with any page in the Atlassian Statuspage format: `<url>/api/v2/summary.json` answers. That is
Cloudflare, PlanetScale, Shopify, Claude, GitHub, OpenAI, Vercel, Stripe and many more.

```json
{
  "name": "Cloudflare",
  "type": "statuspage",
  "url": "https://www.cloudflarestatus.com",
  "components": ["Workers", "D1", "Workers KV"]
}
```

- **With `components`**: one alert per component, with the incident affecting it.
- **Without `components`**: the page's overall indicator.

Prefer listing components. Large pages always have something off: Cloudflare's often shows
"Partial System Outage" because of a datacenter under maintenance on the other side of the world.

Exact component names:

```bash
docker run --rm ghcr.io/wisley7l/statusbot components https://www.cloudflarestatus.com
```

### `rss` — status feeds

```json
{
  "name": "AWS Lambda us-east-1",
  "type": "rss",
  "url": "https://status.aws.amazon.com/rss/lambda-us-east-1.rss"
}
```

The latest item decides: if its title says resolved (`resolvedPattern`, default
`operating normally|[resolved]|resolved`), it is up; otherwise, degraded. Empty feed = up.

On AWS, feeds are per service and region: `https://status.aws.amazon.com/rss/<service>-<region>.rss`
(`s3-us-east-1`, `rds-sa-east-1`…).

### `http` — your endpoints

```json
{
  "name": "My API",
  "type": "http",
  "url": "https://my-project.example.com/health",
  "expectStatus": [200],
  "contains": "ok",
  "headers": { "authorization": "Bearer ..." }
}
```

Down when it does not answer within `timeoutMs` (default 10 s), answers outside `expectStatus`
(default: any 2xx) or the body lacks `contains`. Alerts after 2 failures in a row (`confirmations`).

Status pages confirm incidents late, sometimes by half an hour. An `http` check on your own
`/health` alerts within minutes — including when the problem is yours, not the vendor's.

## A new check type

1. Create `src/checks/<type>.ts` exporting a `Check`: it receives the service config and returns
   signals `{ key, label, status, detail?, link?, confirmations }`.
2. Register it in `src/checks/index.ts`.
3. Test it in `test/` (`npm test`).

If reading fails, throw: the bot turns it into "no reading", which is not "down".

## Running without Docker

```bash
cp services.example.json services.json
DRY_RUN=1 npm run once                                    # try
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm start     # run
```

Requires Node 24 or newer.

## License

MIT
