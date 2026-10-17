import { mkdir, readdir } from "node:fs/promises";
import type { Profile } from "@karigor/profiles";
import { run, type ExecResult } from "./exec.js";

export class WorkspaceError extends Error {
  override name = "WorkspaceError";
}

export interface ChangedFile {
  path: string;
  action: "write" | "delete";
}

export const BASELINE_TAG = "karigor-baseline";

/** The project's code: a git repository scaffolded from a target profile. */
export class Workspace {
  private constructor(readonly dir: string) {}

  private git(args: string[], timeoutMs = 60_000): Promise<ExecResult> {
    return run("git", args, { cwd: this.dir, timeoutMs, env: { GIT_AUTHOR_NAME: "karigor", GIT_AUTHOR_EMAIL: "karigor@localhost", GIT_COMMITTER_NAME: "karigor", GIT_COMMITTER_EMAIL: "karigor@localhost" } });
  }

  private async must(args: string[], what: string, timeoutMs?: number): Promise<string> {
    const r = await this.git(args, timeoutMs);
    if (r.code !== 0) throw new WorkspaceError(`${what}: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout;
  }

  /** Scaffold, install, and commit the baseline. The directory must be empty or absent. */
  static async create(dir: string, profile: Profile, opts: { skipInstall?: boolean; log?: (line: string) => void; installTimeoutMs?: number } = {}): Promise<Workspace> {
    await mkdir(dir, { recursive: true });
    if ((await readdir(dir)).length > 0) throw new WorkspaceError(`workspace ${dir} is not empty`);
    await profile.scaffold(dir);
    const ws = new Workspace(dir);
    await ws.must(["init", "-q", "-b", "main"], "git init");
    if (profile.commands.install && !opts.skipInstall) {
      opts.log?.(`installing dependencies (${profile.commands.install.join(" ")})`);
      const [cmd, ...args] = profile.commands.install;
      const r = await run(cmd!, args, { cwd: dir, timeoutMs: opts.installTimeoutMs ?? 15 * 60 * 1000 });
      if (r.code !== 0) throw new WorkspaceError(`install failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(-2000)}`);
    }
    await ws.commitAll(`karigor: scaffold ${profile.name}`, true);
    await ws.must(["tag", BASELINE_TAG], "tag baseline");
    return ws;
  }

  static async open(dir: string): Promise<Workspace> {
    const ws = new Workspace(dir);
    const r = await ws.git(["rev-parse", "--is-inside-work-tree"]);
    if (r.code !== 0) throw new WorkspaceError(`no workspace at ${dir}`);
    return ws;
  }

  async head(): Promise<string> {
    return (await this.must(["rev-parse", "HEAD"], "rev-parse")).trim();
  }

  async baseline(): Promise<string> {
    return (await this.must(["rev-parse", `${BASELINE_TAG}^{commit}`], "baseline")).trim();
  }

  async isClean(): Promise<boolean> {
    return (await this.must(["status", "--porcelain"], "status")).trim() === "";
  }

  /** Stage everything and commit. Returns the new sha, or undefined when nothing changed. */
  async commitAll(message: string, allowEmpty = false): Promise<string | undefined> {
    await this.must(["add", "-A"], "git add");
    if (!allowEmpty && (await this.isClean())) return undefined;
    await this.must(["commit", "-q", "--no-verify", ...(allowEmpty ? ["--allow-empty"] : []), "-m", message], "git commit");
    return this.head();
  }

  /** Throw away uncommitted work, including new files, but keep ignored ones (node_modules). */
  async reset(): Promise<void> {
    await this.must(["checkout", "--", "."], "checkout");
    await this.must(["clean", "-fdq"], "clean");
  }

  /** Commits for an item, oldest first, found by the `karigor(<itemId>):` message prefix. */
  async itemCommits(itemId: string): Promise<string[]> {
    const out = await this.must(["log", "--reverse", "--format=%H", "--fixed-strings", `--grep=karigor(${itemId}):`], "git log");
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  /** Undo an item's commits with revert commits, so the history stays append-only. */
  async revertItem(itemId: string, reason: string): Promise<string | undefined> {
    const shas = await this.itemCommits(itemId);
    const real = [];
    for (const sha of shas) {
      const msg = (await this.must(["log", "-1", "--format=%s", sha], "log")).trim();
      if (!msg.startsWith(`karigor(${itemId}): reverted`)) real.push(sha);
    }
    if (real.length === 0) return undefined;
    const r = await this.git(["revert", "--no-edit", "--no-commit", ...real.reverse()]);
    if (r.code !== 0) {
      await this.git(["revert", "--abort"]);
      await this.reset();
      throw new WorkspaceError(`could not revert ${itemId}: ${(r.stderr || r.stdout).trim()}`);
    }
    return this.commitAll(`karigor(${itemId}): reverted (${reason})`, true);
  }

  async changedFiles(from: string, to = "HEAD"): Promise<ChangedFile[]> {
    const out = await this.must(["diff", "--name-status", `${from}..${to}`], "git diff");
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split("\t");
        const path = rest[rest.length - 1] ?? "";
        return { path, action: status?.startsWith("D") ? ("delete" as const) : ("write" as const) };
      });
  }

  async diff(from: string, to = "HEAD"): Promise<string> {
    return this.must(["diff", "--no-color", `${from}..${to}`], "git diff", 120_000);
  }

  /** The patches of specific commits, concatenated, each headed by its subject. */
  async showCommits(shas: string[]): Promise<string> {
    const parts: string[] = [];
    for (const sha of shas) parts.push(await this.must(["show", "--no-color", "--format=## %h %s", sha], "git show", 120_000));
    return parts.join("\n");
  }

  /** Paths git tracks plus untracked files that are not ignored. */
  async files(): Promise<string[]> {
    const out = await this.must(["ls-files", "--cached", "--others", "--exclude-standard"], "ls-files");
    return out.split("\n").filter(Boolean);
  }
}
