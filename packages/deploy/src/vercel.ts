import { execFile } from "node:child_process";
import type { CommandResult, UrlCheck } from "@karigor/gates";
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
  /** Defaults to the `VERCEL_TOKEN` environment variable, then the Vercel CLI's own login. Never written anywhere. */
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
  /** How long production may take to come up after a promotion. */
  productionWaitMs?: number;
  pollMs?: number;
}

export const DEFAULT_ENV_NAMES = ["DATABASE_URL", "DATABASE_AUTH_TOKEN"];

/** The first hosted target: Vercel's free hobby tier, driven through the `vercel` CLI. */
export class VercelDeploy implements DeployAdapter {
  readonly name = "vercel";
  private readonly exec: VercelExec;
  /** "" once read and absent. Never written anywhere. */
  private bypassSecret: string | undefined;
  constructor(private readonly o: VercelDeployOptions) {
    this.exec = o.exec ?? defaultExec;
  }

  private get token(): string | undefined {
    return this.o.token ?? process.env["VERCEL_TOKEN"];
  }

  describe(): string {
    return `Vercel's free hosting, project "${this.o.project}"`;
  }

  private async cli(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; output: string; raw: string }> {
    const token = this.token;
    const own = [...(token ? ["--token", token] : []), "--non-interactive", ...(this.o.scope ? ["--scope", this.o.scope] : [])];
    // Arguments after `--` belong to another program (curl); Vercel's own flags go before them.
    const cut = args.indexOf("--");
    const full = cut < 0 ? [...args, ...own] : [...args.slice(0, cut), ...own, ...args.slice(cut)];
    const env = { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" };
    const r = await this.exec(this.o.binary ?? "vercel", full, { cwd, timeoutMs: this.o.timeoutMs ?? 20 * 60 * 1000, env });
    const raw = `${r.stdout}\n${r.stderr}`;
    let output = `$ vercel ${args.join(" ")}\n${raw}`.trim();
    if (token) output = output.replaceAll(token, "***");
    if (r.code !== 0 && /not logged in|no existing credentials|login|token/i.test(output) && !token) output += "\nVercel is not signed in: run `vercel login` once, or set VERCEL_TOKEN (vercel.com/account/tokens).";
    return { ok: r.code === 0, stdout: r.stdout, output, raw };
  }

  async preview(r: DeployRequest): Promise<DeployResult> {
    const envs = (this.o.envNames ?? DEFAULT_ENV_NAMES).flatMap((n) => (process.env[n] ? ["-e", `${n}=${process.env[n]}`] : []));
    // Explicitly a preview: the first deploy into a new project would otherwise go straight to production.
    const args = ["deploy", r.dir, "--yes", "--target", "preview", "--project", this.o.project, "-m", `karigorVersion=${r.version}`, ...envs];
    let res = await this.cli(args, r.dir);
    // `--project` names an existing project; the first release creates it.
    if (!res.ok && /project_not_found|was not found/i.test(res.raw)) {
      const add = await this.cli(["project", "add", this.o.project], r.dir);
      if (!add.ok) return { ok: false, output: `${res.output}\n${add.output}\ncould not create the Vercel project` };
      res = await this.cli(args, r.dir);
    }
    // Values passed with -e must not leak into records.
    let output = res.output;
    for (const n of this.o.envNames ?? DEFAULT_ENV_NAMES) if (process.env[n]) output = output.replaceAll(process.env[n]!, `$${n}`);
    const url = deploymentUrl(res.stdout);
    if (!res.ok || !url) return { ok: false, output: `${output}\n${res.ok ? "no deployment URL in the output" : "vercel deploy failed"}` };
    const h = await this.checkUrl(`${url}${this.o.healthPath ?? ""}`);
    if (!h.ok) return { ok: false, url, id: url, output: `${output}\nthe preview did not pass its health check: ${h.output}` };
    return { ok: true, url, id: url, output };
  }

  /**
   * Promoting a preview makes Vercel build it again for production, so production is polled until
   * it answers. Production must answer publicly (no bypass): it is the link the person shares.
   */
  async promote(r: DeployRequest & { preview: DeployResult }): Promise<DeployResult> {
    if (!r.preview.url) return { ok: false, output: "no preview to promote" };
    const res = await this.cli(["promote", r.preview.url, "--yes", "--timeout", "5m"], r.dir);
    if (!res.ok) return { ok: false, output: res.output };
    const id = productionDeploymentId(res.raw) ?? r.preview.id ?? r.preview.url;
    const candidates = [...new Set([productionUrl(res.stdout, this.o.project), `https://${this.o.project}.vercel.app`].filter(Boolean) as string[])];
    const deadline = Date.now() + (this.o.productionWaitMs ?? 8 * 60 * 1000);
    let last = "";
    for (;;) {
      for (const url of candidates) {
        const h = await publicCheck(`${url}${this.o.healthPath ?? ""}`, this.o.fetchImpl ?? fetch);
        if (h.ok) return { ok: true, url, id, output: `${res.output}\n${url} answers publicly` };
        last = `${url}: ${h.output.split("\n")[0]}`;
      }
      if (Date.now() >= deadline) break;
      await new Promise((res) => setTimeout(res, this.o.pollMs ?? 5_000));
    }
    return { ok: false, url: candidates[0]!, id, output: `${res.output}\nproduction did not answer publicly in time (${last})` };
  }

  async rollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    if (!r.live) return { ok: false, output: "there was no earlier release to go back to; the new version stays up until it is fixed" };
    const res = await this.cli(["rollback", r.live.id, "--yes", "--timeout", "5m"], r.dir);
    return { ok: res.ok, output: res.output };
  }

