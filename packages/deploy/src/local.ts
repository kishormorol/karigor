import { appendFile, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandResult } from "@karigor/gates";
import { readSettings, requiredSettings, type Profile } from "@karigor/profiles";
import { Workspace, clip, run } from "@karigor/sandbox";
import { freePort, startServer, type RunningServer } from "./server.js";
import type { DeployAdapter, DeployRequest, DeployResult, LiveRelease } from "./types.js";

export interface LocalDeployOptions {
  /** The project directory; releases live in `<projectDir>/releases`. */
  projectDir: string;
  profile: Profile;
  /** Port `karigor serve` uses for production. */
  productionPort?: number;
  /** Skip the profile's install step (tests with the fixture). */
  skipInstall?: boolean;
  healthTimeoutMs?: number;
  /** Releases kept on disk besides the live one and its predecessor. */
  keep?: number;
  log?: (line: string) => void;
}

/** What `releases/current.json` holds: the live version and the ones before it, newest first. */
export interface CurrentPointer {
  version: string;
  history: string[];
}

const READY = ".karigor-release.json";

/**
 * The zero-dollar target: releases are built into `<project>/releases/<version>` and served from
 * this machine. A preview runs on a free port; production is whatever `current.json` points at,
 * served by `karigor serve`.
 */
export class LocalDeploy implements DeployAdapter {
  readonly name = "local";
  private readonly previews = new Map<string, RunningServer>();
  private readonly promoteListeners: ((current: CurrentPointer | undefined) => void)[] = [];

  constructor(private readonly o: LocalDeployOptions) {}

  get releasesDir(): string {
    return join(this.o.projectDir, "releases");
  }

  get productionUrl(): string {
    return `http://localhost:${this.o.productionPort ?? 3000}`;
  }

  describe(): string {
    return `this computer: run "karigor serve" and open ${this.productionUrl}`;
  }

  /** Called after production changes (promotion or rollback), so a running `serve` can switch. */
  onChange(f: (current: CurrentPointer | undefined) => void): void {
    this.promoteListeners.push(f);
  }

  releaseDir(version: string): string {
    return join(this.releasesDir, version);
  }

  async current(): Promise<CurrentPointer | undefined> {
    try {
      return JSON.parse(await readFile(join(this.releasesDir, "current.json"), "utf8")) as CurrentPointer;
    } catch {
      return undefined;
    }
  }

  private async setCurrent(p: CurrentPointer | undefined): Promise<void> {
    const f = join(this.releasesDir, "current.json");
    if (p) await writeFile(f, JSON.stringify(p, null, 2) + "\n", "utf8");
    else await rm(f, { force: true });
    for (const l of this.promoteListeners) l(p);
  }

  private async ready(version: string): Promise<boolean> {
    return stat(join(this.releaseDir(version), READY)).then(() => true, () => false);
  }

  /** Export, install and build a commit into its release directory. Reuses a finished one. */
  async prepare(r: DeployRequest): Promise<{ ok: boolean; output: string }> {
    await this.ignoreReleasesInProjectGit();
    const dir = this.releaseDir(r.version);
    if (await this.ready(r.version)) return { ok: true, output: `release ${r.version} was already built` };
    await rm(dir, { recursive: true, force: true });
    const ws = await Workspace.open(r.dir);
    await ws.exportTo(r.commit, dir);
    const out: string[] = [`exported ${r.commit.slice(0, 7)} to releases/${r.version}`];
    const steps: [string, string[] | undefined][] = [
      ["install", this.o.skipInstall ? undefined : this.o.profile.commands.install],
      ["build", this.o.profile.commands.build],
    ];
    for (const [what, argv] of steps) {
      if (!argv?.length) continue;
      this.o.log?.(`  ${what} for release ${r.version}`);
      const [c, ...args] = argv;
      const res = await run(c!, args, { cwd: dir, timeoutMs: 15 * 60 * 1000 });
      out.push(clip(`$ ${argv.join(" ")}\n${res.stdout}${res.stderr ? `\n${res.stderr}` : ""}`, 6_000));
      if (res.code !== 0) return { ok: false, output: out.join("\n") };
    }
    await writeFile(join(dir, READY), JSON.stringify({ version: r.version, commit: r.commit }) + "\n", "utf8");
    return { ok: true, output: out.join("\n") };
  }

  /** Start a built release on `port` and wait for its health check. */
  async start(version: string, port: number): Promise<{ server: RunningServer; ok: boolean; output: string }> {
    const argv = this.o.profile.commands.start;
    if (!argv?.length) throw new Error(`the ${this.o.profile.name} profile has no start command, so it cannot be served`);
    const server = startServer(argv, this.releaseDir(version), port);
    const h = await server.waitHealthy(this.o.profile.healthPath ?? "/", this.o.healthTimeoutMs ?? 90_000);
    if (!h.ok) await server.stop();
    return { server, ok: h.ok, output: h.output };
  }

