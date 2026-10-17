import type { CommandResult, Sandbox, ScanResult, SecurityFinding, TestRun, UrlCheck } from "@karigor/gates";
import type { Profile } from "@karigor/profiles";
import { clip, run } from "./exec.js";
import { scanSecrets } from "./secrets.js";
import type { Workspace } from "./workspace.js";

export interface LocalSandboxOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Largest diff handed to reviewers, in characters. */
  maxDiffChars?: number;
}

/** Runs the profile's real commands in the workspace. */
export class LocalSandbox implements Sandbox {
  constructor(
    readonly workspace: Workspace,
    readonly profile: Profile,
    private readonly opts: LocalSandboxOptions = {},
  ) {}

  private async cmd(argv: string[] | undefined, what: string): Promise<CommandResult & { stdout: string; stderr: string; code: number | null }> {
    if (!argv || argv.length === 0) return { ok: true, output: `no ${what} command for the ${this.profile.name} profile`, stdout: "", stderr: "", code: 0 };
    const [c, ...args] = argv;
    const r = await run(c!, args, { cwd: this.workspace.dir, timeoutMs: this.opts.timeoutMs ?? 10 * 60 * 1000 });
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

  async build(): Promise<CommandResult> {
    const r = await this.cmd(this.profile.commands.build, "build");
    return { ok: r.ok, output: r.output };
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
    const f = this.opts.fetchImpl ?? fetch;
    try {
      const res = await f(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000) });
      const body = (await res.text()).slice(0, 300);
      return { ok: res.status < 400, status: res.status, output: `${res.status} ${res.statusText}\n${body}` };
    } catch (e) {
      return { ok: false, status: 0, output: `request failed: ${(e as Error).message}` };
    }
  }

  async verifyRollback(): Promise<CommandResult> {
    return { ok: false, output: "no deploy adapter is configured, so a rollback cannot be verified; deployment arrives in a later Karigor release" };
  }

  /** An item's own commits only; without an item, everything since the baseline. */
  async diff(itemId?: string): Promise<string> {
    const d = itemId ? await this.workspace.showCommits(await this.workspace.itemCommits(itemId)) : await this.workspace.diff(await this.workspace.baseline());
    return clip(d, this.opts.maxDiffChars ?? 200_000);
  }
}

/** pnpm/npm audit JSON: either `advisories` (classic) or `vulnerabilities` (npm 7+). High and critical only. */
export function parseAudit(stdout: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
  if (!line) return out;
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