  /** The live production deployment still exists and is ready, so rolling back to it would work. */
  async verifyRollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    if (!r.live) return { ok: true, output: "first release: there is nothing earlier to go back to, and nothing is live that could break" };
    const res = await this.cli(["inspect", r.live.id], r.dir);
    const ready = res.ok && /\bReady\b|READY/.test(res.raw);
    return ready ? { ok: true, output: `the live deployment ${r.live.version} (${r.live.id}) is ready, so going back to it works` } : { ok: false, output: `the live deployment ${r.live.version} cannot be found or is not ready:\n${res.output.slice(0, 1500)}` };
  }

  /** The project's automation bypass secret, read from Vercel when needed and kept in memory only. */
  private async bypass(): Promise<string | undefined> {
    if (this.bypassSecret !== undefined) return this.bypassSecret || undefined;
    const read = async () => {
      const res = await this.cli(["project", "protection", this.o.project, "--json"], process.cwd());
      try {
        const j = JSON.parse(res.stdout.slice(res.stdout.indexOf("{"))) as { protectionBypass?: Record<string, { scope?: string }> };
        return Object.entries(j.protectionBypass ?? {}).find(([, v]) => v.scope === "automation-bypass")?.[0];
      } catch {
        return undefined;
      }
    };
    let secret = await read();
    if (!secret) {
      await this.cli(["project", "protection", "enable", this.o.project, "--protection-bypass"], process.cwd());
      secret = await read();
    }
    this.bypassSecret = secret ?? "";
    return secret;
  }

  /**
   * Deployment URLs sit behind Vercel's login: they answer 401/403 or redirect to vercel.com.
   * Those are checked again with the project's automation bypass header.
   */
  async checkUrl(url: string): Promise<UrlCheck> {
    const f = this.o.fetchImpl ?? fetch;
    const plain = await publicCheck(url, f);
    if (!plain.protectedBy) return { ok: plain.ok, status: plain.status, output: plain.output };
    const secret = await this.bypass();
    if (!secret) return { ...plain, output: `${plain.output}; the deployment is protected and no bypass secret could be read` };
    const h = await publicCheck(url, f, { "x-vercel-protection-bypass": secret });
    return { ok: h.ok, status: h.status, output: `protected; checked with the project's automation bypass\n${h.output.replaceAll(secret, "***")}` };
  }

  async stop(): Promise<void> {}
}

/** A GET that does not follow redirects off the host: a redirect to Vercel's login is not a healthy app. */
async function publicCheck(url: string, f: typeof fetch, headers: Record<string, string> = {}): Promise<UrlCheck & { protectedBy?: boolean }> {
  try {
    let target = url;
    for (let hops = 0; hops < 5; hops++) {
      const res = await f(target, { method: "GET", redirect: "manual", headers, signal: AbortSignal.timeout(15_000) });
      if (res.status >= 300 && res.status < 400) {
        const next = new URL(res.headers.get("location") ?? "/", target);
        if (next.host !== new URL(target).host) return { ok: false, status: res.status, output: `redirected to ${next.origin}`, protectedBy: /(^|\.)vercel\.com$/.test(next.host) };
        target = next.href;
        continue;
      }
      const body = (await res.text()).slice(0, 300);
      return { ok: res.status < 400, status: res.status, output: `${res.status} ${res.statusText}\n${body}`, protectedBy: res.status === 401 || res.status === 403 };
    }
    return { ok: false, status: 310, output: "too many redirects" };
  } catch (e) {
    return { ok: false, status: 0, output: `request failed: ${(e as Error).message}` };
  }
}

/** The new production deployment's id from `vercel promote` output ("... at https://vercel.com/<team>/<project>/<id>"). */
export function productionDeploymentId(text: string): string | undefined {
  return /https:\/\/vercel\.com\/[^/\s]+\/[^/\s]+\/([A-Za-z0-9]{16,})/.exec(text)?.[1];
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
  const all = stdout.match(/https:\/\/[a-z0-9.-]+\.vercel\.app\b/gi) ?? [];
  return all.find((u) => u.toLowerCase() === `https://${project.toLowerCase()}.vercel.app`) ?? all.find((u) => !/-[a-z0-9]{9}-/.test(u));
}

/** A Vercel project name from a product title: lowercase, dashes, at most 40 characters. */
export function projectSlug(title: string, projectId: string): string {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-");
  let base = "";
  for (const w of words) if ((base ? base.length + 1 : 0) + w.length <= 28) base = base ? `${base}-${w}` : w; else break;
  base ||= words[0]?.slice(0, 28) || "karigor-app";
  return `${base}-${projectId.slice(-6)}`.replace(/--+/g, "-");
}
