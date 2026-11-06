// Atlassian Statuspage — the format behind cloudflarestatus.com, planetscalestatus.com,
// shopifystatus.com, status.claude.com and many others: <page>/api/v2/summary.json.
import type { Check, Signal, Status } from "../types.ts";

interface Component {
  id: string;
  name: string;
  status: string;
  group?: boolean;
}

interface Incident {
  name: string;
  shortlink?: string;
  components?: { id: string }[];
}

interface Summary {
  status: { indicator: string; description: string };
  // Some pages (planetscalestatus.com) omit these keys instead of sending [].
  components?: Component[];
  incidents?: Incident[];
}

const COMPONENT: Record<string, Status> = {
  operational: "up",
  degraded_performance: "degraded",
  partial_outage: "degraded",
  major_outage: "down",
  under_maintenance: "maintenance",
};

const INDICATOR: Record<string, Status> = {
  none: "up",
  minor: "degraded",
  major: "down",
  critical: "down",
  maintenance: "maintenance",
};

const RANK: Status[] = ["up", "maintenance", "degraded", "down"];
const worst = (a: Status, b: Status): Status => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);

export const statuspage: Check = async (service, ctx) => {
  const base = service.url.replace(/\/+$/, "");
  const res = await ctx.fetch(`${base}/api/v2/summary.json`, { timeoutMs: service.timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as Summary;
  const incidents = data.incidents ?? [];
  const confirmations = service.confirmations ?? 1;
  const wanted = service.components ?? [];
  let components = data.components ?? [];
  if (wanted.length > 0 && !data.components) {
    const more = await ctx.fetch(`${base}/api/v2/components.json`, { timeoutMs: service.timeoutMs });
    if (!more.ok) throw new Error(`HTTP ${more.status}`);
    components = ((await more.json()) as { components?: Component[] }).components ?? [];
  }

  if (wanted.length === 0) {
    const status = INDICATOR[data.status.indicator] ?? "degraded";
    const incident = incidents[0];
    return [{
      key: service.name,
      label: service.name,
      status,
      detail: incident?.name ?? (status === "up" ? undefined : data.status.description),
      link: incident?.shortlink,
      confirmations,
    }];
  }

  return wanted.map((name): Signal => {
    const label = `${service.name} · ${name}`;
    // Pages can repeat a name across sections (e.g. the same region for two products):
    // every match counts, and the worst one wins.
    const matches = components.filter((c) => !c.group && c.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (matches.length === 0) {
      return { key: label, label, status: "unknown", detail: ctx.t.componentNotFound(name), confirmations: 1 };
    }
    const status = matches.map((c) => COMPONENT[c.status] ?? "degraded").reduce(worst, "up");
    const ids = new Set(matches.map((c) => c.id));
    const incident =
      incidents.find((i) => i.components?.some((c) => ids.has(c.id))) ??
      (status === "up" ? undefined : incidents[0]);
    return { key: label, label, status, detail: incident?.name, link: incident?.shortlink, confirmations };
  });
};

/** Component names of a page, grouped — for the `components` command. */
export async function listComponents(url: string, fetchFn: typeof fetch): Promise<string[]> {
  const res = await fetchFn(`${url.replace(/\/+$/, "")}/api/v2/components.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { components } = (await res.json()) as { components: (Component & { group_id?: string | null })[] };
  const groups = new Map(components.filter((c) => c.group).map((c) => [c.id, c.name]));
  return [...new Set(
    components
      .filter((c) => !c.group)
      .map((c) => (c.group_id && groups.has(c.group_id) ? `${c.name}   (${groups.get(c.group_id)})` : c.name)),
  )];
}
