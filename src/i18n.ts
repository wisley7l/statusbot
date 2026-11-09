import type { Language, Messages, Status } from "./types.ts";

export const EMOJI: Record<Status, string> = {
  up: "🟢",
  degraded: "🟡",
  maintenance: "🔧",
  down: "🔴",
  unknown: "⚪",
};

function duration(ms: number, units: { lt1: string; min: string; h: string; d: string }): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return units.lt1;
  if (min < 60) return `${min} ${units.min}`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} ${units.h} ${min % 60} ${units.min}` : `${h} ${units.h}`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} ${units.d} ${h % 24} ${units.h}` : `${d} ${units.d}`;
}

const pt: Messages = {
  statusName: {
    up: "operando normalmente",
    degraded: "degradado",
    maintenance: "em manutenção",
    down: "fora do ar",
    unknown: "sem leitura",
  },
  componentNotFound: (name) => `componente "${name}" não existe nesta página de status`,
  timeout: (ms) => `sem resposta em ${Math.round(ms / 1000)} s`,
  bodyMissing: (text) => `a resposta não contém "${text}"`,
  recovered: (label, previous, d) =>
    `${EMOJI.up} <b>${label}</b> voltou — ${previous === "down" ? "fora do ar" : pt.statusName[previous]} por ${d}`,
  readingBack: (label) => `${EMOJI.up} <b>${label}</b> — a leitura voltou, operando normalmente`,
  unreadable: (label, detail) => `${EMOJI.unknown} <b>${label}</b> — não consegui ler o status (${detail})`,
  changed: (label, status) => `${EMOJI[status]} <b>${label}</b> — ${pt.statusName[status]}`,
  started: (signals, services) =>
    `🤖 statusbot no ar — vigiando ${signals} ${signals === 1 ? "sinal" : "sinais"} de ${services} ${services === 1 ? "serviço" : "serviços"}.`,
  notUp: "Agora, fora do normal:",
  duration: (ms) => duration(ms, { lt1: "menos de 1 min", min: "min", h: "h", d: "d" }),
  help: (signals, services, every, admin) =>
    [
      admin
        ? "🤖 <b>statusbot</b> — aviso aqui quando um serviço cai e quando volta."
        : "🤖 <b>statusbot</b> — vigio uns serviços e te conto como eles estão.",
      "",
      "/status — como está tudo agora",
      "/help — esta mensagem",
      "/id — o chat_id desta conversa",
      admin ? "/chats — quem mais pode usar o bot" : "/leave — parar de usar o bot",
      "",
      `Vigiando ${signals} ${signals === 1 ? "sinal" : "sinais"} de ${services} ${services === 1 ? "serviço" : "serviços"}, lendo a cada ${every}.`,
    ].join("\n"),
  statusSummary: (off, signals) =>
    off === 0
      ? `${EMOJI.up} <b>Tudo normal</b> — ${signals} ${signals === 1 ? "sinal" : "sinais"}`
      : `⚠️ <b>${off} de ${signals} ${signals === 1 ? "sinal" : "sinais"} fora do normal</b>`,
  lasting: (d) => `há ${d}`,
  lastRead: (ago) => `Última leitura há ${ago}.`,
  notReadYet: "Ainda estou fazendo a primeira leitura — tente de novo em alguns segundos.",
  chatId: (id) => `🆔 O chat_id desta conversa é <code>${id}</code>.`,
  requested: "🔐 Pedi ao admin autorização pra você usar este bot. Te aviso aqui assim que houver resposta.",
  waiting: "⏳ Seu pedido ainda está com o admin.",
  request: (chat, id, by) =>
    `🔔 ${by ? `<b>${by}</b> quer usar o bot no grupo <b>${chat}</b>.` : `<b>${chat}</b> quer usar o bot.`}\nchat_id <code>${id}</code>`,
  approve: "✅ Aprovar",
  refuse: "❌ Recusar",
  approved: (who, id) => `✅ Acesso aprovado: <b>${who}</b> · <code>${id}</code>`,
  refused: (who, id) => `❌ Pedido recusado: <b>${who}</b> · <code>${id}</code>`,
  blockedNote: (who, id) => `🚫 Bloqueado: <b>${who}</b> · <code>${id}</code>`,
  welcome: "✅ Acesso liberado! Mande /status pra ver como está tudo.",
  notApproved: "Seu pedido pra usar este bot não foi aprovado. Se quiser, mande uma mensagem pra pedir de novo.",
  removedNotice: "Seu acesso a este bot foi removido.",
  left: "👋 Pronto, você saiu. Pra voltar, é só mandar uma mensagem — o pedido vai de novo pro admin.",
  leftAdmin: (who, id) => `👋 <b>${who}</b> saiu do bot · <code>${id}</code>`,
  adminCannotLeave: "Você é o admin (TELEGRAM_CHAT_ID), não dá pra sair. Pra trocar de admin, mude a variável e reinicie.",
  chatsList: (lines) =>
    lines.length ? ["👥 <b>Quem mais pode usar o bot</b>", "", ...lines].join("\n") : "👥 Ninguém além de você pediu pra usar o bot ainda.",
  remove: (name) => `✖ Remover ${name}`,
  block: (name) => (name ? `🚫 Bloquear ${name}` : "🚫 Bloquear"),
  unblock: (name) => `↩ Desbloquear ${name}`,
  gone: "Esse pedido não existe mais.",
  commandDescriptions: {
    status: "Como está tudo agora",
    help: "O que este bot faz",
    id: "O chat_id desta conversa",
    leave: "Parar de usar este bot",
    chats: "Quem mais pode usar o bot",
  },
};

