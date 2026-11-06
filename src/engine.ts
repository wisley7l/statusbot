// Pure core: previous state + new readings → new state + alerts. No I/O, so it is what the tests hit.
import type { Messages, Signal, Status } from "./types.ts";

export interface Entry {
  label: string;
  status: Status;
  since: number;
  detail?: string;
  link?: string;
  pending?: { status: Status; count: number };
}

export interface State {
  signals: Record<string, Entry>;
  /** Messages that failed to send — retried on the next cycle, so an alert is never lost. */
  outbox: string[];
}

export interface Change {
  key: string;
  label: string;
  from: Status;
  to: Status;
  /** How long it stayed in `from`. */
  lasted: number;
  detail?: string;
  link?: string;
}

/** A failing read needs more confirmations than a real status change: one blip is not news. */
const UNKNOWN_CONFIRMATIONS = 3;

export function step(prev: State, signals: Signal[], now: number): { state: State; changes: Change[] } {
  const next: Record<string, Entry> = {};
  const changes: Change[] = [];

  for (const s of signals) {
    const old = prev.signals[s.key];
    if (!old) {
      next[s.key] = { label: s.label, status: s.status, since: now, detail: s.detail, link: s.link };
      continue;
    }
    if (s.status === old.status) {
      next[s.key] = { ...old, label: s.label, detail: s.detail ?? old.detail, link: s.link ?? old.link, pending: undefined };
      continue;
    }
    const needed = s.status === "unknown" ? Math.max(s.confirmations, UNKNOWN_CONFIRMATIONS) : s.confirmations;
    const count = old.pending?.status === s.status ? old.pending.count + 1 : 1;
    if (count < needed) {
      next[s.key] = { ...old, pending: { status: s.status, count } };
      continue;
    }
    changes.push({ key: s.key, label: s.label, from: old.status, to: s.status, lasted: now - old.since, detail: s.detail, link: s.link });
    next[s.key] = { label: s.label, status: s.status, since: now, detail: s.detail, link: s.link };
  }

  return { state: { signals: next, outbox: prev.outbox }, changes };
}

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function message(c: Change, t: Messages): string {
  const label = escapeHtml(c.label);
  if (c.to === "up") {
    return c.from === "unknown" ? t.readingBack(label) : t.recovered(label, c.from, t.duration(c.lasted));
  }
  const head = c.to === "unknown" ? t.unreadable(label, escapeHtml(c.detail ?? "?")) : t.changed(label, c.to);
  const lines = [head];
  if (c.to !== "unknown" && c.detail) lines.push(escapeHtml(c.detail));
  if (c.link) lines.push(escapeHtml(c.link));
  return lines.join("\n");
}

export function startMessage(state: State, services: number, t: Messages): string {
  const entries = Object.values(state.signals);
  const lines = [t.started(entries.length, services)];
  const off = entries.filter((e) => e.status !== "up");
  if (off.length) {
    lines.push("", t.notUp);
    for (const e of off) lines.push(`• ${escapeHtml(e.label)} — ${t.statusName[e.status]}${e.detail ? ` (${escapeHtml(e.detail)})` : ""}`);
  }
  return lines.join("\n");
}
