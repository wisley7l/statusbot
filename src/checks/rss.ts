// RSS status feeds — e.g. the AWS Health Dashboard, one feed per service and region:
// https://status.aws.amazon.com/rss/<service>-<region>.rss
// The latest item decides: resolved (by `resolvedPattern`) or no items = up; anything else = degraded.
import type { Check } from "../types.ts";

const DEFAULT_RESOLVED = "operating normally|\\[resolved\\]|resolved";

function decode(text: string): string {
  return text
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : undefined;
}

export interface FeedItem {
  title: string;
  link?: string;
  date: number;
}

export function parseItems(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body = m[1];
    const date = Date.parse(tag(body, "pubDate") ?? "");
    items.push({ title: tag(body, "title") ?? "", link: tag(body, "link"), date: Number.isNaN(date) ? 0 : date });
  }
  return items.sort((a, b) => b.date - a.date);
}

export const rss: Check = async (service, ctx) => {
  const res = await ctx.fetch(service.url, { timeoutMs: service.timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const latest = parseItems(xml)[0];
  const resolved = new RegExp(service.resolvedPattern ?? DEFAULT_RESOLVED, "i");
  const up = !latest || resolved.test(latest.title);
  return [{
    key: service.name,
    label: service.name,
    status: up ? "up" : "degraded",
    detail: up ? undefined : latest.title,
    link: up ? undefined : latest.link ?? tag(xml, "link"),
    confirmations: service.confirmations ?? 1,
  }];
};