const en: Messages = {
  statusName: {
    up: "operational",
    degraded: "degraded",
    maintenance: "under maintenance",
    down: "down",
    unknown: "no reading",
  },
  componentNotFound: (name) => `component "${name}" does not exist on this status page`,
  timeout: (ms) => `no response within ${Math.round(ms / 1000)} s`,
  bodyMissing: (text) => `response does not contain "${text}"`,
  recovered: (label, previous, d) => `${EMOJI.up} <b>${label}</b> is back — ${en.statusName[previous]} for ${d}`,
  readingBack: (label) => `${EMOJI.up} <b>${label}</b> — reading is back, operational`,
  unreadable: (label, detail) => `${EMOJI.unknown} <b>${label}</b> — could not read the status (${detail})`,
  changed: (label, status) => `${EMOJI[status]} <b>${label}</b> — ${en.statusName[status]}`,
  started: (signals, services) =>
    `🤖 statusbot is up — watching ${signals} ${signals === 1 ? "signal" : "signals"} from ${services} ${services === 1 ? "service" : "services"}.`,
  notUp: "Not normal right now:",
  duration: (ms) => duration(ms, { lt1: "less than 1 min", min: "min", h: "h", d: "d" }),
  help: (signals, services, every, admin) =>
    [
      admin
        ? "🤖 <b>statusbot</b> — I post here when a service goes down and when it comes back."
        : "🤖 <b>statusbot</b> — I watch some services and tell you how they are.",
      "",
      "/status — how everything is right now",
      "/help — this message",
      "/id — this chat's chat_id",
      admin ? "/chats — who else may use the bot" : "/leave — stop using the bot",
      "",
      `Watching ${signals} ${signals === 1 ? "signal" : "signals"} from ${services} ${services === 1 ? "service" : "services"}, reading every ${every}.`,
    ].join("\n"),
  statusSummary: (off, signals) =>
    off === 0
      ? `${EMOJI.up} <b>All normal</b> — ${signals} ${signals === 1 ? "signal" : "signals"}`
      : `⚠️ <b>${off} of ${signals} ${signals === 1 ? "signal" : "signals"} not normal</b>`,
  lasting: (d) => `for ${d}`,
  lastRead: (ago) => `Last read ${ago} ago.`,
  notReadYet: "Still doing the first reading — try again in a few seconds.",
  chatId: (id) => `🆔 This chat's chat_id is <code>${id}</code>.`,
  requested: "🔐 I asked the admin to let you use this bot. I will tell you here once there is an answer.",
  waiting: "⏳ Your request is still with the admin.",
  request: (chat, id, by) =>
    `🔔 ${by ? `<b>${by}</b> wants to use the bot in the group <b>${chat}</b>.` : `<b>${chat}</b> wants to use the bot.`}\nchat_id <code>${id}</code>`,
  approve: "✅ Approve",
  refuse: "❌ Refuse",
  approved: (who, id) => `✅ Access approved: <b>${who}</b> · <code>${id}</code>`,
  refused: (who, id) => `❌ Request refused: <b>${who}</b> · <code>${id}</code>`,
  blockedNote: (who, id) => `🚫 Blocked: <b>${who}</b> · <code>${id}</code>`,
  welcome: "✅ You are in! Send /status to see how everything is.",
  notApproved: "Your request to use this bot was not approved. To ask again, send a message.",
  removedNotice: "Your access to this bot was removed.",
  left: "👋 Done, you left. To come back, just send a message — the request goes to the admin again.",
  leftAdmin: (who, id) => `👋 <b>${who}</b> left the bot · <code>${id}</code>`,
  adminCannotLeave: "You are the admin (TELEGRAM_CHAT_ID), so you cannot leave. To change the admin, change the variable and restart.",
  chatsList: (lines) =>
    lines.length ? ["👥 <b>Who else may use the bot</b>", "", ...lines].join("\n") : "👥 Nobody else has asked to use the bot yet.",
  remove: (name) => `✖ Remove ${name}`,
  block: (name) => (name ? `🚫 Block ${name}` : "🚫 Block"),
  unblock: (name) => `↩ Unblock ${name}`,
  gone: "This request no longer exists.",
  commandDescriptions: {
    status: "How everything is right now",
    help: "What this bot does",
    id: "This chat's chat_id",
    leave: "Stop using this bot",
    chats: "Who else may use the bot",
  },
};

export const MESSAGES: Record<Language, Messages> = { pt, en };
