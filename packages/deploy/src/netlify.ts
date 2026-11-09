import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult, UrlCheck } from "@karigor/gates";
import { TARGET_SETTINGS, readSettings, requiredSettings, toMissing, type MissingSetting } from "@karigor/profiles";
import type { DeployAdapter, DeployRequest, DeployResult, LiveRelease } from "./types.js";
import { defaultExec, publicCheck, type VercelExec } from "./vercel.js";

export interface NetlifyDeployOptions {
  /** Netlify site name (becomes <name>.netlify.app); created on the first release. */
  project: string;
  /** What is being released: a web app builds with Next.js on Netlify's runtime, a simple website publishes `dist/`. */
  kind: "web-app" | "static-site";
  /** Defaults to NETLIFY_AUTH_TOKEN. Never written anywhere. */
  token?: string;
  healthPath?: string;
  binary?: string;
  exec?: VercelExec;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  productionWaitMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
}

const API = "https://api.netlify.com/api/v1";

/** How each kind builds on Netlify. Written into the release when it has none (apps made before this target). */
export const NETLIFY_TOML: Record<NetlifyDeployOptions["kind"], string> = {
  "web-app": '# How Netlify builds this app (migrations, then Next.js on Netlify\'s runtime).\n[build]\n  command = "pnpm build"\n  publish = ".next"\n',
  "static-site": '# How Netlify builds this site.\n[build]\n  command = "pnpm build"\n  publish = "dist"\n',
};

interface Site {
  id: string;
  name: string;
  account_id: string;
  ssl_url?: string;
  url?: string;
  published_deploy?: { id?: string } | null;
}

/**
 * Netlify's free plan, driven through its CLI (to build and upload) and its API (sites, settings,
 * publishing a deploy). Previews are draft deploys; going live publishes that exact deploy, and going
 * back publishes the one before.
 */
export class NetlifyDeploy implements DeployAdapter {
  readonly name = "netlify";
  private site?: Site;
  constructor(private readonly o: NetlifyDeployOptions) {}

  private get token(): string {
    const t = this.o.token ?? process.env["NETLIFY_AUTH_TOKEN"];
    if (!t) throw new Error("Netlify needs a personal access token in NETLIFY_AUTH_TOKEN (app.netlify.com/user/applications)");
    return t;
  }

