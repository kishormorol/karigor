import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult, JourneyRun, Sandbox, ScanResult, SecurityFinding, TestRun, UrlCheck } from "@karigor/gates";
import type { Profile } from "@karigor/profiles";
import { clip, run } from "./exec.js";
import { scanSecrets } from "./secrets.js";
import type { Workspace } from "./workspace.js";

export interface LocalSandboxOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Largest diff handed to reviewers, in characters. */
  maxDiffChars?: number;
  /** The deploy target, when one is configured: it verifies rollbacks and may check URLs its own way. */
  deploy?: {
    verifyRollback(): Promise<CommandResult>;
    checkUrl?(url: string): Promise<UrlCheck>;
  };
}

/** Runs the profile's real commands in the workspace. */
export class LocalSandbox implements Sandbox {
  constructor(
    readonly workspace: Workspace,
    readonly profile: Profile,
    private readonly opts: LocalSandboxOptions = {},
  ) {}

  private async cmd(argv: string[] | undefined, what: string, env?: NodeJS.ProcessEnv): Promise<CommandResult & { stdout: string; stderr: string; code: number | null }> {
    if (!argv || argv.length === 0) return { ok: true, output: `no ${what} command for the ${this.profile.name} profile`, stdout: "", stderr: "", code: 0 };
    const [c, ...args] = argv;
    const r = await run(c!, args, { cwd: this.workspace.dir, timeoutMs: this.opts.timeoutMs ?? 10 * 60 * 1000, ...(env ? { env } : {}) });
    return { ok: r.code === 0, output: clip(`$ ${argv.join(" ")}\n${r.stdout}${r.stderr ? `\n${r.stderr}` : ""}`), ...r };
  }

  async runTests(_itemId?: string): Promise<TestRun> {
    const r = await this.cmd(this.profile.commands.test, "test");
    const counts = this.profile.parseTests(r.stdout, r.stderr, r.code);
    return { suite: this.profile.name, ...counts, output: r.output };
  }

  async lint(): Promise<CommandResult> {
    const r = await this.cmd(this.profile.commands.lint, "lint");
    return { ok: r.ok, output: r.output };
  }

