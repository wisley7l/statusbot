// To add a check type: write src/checks/<type>.ts exporting a `Check`, and register it here.
import type { Check } from "../types.ts";
import { http } from "./http.ts";
import { rss } from "./rss.ts";
import { statuspage } from "./statuspage.ts";

export const CHECKS: Record<string, Check> = { statuspage, rss, http };