  describe(): string {
    return `Netlify's free hosting, site "${this.o.project}"`;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: T; text: string }> {
    const res = await (this.o.fetchImpl ?? fetch)(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = undefined as T;
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 500) };
  }

  /** The site, made on the first release with SITE_URL set to its address. */
  private async ensureSite(): Promise<Site> {
    if (this.site) return this.site;
    const found = await this.api<Site[]>("GET", `/sites?name=${encodeURIComponent(this.o.project)}&filter=all`);
    let site = found.ok ? found.json?.find((s) => s.name === this.o.project) : undefined;
    if (!site) {
      const made = await this.api<Site>("POST", "/sites", { name: this.o.project });
      if (!made.ok || !made.json?.id) throw new Error(`could not make the Netlify site "${this.o.project}" (${made.status}: ${made.text})`);
      site = made.json;
      await this.putEnv(site, "SITE_URL", site.ssl_url ?? `https://${this.o.project}.netlify.app`);
    }
    this.site = site;
    return site;
  }

  private async putEnv(site: Site, key: string, value: string): Promise<void> {
    const body = { key, scopes: ["builds", "functions", "runtime", "post_processing"], values: [{ value, context: "all" }] };
    const q = `?site_id=${encodeURIComponent(site.id)}`;
    const put = await this.api("PUT", `/accounts/${encodeURIComponent(site.account_id)}/env/${encodeURIComponent(key)}${q}`, body);
    if (put.ok) return;
    const post = await this.api("POST", `/accounts/${encodeURIComponent(site.account_id)}/env${q}`, [body]);
    if (!post.ok) throw new Error(`could not save ${key} on Netlify (${post.status})`);
  }

  private async cli(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; output: string }> {
    const r = await (this.o.exec ?? defaultExec)(this.o.binary ?? "netlify", args, {
      cwd,
      timeoutMs: this.o.timeoutMs ?? 20 * 60 * 1000,
      env: { ...process.env, NETLIFY_AUTH_TOKEN: this.token, NETLIFY_SITE_ID: this.site?.id ?? "" },
    });
    let output = `$ netlify ${args.join(" ")}\n${r.stdout}\n${r.stderr}`.trim();
    output = output.replaceAll(this.token, "***");
    if (r.code === 127) output += "\nThe Netlify CLI is not installed: npm install -g netlify-cli";
    return { ok: r.code === 0, stdout: r.stdout, output };
  }

  /** Build in `dir` with the site's settings and upload: a draft, or straight to production. */
  private async deploy(dir: string, message: string, prod: boolean): Promise<{ ok: boolean; id?: string; url?: string; output: string }> {
    const site = await this.ensureSite();
    if (!(await stat(join(dir, "netlify.toml")).then(() => true, () => false))) await writeFile(join(dir, "netlify.toml"), NETLIFY_TOML[this.o.kind], "utf8");
    const res = await this.cli(["deploy", "--build", "--site", site.id, "--json", "--message", message, ...(prod ? ["--prod"] : [])], dir);
    const j = parseDeployJson(res.stdout);
    if (!res.ok || !j?.deploy_id) return { ok: false, output: `${res.output}\n${res.ok ? "no deploy id in the output" : "netlify deploy failed"}` };
    const url = prod ? (site.ssl_url ?? j.url) : j.deploy_url;
    return { ok: true, id: j.deploy_id, ...(url ? { url } : {}), output: res.output };
  }

  async preview(r: DeployRequest): Promise<DeployResult> {
    try {
      const d = await this.deploy(r.dir, `karigorVersion=${r.version}`, false);
      if (!d.ok || !d.url) return { ok: false, output: d.output };
      const h = await this.checkUrl(`${d.url}${this.o.healthPath ?? ""}`);
      if (!h.ok) return { ok: false, url: d.url, id: d.id!, output: `${d.output}\nthe preview did not pass its health check: ${h.output}` };
      return { ok: true, url: d.url, id: d.id!, output: d.output };
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }

  /** Publish the preview's exact deploy, then wait until the site serves it and answers publicly. */
  async promote(r: DeployRequest & { preview: DeployResult }): Promise<DeployResult> {
    if (!r.preview.id) return { ok: false, output: "no preview to promote" };
    try {
      return await this.publish(r.preview.id);
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }

  private async publish(deployId: string): Promise<DeployResult> {
    const site = await this.ensureSite();
    const res = await this.api<{ id?: string }>("POST", `/sites/${site.id}/deploys/${deployId}/restore`);
    if (!res.ok) return { ok: false, output: `Netlify would not publish deploy ${deployId} (${res.status}: ${res.text})` };
    const domain = site.ssl_url ?? `https://${this.o.project}.netlify.app`;
    const deadline = Date.now() + (this.o.productionWaitMs ?? 5 * 60 * 1000);
    let detail = "";
    for (;;) {
      const now = await this.api<Site>("GET", `/sites/${site.id}`);
      if (now.json?.published_deploy?.id === deployId) {
        const h = await publicCheck(`${domain}${this.o.healthPath ?? ""}`, this.o.fetchImpl ?? fetch);
        if (h.ok) return { ok: true, id: deployId, url: domain, output: `${domain} now serves ${deployId} and answers publicly` };
        detail = h.output.split("\n")[0] ?? "";
      } else detail = `the site still serves ${now.json?.published_deploy?.id ?? "nothing"}`;
      if (Date.now() >= deadline) return { ok: false, id: deployId, url: domain, output: `production was not live in time: ${detail}` };
      await new Promise((res) => setTimeout(res, this.o.pollMs ?? 5_000));
    }
  }

  async rollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    if (!r.live) return { ok: false, output: "there was no earlier release to go back to; the new version stays up until it is fixed" };
    const res = await this.publish(r.live.id).catch((e: Error) => ({ ok: false, output: e.message }));
    return { ok: res.ok, output: res.output };
  }

  async verifyRollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    if (!r.live) return { ok: true, output: "first release: there is nothing earlier to go back to, and nothing is live that could break" };
    const d = await this.api<{ state?: string }>("GET", `/deploys/${encodeURIComponent(r.live.id)}`).catch(() => undefined);
    return d?.json?.state === "ready" ? { ok: true, output: `the live deploy ${r.live.id} is still kept on Netlify, so going back to it works` } : { ok: false, output: `the live deploy ${r.live.id} is ${d?.json?.state ?? "missing"} on Netlify` };
  }

  async checkUrl(url: string): Promise<UrlCheck> {
    return publicCheck(url, this.o.fetchImpl ?? fetch);
  }

  async missingSettings(dir: string): Promise<MissingSetting[]> {
    const required = requiredSettings(await readSettings(dir), true);
    if (!required.length) return [];
    const site = await this.ensureSite();
    const env = await this.api<{ key: string }[]>("GET", `/accounts/${encodeURIComponent(site.account_id)}/env?site_id=${encodeURIComponent(site.id)}`);
    const names = env.ok && Array.isArray(env.json) ? env.json.map((e) => e.key) : [];
    return required.filter((s) => !names.includes(s.name) && !(TARGET_SETTINGS as readonly string[]).includes(s.name)).map(toMissing);
  }

  /** Each value is saved as an environment variable of the site, for every context. */
  async setSettings(_dir: string, values: Record<string, string>): Promise<CommandResult> {
    try {
      const site = await this.ensureSite();
      for (const [k, v] of Object.entries(values)) await this.putEnv(site, k, v);
      return { ok: true, output: `saved on Netlify: ${Object.keys(values).join(", ")}` };
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }

  /**
   * Settings reach the app only through a new build, so the live version is built again from its own
   * release tag (not from whatever the workspace holds now) and published.
   */
  async applySettings(r: { dir: string; live: LiveRelease }): Promise<DeployResult> {
    const tmp = await mkdtemp(join(tmpdir(), "karigor-netlify-"));
    const exec = this.o.exec ?? defaultExec;
    const run = (cmd: string, args: string[], cwd: string) => exec(cmd, args, { cwd, timeoutMs: this.o.timeoutMs ?? 20 * 60 * 1000, env: process.env });
    try {
      const wt = await run("git", ["worktree", "add", "--detach", tmp, `karigor-release-${r.live.version}`], r.dir);
      if (wt.code !== 0) return { ok: false, output: `the live version's code could not be found (tag karigor-release-${r.live.version}): ${wt.stderr}` };
      const inst = await run("pnpm", ["install", "--silent"], tmp);
      if (inst.code !== 0) return { ok: false, output: `could not install the live version: ${inst.stderr.slice(-2000)}` };
      const d = await this.deploy(tmp, `karigorVersion=${r.live.version} (settings)`, false);
      if (!d.ok || !d.id) return { ok: false, output: d.output };
      return await this.publish(d.id);
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    } finally {
      await run("git", ["worktree", "remove", "--force", tmp], r.dir);
      await rm(tmp, { recursive: true, force: true });
    }
  }

  async stop(): Promise<void> {}
}

/** The JSON object `netlify deploy --json` prints (after any build output). */
export function parseDeployJson(stdout: string): { deploy_id?: string; deploy_url?: string; url?: string; site_id?: string } | undefined {
  const start = stdout.lastIndexOf("\n{") >= 0 ? stdout.lastIndexOf("\n{") + 1 : stdout.indexOf("{");
  if (start < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(start)) as { deploy_id?: string };
  } catch {
    return undefined;
  }
}
