import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { State } from "./engine.ts";

export async function loadState(path: string): Promise<State | undefined> {
  try {
    const s = JSON.parse(await readFile(path, "utf8")) as State;
    return { signals: s.signals ?? {}, outbox: s.outbox ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    console.warn(`warning: ignoring unreadable state at ${path}: ${(err as Error).message}`);
    return undefined;
  }
}

export const saveState = (path: string, state: State): Promise<void> => writeJson(path, state);

/** Who may use the bot besides the admin (TELEGRAM_CHAT_ID). Not in the list = never asked, or left. */
export type Access = "pending" | "allowed" | "blocked";
export interface ChatEntry {
  access: Access;
  name: string;
  /** When they first asked. */
  since: number;
}
export type Chats = Record<string, ChatEntry>;

export async function loadChats(path: string): Promise<Chats> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Chats;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.warn(`warning: ignoring unreadable chats at ${path}: ${(err as Error).message}`);
    return {};
  }
}

export const saveChats = (path: string, chats: Chats): Promise<void> => writeJson(path, chats);

/** Write to a per-process temp file and rename: a crash mid-write never leaves a broken file. */
async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);
}