  async preview(r: DeployRequest): Promise<DeployResult> {
    const prepared = await this.prepare(r);
    if (!prepared.ok) return { ok: false, id: r.version, output: `the release could not be built\n${prepared.output}` };
    await this.previews.get(r.version)?.stop();
    const port = await freePort();
    const s = await this.start(r.version, port);
    if (!s.ok) return { ok: false, id: r.version, output: `${prepared.output}\nthe preview did not become healthy:\n${s.output}` };
    this.previews.set(r.version, s.server);
    return { ok: true, url: s.server.url, id: r.version, output: `${prepared.output}\npreview running at ${s.server.url}; ${s.output}` };
  }

  async ensure(r: { url: string; id: string }): Promise<void> {
    if (this.previews.get(r.id)?.alive) return;
    if (!(await this.ready(r.id))) return;
    const port = Number(new URL(r.url).port);
    const s = await this.start(r.id, port).catch(() => undefined);
    if (s?.ok) this.previews.set(r.id, s.server);
  }

  async promote(r: DeployRequest & { preview: DeployResult }): Promise<DeployResult> {
    if (!(await this.ready(r.version))) return { ok: false, id: r.version, output: `release ${r.version} is not built` };
    // The preview of this exact build already passed its health check; check once more that it still answers.
    const running = this.previews.get(r.version);
    if (running?.alive) {
      const h = await running.waitHealthy(this.o.profile.healthPath ?? "/", 10_000);
      if (!h.ok) return { ok: false, id: r.version, output: `the release stopped answering before it went live:\n${h.output}` };
    } else {
      const s = await this.start(r.version, await freePort());
      await s.server.stop();
      if (!s.ok) return { ok: false, id: r.version, output: `the release did not start:\n${s.output}` };
    }
    const prev = await this.current();
    const history = prev ? [prev.version, ...prev.history.filter((v) => v !== r.version)] : [];
    if (prev?.version !== r.version) await this.setCurrent({ version: r.version, history });
    await this.prune();
    return { ok: true, url: this.productionUrl, id: r.version, output: `${r.version} is now the live release; ${this.describe()}` };
  }

  async rollback(_r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    const cur = await this.current();
    if (!cur) return { ok: true, output: "nothing was live" };
    const [back, ...rest] = cur.history;
    if (!back) {
      await this.setCurrent(undefined);
      return { ok: true, output: `${cur.version} was the first release; it is offline now` };
    }
    await this.setCurrent({ version: back, history: rest });
    return { ok: true, output: `went back from ${cur.version} to ${back}` };
  }

  async verifyRollback(_r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    const cur = await this.current();
    if (!cur) return { ok: true, output: "first release: rolling back means taking it offline, which always works" };
    if (!(await this.ready(cur.version))) return { ok: false, output: `the live release ${cur.version} is missing from releases/, so there is nothing to go back to` };
    const s = await this.start(cur.version, await freePort());
    await s.server.stop();
    return s.ok ? { ok: true, output: `the live release ${cur.version} starts and answers its health check, so going back to it works` } : { ok: false, output: `the live release ${cur.version} no longer starts:\n${s.output}` };
  }

  /** On this computer a local database file is fine; settings with no default must be in the environment. */
  async missingSettings(dir: string): Promise<{ name: string; note: string }[]> {
    return requiredSettings(await readSettings(dir), false).filter((s) => !process.env[s.name]).map((s) => ({ name: s.name, note: s.note }));
  }

  /** Delete old releases, keeping the live one, its predecessors in history, and the newest few. */
  async prune(): Promise<void> {
    const cur = await this.current();
    const keepSet = new Set([cur?.version, ...(cur?.history.slice(0, 1) ?? [])].filter(Boolean) as string[]);
    for (const v of this.previews.keys()) keepSet.add(v);
    const names = (await readdir(this.releasesDir).catch(() => [] as string[])).filter((n) => /^r\d+-/.test(n));
    const byAge = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(this.releasesDir, n))).mtimeMs })));
    byAge.sort((a, b) => b.t - a.t);
    for (const { n } of byAge.slice(this.o.keep ?? 3)) if (!keepSet.has(n)) await rm(join(this.releasesDir, n), { recursive: true, force: true });
  }

  async stop(): Promise<void> {
    await Promise.all([...this.previews.values()].map((s) => s.stop()));
    this.previews.clear();
  }

  /** The project directory is itself a git repository; built releases do not belong in it. */
  private async ignoreReleasesInProjectGit(): Promise<void> {
    const f = join(this.o.projectDir, ".gitignore");
    const text = await readFile(f, "utf8").catch(() => "");
    const missing = ["releases/", "run/"].filter((l) => !text.split("\n").includes(l));
    if (missing.length) await appendFile(f, (text && !text.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n", "utf8");
  }
}
