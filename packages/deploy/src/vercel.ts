import { execFile } from "node:child_process";
import type { CommandResult, UrlCheck } from "@karigor/gates";
import { checkUrl } from "@karigor/sandbox";
import type { DeployAdapter, DeployRequest, DeployResult, LiveRelease } from "./types.js";

export type VercelExec = (file: string, args: string[], opts: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const defaultExec: VercelExec = (file, args, { cwd, timeoutMs, env }) =>
  new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, env, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: unknown; killed?: boolean }) | null;
      if (e?.killed) return resolve({ stdout: String(stdout), stderr: `${String(stderr)}\n(timed out)`, code: null });
      if (e && typeof e.code !== "number") return resolve({ stdout: String(stdout), stderr: `${String(stderr)}\n${e.message}`, code: 127 });
      resolve({ stdout: String(stdout), stderr: String(stderr), code: e ? (e.code as number) : 0 });
    });
  });

export interface VercelDeployOptions {
  /** Vercel project name; created on first deploy. */
  project: string;
  /** Defaults to the `VERCEL_TOKEN` environment variable. Never written anywhere. */
  token?: string;
  /** Team scope, when the token belongs to a team. */
  scope?: string;
  /** Host environment variables passed through to the deployment by name. */
  envNames?: string[];
  healthPath?: string;
  binary?: string;
  exec?: VercelExec;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const DEFAULT_ENV_NAMES = ["DATABASE_URL", "DATABASE_AUTH_TOKEN"];

/** The first hosted target: Vercel's free hobby tier, driven through the `vercel` CLI. */
export class VercelDeploy implements DeployAdapter {
  readonly name = "vercel";
  private readonly exec: VercelExec;
  constructor(private readonly o: VercelDeployOptions) {
    this.exec = o.exec ?? defaultExec;
  }

  private get token(): string | undefined {
    return this.o.token ?? process.env["VERCEL_TOKEN"];
  }

  describe(): string {
    return `Vercel's free hosting, project "${this.o.project}"`;
  }

  private async cli(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; output: string }> {
    const token = this.token;
    if (!token) return { ok: false, stdout: "", output: "VERCEL_TOKEN is not set, so nothing can be put on Vercel. Create a token at vercel.com/account/tokens and set VERCEL_TOKEN, or use the local target." };
    const full = [...args, "--token", token, "--non-interactive", ...(this.o.scope ? ["--scope", this.o.scope] : [])];
    const env = { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" };
    const r = await this.exec(this.o.binary ?? "vercel", full, { cwd, timeoutMs: this.o.timeoutMs ?? 20 * 60 * 1000, env });
    const output = `$ vercel ${args.join(" ")}\n${r.stdout}\n${r.stderr}`.replaceAll(token, "***").trim();
    return { ok: r.code === 0, stdout: r.stdout, output };
  }

  async preview(r: DeployRequest): Promise<DeployResult> {
    const envs = (this.o.envNames ?? DEFAULT_ENV_NAMES).flatMap((n) => (process.env[n] ? ["-e", `${n}=${process.env[n]}`] : []));
    const res = await this.cli(["deploy", r.dir, "--yes", "--project", this.o.project, "-m", `karigorVersion=${r.version}`, ...envs], r.dir);
    // Values passed with -e must not leak into records.
    let output = res.output;
    for (const n of this.o.envNames ?? DEFAULT_ENV_NAMES) if (process.env[n]) output = output.replaceAll(process.env[n]!, `$${n}`);
    const url = deploymentUrl(res.stdout);
    if (!res.ok || !url) return { ok: false, output: `${output}\n${res.ok ? "no deployment URL in the output" : "vercel deploy failed"}` };
    const h = await this.checkUrl(`${url}${this.o.healthPath ?? ""}`);
    if (!h.ok) return { ok: false, url, id: url, output: `${output}\nthe preview did not pass its health check: ${h.output}` };
    return { ok: true, url, id: url, output };
  }

  async promote(r: DeployRequest & { preview: DeployResult }): Promise<DeployResult> {
    if (!r.preview.url) return { ok: false, output: "no preview to promote" };
    const res = await this.cli(["promote", r.preview.url, "--yes", "--timeout", "5m"], r.dir);
    if (!res.ok) return { ok: false, output: res.output };
    const url = productionUrl(res.stdout, this.o.project) ?? r.preview.url;
    const h = await this.checkUrl(`${url}${this.o.healthPath ?? ""}`);
    if (!h.ok) return { ok: false, url, id: r.preview.id ?? r.preview.url, output: `${res.output}\nproduction did not pass its health check: ${h.output}` };
    return { ok: true, url, id: r.preview.id ?? r.preview.url, output: res.output };
  }

  async rollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    if (!r.live) return { ok: false, output: "there was no earlier release to go back to; the new version stays up until it is fixed" };
    const res = await this.cli(["rollback", r.live.id, "--yes", "--timeout", "5m"], r.dir);
    return { ok: res.ok, output: res.output };
  }

  async verifyRollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    if (!this.token) return { ok: false, output: "VERCEL_TOKEN is not set" };
    if (!r.live) return { ok: true, output: "first release: there is nothing earlier to go back to, and nothing is live that could break" };
    const h = await this.checkUrl(`${r.live.id.startsWith("http") ? r.live.id : r.live.url}${this.o.healthPath ?? ""}`);
    return h.ok ? { ok: true, output: `the live deployment ${r.live.version} still answers, so going back to it works` } : { ok: false, output: `the live deployment ${r.live.version} does not answer: ${h.output}` };
  }

  /** A GET first; previews behind Vercel's login are checked through `vercel curl`, which bypasses it. */
  async checkUrl(url: string): Promise<UrlCheck> {
    const plain = await checkUrl(url, this.o.fetchImpl);
    if (plain.status !== 401 && plain.status !== 403) return plain;
    const u = new URL(url);
    const res = await this.cli(["curl", u.pathname + u.search, "--deployment", u.origin, "--yes", "--", "--fail", "--silent", "--show-error"], process.cwd());
    return { ok: res.ok, status: res.ok ? 200 : plain.status, output: `protected; checked through vercel curl\n${res.output.slice(0, 600)}` };
  }

  async stop(): Promise<void> {}
}

/** The deployment URL from `vercel deploy` output: JSON when present, else the last vercel.app URL. */
export function deploymentUrl(stdout: string): string | undefined {
  for (const line of stdout.split("\n").reverse()) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const j = JSON.parse(t) as { url?: string; deployment?: { url?: string } };
      const u = j.deployment?.url ?? j.url;
      if (u) return u.startsWith("http") ? u : `https://${u}`;
    } catch {
      /* not JSON */
    }
  }
  const all = stdout.match(/https:\/\/[a-z0-9.-]+\.vercel\.app\b/gi);
  return all?.at(-1);
}

/** A production alias from `vercel promote` output, preferring `<project>.vercel.app`. */
export function productionUrl(stdout: string, project: string): string | undefined {
  const all = stdout.match(/https:\/\/[a-z0-9.-]+\b/gi) ?? [];
  return all.find((u) => u.toLowerCase() === `https://${project.toLowerCase()}.vercel.app`) ?? all.find((u) => !/-[a-z0-9]{9}-/.test(u));
}

/** A Vercel project name from a product title: lowercase, dashes, at most 40 characters. */
export function projectSlug(title: string, projectId: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "karigor-app";
  return `${base}-${projectId.slice(-6)}`.replace(/--+/g, "-");
}
