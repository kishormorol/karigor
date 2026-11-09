import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CloudflarePagesDeploy, NetlifyDeploy, pagesUrl, parseDeployJson, vercelErrorLines, type VercelExec } from "../src/index.js";

type Call = { cmd: string; args: string[]; env?: NodeJS.ProcessEnv };
type Req = { method: string; url: string; body?: string; auth: string | null };

function fakeFetch(answer: (r: Req) => { status?: number; body: unknown } | undefined) {
  const seen: Req[] = [];
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const r: Req = { method: init.method ?? "GET", url: String(input), ...(init.body ? { body: String(init.body) } : {}), auth: new Headers(init.headers).get("authorization") };
    seen.push(r);
    const a = answer(r);
    if (!a) return new Response("ok", { status: 200 });
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe("Netlify", () => {
  const SITE = { id: "site-1", name: "shop-a1b2c3", account_id: "acct", ssl_url: "https://shop-a1b2c3.netlify.app", published_deploy: { id: "old" } };

  function setup(o: { siteExists?: boolean } = {}) {
    let published = "old";
    const calls: Call[] = [];
    const exec: VercelExec = async (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts.env });
      if (cmd === "netlify") return { stdout: `building...\n${JSON.stringify({ site_id: "site-1", deploy_id: `d-${calls.length}`, deploy_url: `https://d-${calls.length}--shop-a1b2c3.netlify.app` })}`, stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    };
    const { f, seen } = fakeFetch((r) => {
      if (r.url.includes("/sites?name=")) return { body: o.siteExists === false ? [] : [SITE] };
      if (r.method === "POST" && r.url.endsWith("/sites")) return { body: SITE };
      if (r.method === "POST" && r.url.includes("/restore")) {
        published = r.url.split("/deploys/")[1]!.split("/")[0]!;
        return { body: { id: published } };
      }
      if (r.method === "GET" && r.url.endsWith("/sites/site-1")) return { body: { ...SITE, published_deploy: { id: published } } };
      if (r.url.includes("/deploys/")) return { body: { state: "ready" } };
      if (r.url.includes("/env?site_id") && r.method === "GET") return { body: [{ key: "DATABASE_URL" }] };
      if (r.url.includes("/env/") && r.method === "PUT") return { status: 404, body: {} };
      return undefined;
    });
    const deploy = new NetlifyDeploy({ project: "shop-a1b2c3", kind: "web-app", token: "test-netlify-token", healthPath: "/api/health", exec, fetchImpl: f, pollMs: 1 });
    return { deploy, calls, seen, published: () => published };
  }

  it("previews a draft deploy built with the site's settings, then publishes that exact deploy", async () => {
    const { deploy, calls, seen, published } = setup();
    const dir = await mkdtemp(join(tmpdir(), "karigor-netlify-"));
    const r = { dir, version: "r1-abc1234", commit: "abc1234", key: "k" };
    const p = await deploy.preview(r);
    expect(p).toMatchObject({ ok: true, id: "d-1", url: "https://d-1--shop-a1b2c3.netlify.app" });
    expect(calls[0]!.args).toEqual(["deploy", "--build", "--site", "site-1", "--json", "--message", "karigorVersion=r1-abc1234"]);
    expect(calls[0]!.env?.["NETLIFY_AUTH_TOKEN"]).toBe("test-netlify-token");
    // an app made before this target gets told how to build on Netlify
    expect(await readFile(join(dir, "netlify.toml"), "utf8")).toMatch(/publish = "\.next"/);
    expect(seen.some((s) => s.url === "https://d-1--shop-a1b2c3.netlify.app/api/health")).toBe(true);
    const live = await deploy.promote({ ...r, preview: p });
    expect(live).toMatchObject({ ok: true, id: "d-1", url: "https://shop-a1b2c3.netlify.app" });
    expect(published()).toBe("d-1");
    expect(seen.every((s) => !s.url.startsWith("https://api.netlify.com") || s.auth === "Bearer test-netlify-token")).toBe(true);
    // going back publishes the release before
    expect((await deploy.rollback({ dir, live: { url: "", id: "old", version: "r0" } })).ok).toBe(true);
    expect(published()).toBe("old");
    expect((await deploy.verifyRollback({ dir, live: { url: "", id: "old", version: "r0" } })).ok).toBe(true);
  });

  it("makes the site on the first release with its own address as SITE_URL, and stores settings by name", async () => {
    const { deploy, seen } = setup({ siteExists: false });
    const dir = await mkdtemp(join(tmpdir(), "karigor-netlify-"));
    await writeFile(join(dir, ".env.example"), "# Where data lives\nDATABASE_URL=file:./data/app.db\n# A passcode\n# karigor: ask\nPASSCODE=\n");
    expect((await deploy.missingSettings(dir)).map((m) => m.name)).toEqual(["PASSCODE"]);
    expect(seen.some((s) => s.method === "POST" && s.url.endsWith("/sites") && s.body === JSON.stringify({ name: "shop-a1b2c3" }))).toBe(true);
    const siteUrl = seen.find((s) => s.method === "POST" && s.url.includes("/env?site_id=site-1") && s.body?.includes("SITE_URL"));
    expect(siteUrl?.body).toContain("https://shop-a1b2c3.netlify.app");
    const set = await deploy.setSettings(dir, { PASSCODE: "s3cret-value" });
    expect(set).toEqual({ ok: true, output: "saved on Netlify: PASSCODE" });
    expect(set.output).not.toContain("s3cret-value");
  });

  it("says what is missing instead of failing obscurely", async () => {
    const saved = process.env["NETLIFY_AUTH_TOKEN"];
    delete process.env["NETLIFY_AUTH_TOKEN"];
    const d = new NetlifyDeploy({ project: "x", kind: "static-site" });
    expect((await d.preview({ dir: "/tmp", version: "r1-a", commit: "a", key: "k" })).output).toMatch(/NETLIFY_AUTH_TOKEN/);
    if (saved) process.env["NETLIFY_AUTH_TOKEN"] = saved;
    expect(parseDeployJson('noise {"x":1}\n{"deploy_id":"d","deploy_url":"u"}')).toEqual({ deploy_id: "d", deploy_url: "u" });
  });
});

describe("Cloudflare Pages", () => {
  it("builds here, uploads to a preview branch, then the same commit to production, and goes back with Pages' rollback", async () => {
    const calls: Call[] = [];
    const exec: VercelExec = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "wrangler" && args[1] === "deploy") {
        const branch = args[args.indexOf("--branch") + 1];
        return { stdout: `Uploading...\n✨ Deployment complete! Take a peek over at https://${branch === "main" ? "bbbbbbbb" : "aaaaaaaa"}.menu-x1y2z3.pages.dev\n✨ Deployment alias URL: https://${branch}.menu-x1y2z3.pages.dev`, stderr: "", code: 0 };
      }
      if (cmd === "wrangler" && args[1] === "project") return { stdout: "", stderr: "A project with this name already exists [code: 8000002]", code: 1 };
      return { stdout: "", stderr: "", code: 0 };
    };
    const { f, seen } = fakeFetch((r) => {
      if (r.url.endsWith("/deployments") && r.method === "GET") return { body: { success: true, result: [{ id: "dep-b", url: "https://bbbbbbbb.menu-x1y2z3.pages.dev", environment: "production" }, { id: "dep-a", url: "https://aaaaaaaa.menu-x1y2z3.pages.dev", environment: "preview" }] } };
      if (r.url.includes("/deployments/") && r.method === "GET") return { body: { success: true, result: { id: "dep-b", latest_stage: { status: "success" } } } };
      if (r.url.includes("/rollback")) return { body: { success: true, result: {} } };
      return undefined;
    });
    const d = new CloudflarePagesDeploy({ project: "menu-x1y2z3", token: "test-cf-token", accountId: "acct-1", exec, fetchImpl: f, pollMs: 1 });
    const r = { dir: "/tmp", version: "r1-abc1234", commit: "abc1234", key: "k" };
    const p = await d.preview(r);
    expect(p).toMatchObject({ ok: true, id: "dep-a", url: "https://aaaaaaaa.menu-x1y2z3.pages.dev" });
    expect(calls.map((c) => `${c.cmd} ${c.args.slice(0, 2).join(" ")}`)).toEqual(["wrangler pages project", "pnpm build", "wrangler pages deploy"]);
    expect(calls[2]!.args).toContain("karigor-preview");
    const live = await d.promote({ ...r, preview: p });
    expect(live).toMatchObject({ ok: true, id: "dep-b", url: "https://menu-x1y2z3.pages.dev" });
    expect(calls.at(-1)!.args).toEqual(expect.arrayContaining(["--branch", "main", "--commit-hash", "abc1234"]));
    expect((await d.rollback({ dir: "/tmp", live: { url: "", id: "dep-a", version: "r0" } })).ok).toBe(true);
    expect(seen.some((s) => s.method === "POST" && s.url === "https://api.cloudflare.com/client/v4/accounts/acct-1/pages/projects/menu-x1y2z3/deployments/dep-a/rollback" && s.auth === "Bearer test-cf-token")).toBe(true);
    expect(await d.missingSettings()).toEqual([]);
  });

  it("finds the deployment's own address in Wrangler's output", () => {
    expect(pagesUrl("alias https://main.site.pages.dev and https://1a2b3c4d.site.pages.dev", "site")).toBe("https://1a2b3c4d.site.pages.dev");
    expect(pagesUrl("nothing here", "site")).toBeUndefined();
  });
});

describe("errors from a hosted app's logs", () => {
  it("keeps failed requests and logged errors, oldest first, in lines the error signals understand", () => {
    const lines = [
      { timestamp: 3, level: "info", requestMethod: "GET", requestPath: "/ok", responseStatusCode: 200, message: "" },
      { timestamp: 2, level: "info", requestMethod: "POST", requestPath: "/api/visits", responseStatusCode: 500, logs: [{ level: "error", message: "TypeError: Cannot read properties of undefined (reading 'id')\n    at x" }] },
      { timestamp: 1, level: "error", message: "Unable to open connection to local database" },
      { timestamp: 4, level: "info", requestMethod: "GET", requestPath: "/api/health", responseStatusCode: 504 },
    ].map((x) => JSON.stringify(x));
    expect(vercelErrorLines(["noise", ...lines].join("\n"))).toEqual([
      "Error: Unable to open connection to local database",
      "POST /api/visits 500 TypeError: Cannot read properties of undefined (reading 'id')",
      "GET /api/health 504",
    ]);
  });
});
