# statusbot

[English](README.en.md) · **Português**

Avisa no Telegram quando um serviço de que você depende cai — e quando volta.

```
🔴 Cloudflare · D1 — fora do ar
D1 queries failing
https://stspg.io/abc123

🟢 Cloudflare · D1 voltou — fora do ar por 23 min
```

Lê as páginas de status públicas dos fornecedores (Cloudflare, PlanetScale, Shopify, Claude e
qualquer outra no formato Statuspage), feeds RSS (AWS) e os seus próprios endpoints. Só manda
mensagem quando algo **muda**: nada de alerta repetido a cada 5 minutos.

- Node 24 + TypeScript, **zero dependências**.
- Um container, uma pasta de estado, um arquivo de configuração.
- Mensagens em português ou inglês.

## Como funciona

A cada `intervalSeconds` (padrão 5 min), o bot lê todos os serviços, compara com a leitura anterior
(guardada em `/data/state.json`) e avisa o que mudou.

| Situação | O que acontece |
|---|---|
| Primeira leitura | Sem alerta. Só a mensagem de início, listando o que já está fora do normal. |
| Mudou de estado | Alerta. No `http`, só depois de **2 falhas seguidas** — um timeout isolado não acorda ninguém. |
| Voltou ao normal | Alerta com quanto tempo ficou fora. |
| Não conseguiu ler a página de status | Vira "sem leitura", não "fora do ar" — e só avisa depois de 3 leituras seguidas. |
| O Telegram falhou | A mensagem fica guardada e sai no próximo ciclo. |
| O container reiniciou | Nada se repete: o estado está no volume. |

> **Rode fora do que você vigia.** Um monitor de Cloudflare rodando num Worker cai junto com a
> Cloudflare. Uma VPS, um Raspberry Pi ou um servidor em casa servem.

## Passo a passo

### 1. Crie o bot no Telegram

