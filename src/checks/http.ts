// Your own endpoint: down when it does not answer, answers outside `expectStatus`
// (any 2xx by default), or the body lacks `contains`.
import type { Check } from "../types.ts";

export const http: Check = async (service, ctx) => {
  const timeoutMs = service.timeoutMs ?? 10_000;
  const base = { key: service.name, label: service.name, confirmations: service.confirmations ?? 2 };
  let res: Response;
  try {
    res = await ctx.fetch(service.url, { headers: service.headers, timeoutMs });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return [{ ...base, status: "down", detail: timedOut ? ctx.t.timeout(timeoutMs) : String((err as Error).message ?? err) }];
  }
  const okStatus = service.expectStatus ? service.expectStatus.includes(res.status) : res.status >= 200 && res.status < 300;
  if (!okStatus) {
    await res.body?.cancel();
    return [{ ...base, status: "down", detail: `HTTP ${res.status}` }];
  }
  if (service.contains) {
    const body = await res.text();
    if (!body.includes(service.contains)) {
      return [{ ...base, status: "down", detail: ctx.t.bodyMissing(service.contains) }];
    }
  } else {
    await res.body?.cancel();
  }
  return [{ ...base, status: "up" }];
};
