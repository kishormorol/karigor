import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Only one process changes a project's event log at a time: a run holds `run.lock` (its pid)
 * while it works. A lock whose process is gone is stale and is taken over.
 */
const lockPath = (dir: string) => join(dir, "run.lock");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The pid of the live process working on this project, if any. */
export async function runningPid(dir: string): Promise<number | undefined> {
  const pid = Number((await readFile(lockPath(dir), "utf8").catch(() => "")).trim());
  return pid && pid !== process.pid && alive(pid) ? pid : undefined;
}

export class ProjectBusyError extends Error {
  override name = "ProjectBusyError";
}

/** How many times this process holds each project (a fix round runs a project inside an operation). */
const held = new Map<string, number>();

/** Take the project for this process (re-entrant). Throws when another live process has it. */
export async function acquireRunLock(dir: string): Promise<() => Promise<void>> {
  const count = held.get(dir) ?? 0;
  if (count === 0) {
    const other = await runningPid(dir);
    if (other) throw new ProjectBusyError(`Karigor is already working on this project (process ${other}); try again when it finishes`);
    await ignoreInProjectGit(dir);
    await writeFile(lockPath(dir), `${process.pid}\n`, "utf8");
  }
  held.set(dir, count + 1);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const left = (held.get(dir) ?? 1) - 1;
    if (left > 0) {
      held.set(dir, left);
      return;
    }
    held.delete(dir);
    const pid = Number((await readFile(lockPath(dir), "utf8").catch(() => "")).trim());
    if (pid === process.pid) await rm(lockPath(dir), { force: true });
  };
}

/** The lock and the inbox are working files, not history. */
async function ignoreInProjectGit(dir: string): Promise<void> {
  const f = join(dir, ".gitignore");
  const text = await readFile(f, "utf8").catch(() => "");
  const missing = ["run.lock", "inbox/"].filter((l) => !text.split("\n").includes(l));
  if (missing.length) await writeFile(f, text + (text && !text.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n", "utf8");
}

/** Refuse a change while a run is working on the project. */
export async function assertIdle(dir: string, what: string): Promise<void> {
  if (await runningPid(dir)) throw new ProjectBusyError(`Karigor is working on this project right now, so ${what} has to wait; try again when this round finishes`);
}

/** Messages left while a run was busy; read and removed by the next one to look. */
export async function queueInbox(dir: string, item: unknown): Promise<void> {
  await ignoreInProjectGit(dir);
  await mkdir(join(dir, "inbox"), { recursive: true });
  await writeFile(join(dir, "inbox", `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify(item), "utf8");
}

export async function drainInbox<T>(dir: string): Promise<T[]> {
  const files = (await readdir(join(dir, "inbox")).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  const out: T[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(join(dir, "inbox", f), "utf8")) as T);
    } catch {
      /* a half-written file is left for the next look */
      continue;
    }
    await rm(join(dir, "inbox", f), { force: true });
  }
  return out;
}