1. No Telegram, abra uma conversa com [@BotFather](https://t.me/BotFather).
2. Mande `/newbot`.
3. Dê um nome (aparece nas conversas, ex.: `Meu Status`) e um username, que precisa terminar em
   `bot` (ex.: `meu_status_bot`).
4. O BotFather responde com o **token**, algo como `123456789:AAH...`. Guarde: é a senha do bot.

### 2. Descubra o seu chat_id

O bot só pode mandar mensagem pra quem já falou com ele.

1. Abra a conversa com o seu bot (o link `t.me/meu_status_bot`) e mande qualquer mensagem.
   - **Pra receber num grupo:** adicione o bot ao grupo e mande `/start@meu_status_bot` lá.
2. Rode, trocando o token:

   ```bash
   docker run --rm -e TELEGRAM_BOT_TOKEN=123456789:AAH... ghcr.io/wisley7l/statusbot chat-id
   ```

   ```
   chat_id      type      name
   987654321    private   Seu Nome (@seu_usuario)
   -1001234567  supergroup  Alertas do time
   ```

   O `chat_id` de grupo é negativo — copie com o sinal.

### 3. Escolha o que vigiar

```bash
mkdir statusbot && cd statusbot
curl -fsSLO https://raw.githubusercontent.com/wisley7l/statusbot/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/wisley7l/statusbot/main/services.example.json -o services.json
curl -fsSL https://raw.githubusercontent.com/wisley7l/statusbot/main/.env.example -o .env
```

Preencha o `.env` com o token e o chat_id, e edite o `services.json` (veja
[Configuração](#configuração)).

### 4. Teste sem mandar nada

```bash
docker run --rm -e DRY_RUN=1 -v ./services.json:/config/services.json:ro ghcr.io/wisley7l/statusbot --once
```

Imprime as mensagens em vez de mandar, e mostra se algum componente não foi encontrado.

### 5. Suba

```bash
docker compose up -d
docker compose logs -f
```

A primeira mensagem chega na hora: `🤖 statusbot no ar — vigiando 12 sinais de 5 serviços.`

Sem compose:

```bash
docker run -d --name statusbot --restart unless-stopped --env-file .env \
  -v ./services.json:/config/services.json:ro -v statusbot-data:/data \
  ghcr.io/wisley7l/statusbot
```

Mudou o `services.json`? `docker compose restart`.

## Comandos

No chat do bot (o menu aparece ao digitar `/`):

| Comando | Resposta |
|---|---|
| `/status` | Como está tudo agora: o que está fora do normal primeiro, há quanto tempo e por quê. |
| `/help` | O que o bot faz e o que está vigiando. |

```
⚠️ 1 de 14 sinais fora do normal

🔴 GoPay API (staging) — fora do ar há 12 min (HTTP 502)
🟢 Cloudflare · Workers
...

Última leitura há 2 min.
```

Só o `TELEGRAM_CHAT_ID` recebe resposta — qualquer outro chat é ignorado (e aparece no log). O
`/status` responde na hora com a última leitura, sem consultar nada de novo. Em grupo, o bot só
responde a comandos.

Com o bot rodando, o `chat-id` não encontra nada: o bot lê as mensagens antes. Pare o bot pra
usar.

## Configuração

```json
{
  "language": "pt",
  "intervalSeconds": 300,
  "notifyOnStart": true,
  "services": [ ... ]
}
```

| Campo | Padrão | |
|---|---|---|
| `language` | `pt` | `pt` ou `en`. A variável `STATUSBOT_LANGUAGE` tem prioridade. |
| `intervalSeconds` | `300` | Mínimo 30. A variável `STATUSBOT_INTERVAL` tem prioridade. |
| `notifyOnStart` | `true` | Mensagem quando o bot sobe pela primeira vez. |

Todo serviço tem `name` (único), `type` e `url`. Opcionais em todos: `enabled` (`false` desliga sem
apagar), `timeoutMs`, `confirmations` (quantas leituras seguidas confirmam uma mudança).

### `statuspage` — páginas de status de fornecedores

Serve pra qualquer página no formato Atlassian Statuspage: o endereço termina em
`/api/v2/summary.json` e responde. É o formato de Cloudflare, PlanetScale, Shopify, Claude,
GitHub, OpenAI, Vercel, Stripe e muitos outros.

```json
{
  "name": "Cloudflare",
  "type": "statuspage",
  "url": "https://www.cloudflarestatus.com",
  "components": ["Workers", "D1", "Workers KV"]
}
```

- **Com `components`**: um alerta por componente, com o incidente que o afeta.
- **Sem `components`**: o indicador geral da página.

Prefira listar componentes. Páginas grandes vivem com algo fora do normal: a da Cloudflare
costuma marcar "Partial System Outage" por causa de um datacenter em manutenção do outro lado do
mundo.

Os nomes exatos dos componentes:

```bash
docker run --rm ghcr.io/wisley7l/statusbot components https://www.cloudflarestatus.com
```

### `rss` — feeds de status

```json
{
  "name": "AWS Lambda us-east-1",
  "type": "rss",
  "url": "https://status.aws.amazon.com/rss/lambda-us-east-1.rss"
}
```

O item mais recente decide: se o título diz que resolveu (`resolvedPattern`, por padrão
`operating normally|[resolved]|resolved`), está ok; senão, degradado. Feed vazio = ok.

Na AWS, o feed é por serviço e região: `https://status.aws.amazon.com/rss/<serviço>-<região>.rss`
(`s3-us-east-1`, `rds-sa-east-1`…).

### `http` — os seus endpoints

```json
{
  "name": "Minha API",
  "type": "http",
  "url": "https://meu-projeto.example.com/health",
  "expectStatus": [200],
  "contains": "ok",
  "headers": { "authorization": "Bearer ..." }
}
```

Fora do ar quando não responde em `timeoutMs` (padrão 10 s), responde fora de `expectStatus`
(padrão: qualquer 2xx) ou o corpo não contém `contains`. Avisa depois de 2 falhas seguidas
(`confirmations`).

Página de status confirma incidente com atraso, às vezes de meia hora. Um `http` no seu próprio
`/health` avisa em minutos — inclusive quando o problema é seu, não do fornecedor.

## Um tipo novo

1. Crie `src/checks/<tipo>.ts` exportando uma função `Check`: recebe a configuração do serviço e
   devolve uma lista de sinais `{ key, label, status, detail?, link?, confirmations }`.
2. Registre em `src/checks/index.ts`.
3. Teste em `test/` (`npm test`).

Se a leitura falhar, lance um erro: o bot transforma em "sem leitura", que não é "fora do ar".

## Rodando sem Docker

```bash
cp services.example.json services.json
DRY_RUN=1 npm run once                                    # testa
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm start     # roda
```

Precisa de Node 24 ou mais novo.

## Licença

MIT
