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
};

export const MESSAGES: Record<Language, Messages> = { pt, en };
