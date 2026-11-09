import type { CommandResult, UrlCheck } from "@karigor/gates";
import type { MissingSetting } from "@karigor/profiles";
import type { DeployAdapter, DeployRequest, DeployResult, LiveRelease } from "./types.js";
import { defaultExec, publicCheck, type VercelExec } from "./vercel.js";

export interface CloudflarePagesOptions {
  /** Pages project name (becomes <name>.pages.dev); created on the first release. */
  project: string;
  /** Default CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, as Wrangler reads them. Never written anywhere. */
  token?: string;
  accountId?: string;
  healthPath?: string;
  binary?: string;
  exec?: VercelExec;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  productionWaitMs?: number;
  pollMs?: number;
}

interface PagesDeployment {
  id: string;
  url: string;
  environment: "production" | "preview";
  latest_stage?: { name?: string; status?: string };
}

/**
 * Cloudflare Pages' free plan for simple websites: the site is built here (`pnpm build`, plain files,
 * no secrets) and its `dist/` uploaded with Wrangler. A preview is a deploy to a preview branch; going
 * live deploys the same build to the production branch; going back uses Pages' own rollback.
 */
export class CloudflarePagesDeploy implements DeployAdapter {
  readonly name = "cloudflare";
  private made = false;
  constructor(private readonly o: CloudflarePagesOptions) {}

  private get token(): string {
    const t = this.o.token ?? process.env["CLOUDFLARE_API_TOKEN"];
    if (!t) throw new Error("Cloudflare needs an API token in CLOUDFLARE_API_TOKEN (with the Pages edit permission) and the account id in CLOUDFLARE_ACCOUNT_ID");
    return t;
  }
  private get account(): string {
    const a = this.o.accountId ?? process.env["CLOUDFLARE_ACCOUNT_ID"];
    if (!a) throw new Error("Cloudflare needs the account id in CLOUDFLARE_ACCOUNT_ID (on the right of the account's home page)");
    return a;
  }

  describe(): string {
    return `Cloudflare Pages' free hosting, project "${this.o.project}"`;
  }

  private get domain(): string {
    return `https://${this.o.project}.pages.dev`;
  }