  /**
   * The build runs against brand-new local databases (each `file:` setting the profile defaults),
   * as a real release does: migrations must work from empty, not just on the developer's copy,
   * which can hold tables from work that was later reverted.
   */
  async build(): Promise<CommandResult> {
    const env: NodeJS.ProcessEnv = {};
    const fresh = await mkdtemp(join(tmpdir(), "karigor-build-db-"));
    for (const [k, v] of Object.entries(this.profile.localSettings ?? {})) if (v.startsWith("file:")) env[k] = `file:${join(fresh, `${k.toLowerCase()}.db`)}`;
    try {
      const r = await this.cmd(this.profile.commands.build, "build", env);
      return { ok: r.ok, output: Object.keys(env).length ? `(on a fresh, empty database)\n${r.output}` : r.output };
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  }

  /**
   * Browser journeys, the way a person meets the app: built on a brand-new database, started for real,
   * and driven in a browser. The browser is installed here (once per computer), outside the developer's sandbox.
   */
  async journeys(): Promise<JourneyRun> {
    const c = this.profile.commands;
    const has = c.e2e?.length ? await (this.profile.hasJourneys?.(this.workspace.dir) ?? Promise.resolve(true)) : false;
    if (!c.e2e?.length || !this.profile.parseJourneys) return { available: false, passed: 0, failed: 0, failures: [], output: `no browser journeys for the ${this.profile.name} profile` };
    if (!has) return { available: false, passed: 0, failed: 0, failures: [], output: "this app was made from a template without browser journeys; nothing to run" };
    const out: string[] = [];
    if (c.e2eInstall?.length) {
      const i = await this.cmd(c.e2eInstall, "browser install");
      if (!i.ok) return { available: true, passed: 0, failed: 1, failures: ["the browser for the journeys could not be installed on this computer"], output: i.output };
    }
    const fresh = await mkdtemp(join(tmpdir(), "karigor-e2e-"));
    const env: NodeJS.ProcessEnv = { PLAYWRIGHT_JSON_OUTPUT_NAME: join(fresh, "report.json"), CI: "1" };
    for (const [k, v] of Object.entries(this.profile.localSettings ?? {})) if (v.startsWith("file:")) env[k] = `file:${join(fresh, `${k.toLowerCase()}.db`)}`;
    try {
      const b = await this.cmd(this.profile.commands.build, "build", env);
      if (!b.ok) return { available: true, passed: 0, failed: 1, failures: ["the app did not build, so no journey could run"], output: b.output };
      out.push("built on a fresh, empty database");
      const r = await this.cmd(c.e2e, "journeys", env);
      const report = await readFile(join(fresh, "report.json"), "utf8").catch(() => "");
      const counts = this.profile.parseJourneys(report);
      if (!report && !r.ok) counts.failures.push("the journeys did not run; see the output");
      return { available: true, ...counts, failed: Math.max(counts.failed, r.ok ? 0 : 1), output: clip([...out, r.output].join("\n"), 12_000) };
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  }

  async securityScan(): Promise<ScanResult> {
    const findings: SecurityFinding[] = [];
    const notes: string[] = [];
    if (this.profile.commands.audit) {
      const r = await this.cmd(this.profile.commands.audit, "audit");
      findings.push(...parseAudit(r.stdout));
      notes.push(findings.length ? `${findings.length} vulnerable dependenc${findings.length === 1 ? "y" : "ies"} at high or critical severity` : "dependency audit: no high or critical vulnerabilities");
    } else {
      notes.push("no audit command for this profile");
    }
    const secrets = await scanSecrets(this.workspace.dir, await this.workspace.files());
    findings.push(...secrets);
    notes.push(secrets.length ? `${secrets.length} secret-shaped string(s) or env file(s) found` : "secrets scan: clean");
    return { findings, output: notes.join("\n") };
  }

  async checkUrl(url: string): Promise<UrlCheck> {
    if (this.opts.deploy?.checkUrl) return this.opts.deploy.checkUrl(url);
    return checkUrl(url, this.opts.fetchImpl);
  }

  async verifyRollback(): Promise<CommandResult> {
    if (this.opts.deploy) return this.opts.deploy.verifyRollback();
    return { ok: false, output: "no deploy target is configured, so a rollback cannot be verified" };
  }

  /** An item's own commits only; without an item, everything since the baseline. */
  async diff(itemId?: string): Promise<string> {
    const d = itemId ? await this.workspace.showCommits(await this.workspace.itemCommits(itemId)) : await this.workspace.diff(await this.workspace.baseline());
    return clip(d, this.opts.maxDiffChars ?? 200_000);
  }
}

/** A plain GET with a timeout; any status below 400 is healthy. */
export async function checkUrl(url: string, fetchImpl?: typeof fetch, timeoutMs = 15_000): Promise<UrlCheck> {
  const f = fetchImpl ?? fetch;
  try {
    const res = await f(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.text()).slice(0, 300);
    return { ok: res.status < 400, status: res.status, output: `${res.status} ${res.statusText}\n${body}` };
  } catch (e) {
    return { ok: false, status: 0, output: `request failed: ${(e as Error).message}` };
  }
}

/** pnpm/npm audit JSON: either `advisories` (classic) or `vulnerabilities` (npm 7+). High and critical only. */
export function parseAudit(stdout: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  // pnpm prints the report as indented JSON over many lines, sometimes after other output.
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) return out;
  const line = stdout.slice(start, end + 1);
  let j: { advisories?: Record<string, { severity?: string; title?: string; module_name?: string }>; vulnerabilities?: Record<string, { severity?: string; name?: string; via?: unknown[] }> };
  try {
    j = JSON.parse(line);
  } catch {
    return out;
  }
  for (const a of Object.values(j.advisories ?? {})) {
    if (a.severity === "high" || a.severity === "critical") out.push({ severity: a.severity, title: `${a.module_name ?? "dependency"}: ${a.title ?? "vulnerability"}`, location: "package.json" });
  }
  for (const v of Object.values(j.vulnerabilities ?? {})) {
    if (v.severity === "high" || v.severity === "critical") out.push({ severity: v.severity, title: `${v.name ?? "dependency"}: vulnerable version`, location: "package.json" });
  }
  return out;
}
