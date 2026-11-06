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

/** Write to a per-process temp file and rename: a crash mid-write never leaves a broken state. */
export async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, path);
}