  private async run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; output: string }> {
    const env = { ...process.env, CLOUDFLARE_API_TOKEN: this.token, CLOUDFLARE_ACCOUNT_ID: this.account, WRANGLER_SEND_METRICS: "false" };
    const r = await (this.o.exec ?? defaultExec)(cmd, args, { cwd, timeoutMs: this.o.timeoutMs ?? 20 * 60 * 1000, env });
    let output = `$ ${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`.trim().replaceAll(this.token, "***");
    if (r.code === 127 && cmd !== "pnpm") output += "\nWrangler is not installed: npm install -g wrangler";
    return { ok: r.code === 0, stdout: r.stdout, output };
  }

  private async api<T>(method: string, path: string): Promise<{ ok: boolean; status: number; result?: T; text: string }> {
    const res = await (this.o.fetchImpl ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${this.account}/pages/projects/${encodeURIComponent(this.o.project)}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { success?: boolean; result?: T };
      return { ok: res.ok && j.success !== false, status: res.status, ...(j.result !== undefined ? { result: j.result } : {}), text: text.slice(0, 500) };
    } catch {
      return { ok: false, status: res.status, text: text.slice(0, 500) };
    }
  }

  private async ensureProject(dir: string): Promise<void> {
    if (this.made) return;
    const r = await this.run(this.o.binary ?? "wrangler", ["pages", "project", "create", this.o.project, "--production-branch", "main"], dir);
    if (!r.ok && !/already exists|8000002/i.test(r.output)) throw new Error(`could not make the Cloudflare Pages project:\n${r.output}`);
    this.made = true;
  }

  /** Build the site, then upload `dist/` to a branch; returns the new deployment. */
  private async upload(r: DeployRequest, branch: string): Promise<{ ok: boolean; deployment?: PagesDeployment; output: string }> {
    await this.ensureProject(r.dir);
    const build = await this.run("pnpm", ["build"], r.dir);
    if (!build.ok) return { ok: false, output: `the site did not build:\n${build.output.slice(-4000)}` };
    const up = await this.run(this.o.binary ?? "wrangler", ["pages", "deploy", "dist", "--project-name", this.o.project, "--branch", branch, "--commit-hash", r.commit, "--commit-message", `karigorVersion=${r.version}`, "--commit-dirty=true"], r.dir);
    if (!up.ok) return { ok: false, output: up.output };
    const url = pagesUrl(up.stdout, this.o.project);
    const list = await this.api<PagesDeployment[]>("GET", "/deployments");
    const deployment = list.result?.find((d) => (url ? d.url === url : d.environment === (branch === "main" ? "production" : "preview")));
    if (!deployment) return { ok: false, output: `${up.output}\nthe new deployment could not be found on Cloudflare` };
    return { ok: true, deployment, output: up.output };
  }

  async preview(r: DeployRequest): Promise<DeployResult> {
    try {
      const u = await this.upload(r, "karigor-preview");
      if (!u.ok || !u.deployment) return { ok: false, output: u.output };
      const h = await this.checkUrl(`${u.deployment.url}${this.o.healthPath ?? ""}`);
      if (!h.ok) return { ok: false, url: u.deployment.url, id: u.deployment.id, output: `${u.output}\nthe preview did not pass its health check: ${h.output}` };
      return { ok: true, url: u.deployment.url, id: u.deployment.id, output: u.output };
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }

  /** The same commit goes to the production branch; live once the public address answers. */
  async promote(r: DeployRequest & { preview: DeployResult }): Promise<DeployResult> {
    try {
      const u = await this.upload(r, "main");
      if (!u.ok || !u.deployment) return { ok: false, output: u.output };
      return await this.waitLive(u.deployment.id, u.output);
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }

  private async waitLive(id: string, output: string): Promise<DeployResult> {
    const deadline = Date.now() + (this.o.productionWaitMs ?? 5 * 60 * 1000);
    let detail = "";
    for (;;) {
      const d = await this.api<PagesDeployment>("GET", `/deployments/${id}`);
      const status = d.result?.latest_stage?.status;
      if (status === "failure") return { ok: false, id, url: this.domain, output: `${output}\nthe production deployment failed on Cloudflare` };
      if (status === "success") {
        const h = await publicCheck(`${this.domain}${this.o.healthPath ?? ""}`, this.o.fetchImpl ?? fetch);
        if (h.ok) return { ok: true, id, url: this.domain, output: `${output}\n${this.domain} now serves ${id} and answers publicly` };
        detail = h.output.split("\n")[0] ?? "";
      } else detail = `deployment ${id}: ${status ?? "unknown"}`;
      if (Date.now() >= deadline) return { ok: false, id, url: this.domain, output: `${output}\nproduction was not live in time (${detail})` };
      await new Promise((res) => setTimeout(res, this.o.pollMs ?? 5_000));
    }
  }

  async rollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    if (!r.live) return { ok: false, output: "there was no earlier release to go back to; the new version stays up until it is fixed" };
    try {
      const res = await this.api<PagesDeployment>("POST", `/deployments/${encodeURIComponent(r.live.id)}/rollback`);
      if (!res.ok) return { ok: false, output: `Cloudflare would not go back to ${r.live.id} (${res.status}: ${res.text})` };
      return { ok: true, output: `went back to ${r.live.id} on Cloudflare Pages` };
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }

  async verifyRollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    if (!r.live) return { ok: true, output: "first release: there is nothing earlier to go back to, and nothing is live that could break" };
    const d = await this.api<PagesDeployment>("GET", `/deployments/${encodeURIComponent(r.live.id)}`).catch(() => undefined);
    return d?.result?.latest_stage?.status === "success" ? { ok: true, output: `the live deployment ${r.live.id} is still kept on Cloudflare, so going back to it works` } : { ok: false, output: `the live deployment ${r.live.id} is not available on Cloudflare (${d?.status ?? "no answer"})` };
  }

  async checkUrl(url: string): Promise<UrlCheck> {
    return publicCheck(url, this.o.fetchImpl ?? fetch);
  }

  /** A simple website has no settings. */
  async missingSettings(): Promise<MissingSetting[]> {
    return [];
  }

  async stop(): Promise<void> {}
}

/** The deployment address Wrangler prints: https://<hash>.<project>.pages.dev (or a branch alias). */
export function pagesUrl(stdout: string, project: string): string | undefined {
  const re = new RegExp(`https://[a-z0-9-]+\\.${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.pages\\.dev`, "g");
  const all = stdout.match(re) ?? [];
  // the deployment's own address (8 hex characters), not the branch alias
  return all.find((u) => /^https:\/\/[0-9a-f]{8}\./.test(u)) ?? all[0];
}
