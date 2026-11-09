export type Status = "up" | "degraded" | "maintenance" | "down" | "unknown";

export type Language = "pt" | "en";

/** One thing being watched: a status page component, a whole page, a feed or an endpoint. */
export interface Signal {
  key: string;
  label: string;
  status: Status;
  detail?: string;
  link?: string;
  /** How many consecutive readings of a new status are needed before alerting. */
  confirmations: number;
}

export interface ServiceConfig {
  name: string;
  type: string;
  url: string;
  enabled?: boolean;
  /** statuspage: component names to watch. Empty or missing = the page's overall indicator. */
  components?: string[];
  /** http: accepted status codes. Missing = any 2xx. */
  expectStatus?: number[];
  /** http: text the body must contain. */
  contains?: string;
  /** http: extra request headers. */
  headers?: Record<string, string>;
  /** rss: regex (case-insensitive) that marks the latest item as resolved. */
  resolvedPattern?: string;
  timeoutMs?: number;
  confirmations?: number;
}

export interface Config {
  intervalSeconds: number;
  language: Language;
  notifyOnStart: boolean;
  services: ServiceConfig[];
}

export interface Messages {
  statusName: Record<Status, string>;
  componentNotFound: (name: string) => string;
  timeout: (ms: number) => string;
  bodyMissing: (text: string) => string;
  recovered: (label: string, previous: Status, duration: string) => string;
  readingBack: (label: string) => string;
  unreadable: (label: string, detail: string) => string;
  changed: (label: string, status: Status) => string;
  started: (signals: number, services: number) => string;
  notUp: string;
  duration: (ms: number) => string;
  /** Chat commands (/help, /status). The admin's help lists /chats instead of /leave. */
  help: (signals: number, services: number, every: string, admin: boolean) => string;
  statusSummary: (notUp: number, signals: number) => string;
  /** How long a signal has been in its status: "há 12 min" / "for 12 min". */
  lasting: (duration: string) => string;
  lastRead: (ago: string) => string;
  notReadYet: string;
  chatId: (id: string) => string;
  /** Access requests. Names come HTML-escaped, except in button labels. */
  requested: string;
  waiting: string;
  /** To the admin. `by` = who asked, when the request comes from a group. */
  request: (chat: string, id: string, by: string) => string;
  approve: string;
  refuse: string;
  approved: (who: string, id: string) => string;
  refused: (who: string, id: string) => string;
  blockedNote: (who: string, id: string) => string;
  welcome: string;
  notApproved: string;
  removedNotice: string;
  left: string;
  leftAdmin: (who: string, id: string) => string;
  adminCannotLeave: string;
  chatsList: (lines: string[]) => string;
  remove: (name: string) => string;
  /** Without a name: the button on a request. */
  block: (name?: string) => string;
  unblock: (name: string) => string;
  gone: string;
  commandDescriptions: { status: string; help: string; id: string; leave: string; chats: string };
}

export interface CheckContext {
  fetch: (url: string, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>;
  t: Messages;
}

export type Check = (service: ServiceConfig, ctx: CheckContext) => Promise<Signal[]>;
