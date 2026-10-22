import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixture } from "@karigor/profiles";
import { Workspace } from "@karigor/sandbox";
import { LocalDeploy, VercelDeploy, deploymentUrl, parseInspect, productionDeploymentId, productionUrl, projectSlug, releaseVersion, type VercelExec } from "../src/index.js";

const started: LocalDeploy[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((d) => d.stop()));
});

async function setup() {
  const projectDir = await mkdtemp(join(tmpdir(), "karigor-deploy-"));
  const ws = await Workspace.create(join(projectDir, "workspace"), fixture);
  const deploy = new LocalDeploy({ projectDir, profile: fixture, healthTimeoutMs: 10_000 });
  started.push(deploy);
  return { projectDir, ws, deploy };
}

async function commit(ws: Workspace, files: Record<string, string | null>, msg = "karigor(b1): change") {
  for (const [p, c] of Object.entries(files)) {
    if (c === null) await rm(join(ws.dir, p), { force: true });
    else await writeFile(join(ws.dir, p), c);
  }
  return (await ws.commitAll(msg))!;
}

const req = (ws: Workspace, n: number, sha: string) => ({ dir: ws.dir, version: releaseVersion(n, sha), commit: sha, key: `k${n}` });

describe("LocalDeploy", { timeout: 60_000 }, () => {
  it("builds a release from a commit, serves a healthy preview, promotes it, and keeps releases out of the project's git", async () => {
    const { projectDir, ws, deploy } = await setup();
    const sha = await commit(ws, { "src/b1.js": "export const b1 = 1;\n" });
    const r = req(ws, 1, sha);
    const p = await deploy.preview(r);
    expect(p.ok, p.output).toBe(true);
    expect(p.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await (await fetch(p.url!)).text();
    expect(page).toMatch(/b1\.js/);
    expect(await deploy.verifyRollback({ dir: ws.dir })).toMatchObject({ ok: true, output: expect.stringMatching(/first release/) });
    const live = await deploy.promote({ ...r, preview: p });
    expect(live).toMatchObject({ ok: true, url: "http://localhost:3000", id: r.version });
    expect(await deploy.current()).toEqual({ version: r.version, history: [] });
    expect(await readFile(join(projectDir, ".gitignore"), "utf8")).toMatch(/^releases\/$/m);
  });

  it("an unhealthy release fails its preview with the app's own output", async () => {
    const { ws, deploy } = await setup();
    const sha = await commit(ws, { "health-fail": "" });
    const p = await deploy.preview(req(ws, 1, sha));
    expect(p.ok).toBe(false);
    expect(p.output).toMatch(/answered 500/);
  });

  it("a release that cannot start fails fast", async () => {
    const { ws, deploy } = await setup();
    const sha = await commit(ws, { "start-fail": "" });
    const p = await deploy.preview(req(ws, 1, sha));
    expect(p.ok).toBe(false);
    expect(p.output).toMatch(/stopped|could not start/);
  });

  it("a failing build never reaches a server", async () => {
    const { ws, deploy } = await setup();
    const sha = await commit(ws, { "build-fail": "" });
    const p = await deploy.preview(req(ws, 1, sha));
    expect(p).toMatchObject({ ok: false });
    expect(p.output).toMatch(/could not be built[\s\S]*build failed/);
  });

  it("verifies a rollback against the live release, rolls back, and goes offline after the first", async () => {
    const { ws, deploy } = await setup();
    const s1 = await commit(ws, { "src/a.js": "1" });
    const r1 = req(ws, 1, s1);
    await deploy.promote({ ...r1, preview: await deploy.preview(r1) });
    const s2 = await commit(ws, { "src/a.js": "2" });
    const r2 = req(ws, 2, s2);
    const p2 = await deploy.preview(r2);
    const v = await deploy.verifyRollback({ dir: ws.dir });
    expect(v.ok, v.output).toBe(true);
    expect(v.output).toMatch(new RegExp(r1.version));
    await deploy.promote({ ...r2, preview: p2 });
    expect(await deploy.current()).toEqual({ version: r2.version, history: [r1.version] });
    const seen: (string | undefined)[] = [];
    deploy.onChange((c) => seen.push(c?.version));
    expect((await deploy.rollback({ dir: ws.dir })).output).toMatch(/went back/);
    expect(await deploy.current()).toEqual({ version: r1.version, history: [] });
    expect((await deploy.rollback({ dir: ws.dir })).output).toMatch(/first release; it is offline/);
    expect(await deploy.current()).toBeUndefined();
    expect(seen).toEqual([r1.version, undefined]);
  });

  it("a live release that no longer starts fails the rollback check", async () => {
    const { ws, deploy } = await setup();
    const s1 = await commit(ws, { "src/a.js": "1" });
    const r1 = req(ws, 1, s1);
    await deploy.promote({ ...r1, preview: await deploy.preview(r1) });
    await deploy.stop();
    await writeFile(join(deploy.releaseDir(r1.version), "start-fail"), "");
    const v = await deploy.verifyRollback({ dir: ws.dir });
    expect(v.ok).toBe(false);
    expect(v.output).toMatch(/no longer starts/);
  });

  it("stores settings in a private file, counts them as present, and starts the app with them", async () => {
    const { projectDir, ws, deploy } = await setup();
    const sha = await commit(ws, { "needs-setting": "FAMILY_PASSCODE", ".env.example": "# The passcode the family types\nFAMILY_PASSCODE=\n" });
    expect(await deploy.missingSettings(ws.dir)).toEqual([{ name: "FAMILY_PASSCODE", note: "The passcode the family types", kind: "ask" }]);
    const r = req(ws, 1, sha);
    expect((await deploy.preview(r)).ok).toBe(false);
    expect((await deploy.setSettings(ws.dir, { FAMILY_PASSCODE: "plum-tree-42" })).output).not.toMatch(/plum-tree/);
    const { stat: statFile } = await import("node:fs/promises");
    expect((await statFile(join(projectDir, "run", "settings.json"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(projectDir, ".gitignore"), "utf8")).toMatch(/^run\/$/m);
    expect(await deploy.missingSettings(ws.dir)).toEqual([]);
    const p = await deploy.preview({ ...r, key: "k2" });
    expect(p.ok, p.output).toBe(true);
  });

  it("a profile's local defaults (a database file) are never asked for on this computer and reach the app", async () => {
    const { projectDir, ws } = await setup();
    const profile = { ...fixture, localSettings: { DATABASE_URL: "file:./data/app.db" } };
    const d = new LocalDeploy({ projectDir, profile, healthTimeoutMs: 10_000 });
    started.push(d);
    const sha = await commit(ws, { ".env.example": "# karigor: service turso\nDATABASE_URL=\n", "needs-setting": "DATABASE_URL" });
    expect(await d.missingSettings(ws.dir)).toEqual([]);
    expect((await d.preview(req(ws, 1, sha))).ok).toBe(true);
  });

  it("every release uses the project's one database, so an update keeps the data (and the build migrates it)", async () => {
    const { projectDir, ws } = await setup();
    // the "build" appends to the database file the release will use, like a migration
    const build = ["node", "-e", "const f=process.env.DATABASE_URL.slice(5);require('fs').appendFileSync(f,'migrated\\n')"];
    const profile = { ...fixture, commands: { ...fixture.commands, build }, localSettings: { DATABASE_URL: "file:./data/app.db" } };
    const d = new LocalDeploy({ projectDir, profile, healthTimeoutMs: 10_000 });
    started.push(d);
    expect((await d.settingsEnv())["DATABASE_URL"]).toBe(`file:${join(projectDir, "data", "app.db")}`);
    // the target tells the app its own address; nobody is asked for it
    expect((await d.settingsEnv())["SITE_URL"]).toBe("http://localhost:3000");
    await commit(ws, { ".env.example": "# Optional: the site's address\n# karigor: ask\nSITE_URL=\n# The teacher's email\nTEACHER_EMAIL=\n" });
    expect((await d.missingSettings(ws.dir)).map((m) => m.name)).toEqual(["TEACHER_EMAIL"]);
    for (let n = 1; n <= 2; n++) {
      const sha = await commit(ws, { "src/a.js": String(n) });
      const r = req(ws, n, sha);
      const p = await d.preview(r);
      expect(p.ok, p.output).toBe(true);
      await d.promote({ ...r, preview: p });
    }
    expect(await readFile(join(projectDir, "data", "app.db"), "utf8")).toBe("migrated\nmigrated\n");
    expect(await readFile(join(projectDir, ".gitignore"), "utf8")).toMatch(/^data\/$/m);
  });

  it("ensure brings a preview back on the same URL after it stopped", async () => {
    const { ws, deploy } = await setup();
    const sha = await commit(ws, { "src/a.js": "1" });
    const r = req(ws, 1, sha);
    const p = await deploy.preview(r);
    await deploy.stop();
    await expect(fetch(p.url!)).rejects.toThrow();
    await deploy.ensure({ url: p.url!, id: p.id! });
    expect((await fetch(`${p.url}/health`)).status).toBe(200);
  });

  it("prunes old releases but keeps the live one and its predecessor", async () => {
    const { ws, deploy } = await setup();
    const versions: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const sha = await commit(ws, { "src/a.js": String(i) });
      const r = req(ws, i, sha);
      versions.push(r.version);
      const p = await deploy.preview(r);
      await deploy.promote({ ...r, preview: p });
      await deploy.stop();
      await new Promise((res) => setTimeout(res, 20));
    }
    const left = (await readdir(deploy.releasesDir)).filter((n) => n.startsWith("r"));
    expect(left.sort()).toEqual(versions.slice(2).sort());
  });
});

describe("VercelDeploy", () => {
  const scripted = (answers: Record<string, { stdout: string; code?: number }>) => {
    const calls: string[][] = [];
    const exec: VercelExec = async (_f, args) => {
      calls.push(args);
      const a = answers[args[0]!] ?? { stdout: "" };
      return { stdout: a.stdout, stderr: "", code: a.code ?? 0 };
    };
    return { calls, exec };
  };
  const okFetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

  it("without a token it uses the CLI's own login, and says how to sign in when that fails", async () => {
    const calls: string[][] = [];
    const d = new VercelDeploy({ project: "toolshare-abc123", token: "", exec: async (_f, args) => (calls.push(args), { stdout: "", stderr: "Error: No existing credentials found. Please run `vercel login`", code: 1 }) });
    const prevToken = process.env["VERCEL_TOKEN"];
    delete process.env["VERCEL_TOKEN"];
    const p = await d.preview({ dir: "/w", version: "r1-abc", commit: "abc", key: "k" });
    if (prevToken !== undefined) process.env["VERCEL_TOKEN"] = prevToken;
    expect(calls[0]).not.toContain("--token");
    expect(p.ok).toBe(false);
    expect(p.output).toMatch(/run `vercel login` once, or set VERCEL_TOKEN/);
  });

  it("promotion waits for the new build, for the domain to point at it, then checks it publicly", async () => {
    process.env["DATABASE_URL"] = "libsql://secret-db.turso.io";
    const newId = "D6aZWDtgxZJq94LEKw5X4GBZsbNR";
    let builds = 0;
    let aliasChecks = 0;
    const calls: string[][] = [];
    const exec: VercelExec = async (_f, args) => {
      calls.push(args);
      if (args[0] === "deploy") return { stdout: "https://toolshare-abc123-k2j3h4g5f-team.vercel.app\n", stderr: "", code: 0 };
      if (args[0] === "promote") return { stdout: "", stderr: `> Successfully created new deployment of toolshare-abc123 at https://vercel.com/team/toolshare-abc123/${newId}\n`, code: 0 };
      if (args[0] === "inspect" && args[1] === newId) {
        const st = ++builds < 3 ? "Building" : "Ready";
        return { stdout: "", stderr: `  General\n\n    id\t\tdpl_${newId}\n    status\t● ${st}\n\n  Aliases\n\n    ╶ https://toolshare-abc123.vercel.app\n    ╶ https://toolshare-abc123-team.vercel.app\n\n  Builds\n`, code: 0 };
      }
      if (args[0] === "inspect") {
        // the domain still points at the old release for a while
        const pointsAt = ++aliasChecks < 2 ? "dpl_OLDOLDOLDOLDOLDOLDOLD" : `dpl_${newId}`;
        return { stdout: "", stderr: `    id\t\t${pointsAt}\n    status\t● Ready\n`, code: 0 };
      }
      return { stdout: "Success!", stderr: "", code: 0 };
    };
    const ok = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const d = new VercelDeploy({ project: "toolshare-abc123", token: "tok-SECRET", exec, fetchImpl: ok, healthPath: "/api/health", pollMs: 1 });
    const r = { dir: "/w", version: "r1-abc1234", commit: "abc1234", key: "k" };
    const p = await d.preview(r);
    expect(p).toMatchObject({ ok: true, url: "https://toolshare-abc123-k2j3h4g5f-team.vercel.app" });
    expect(p.output).not.toMatch(/tok-SECRET|secret-db/);
    expect(calls[0]).toEqual(expect.arrayContaining(["deploy", "/w", "--yes", "--target", "preview", "--project", "toolshare-abc123", "-e", "DATABASE_URL=libsql://secret-db.turso.io", "--token", "tok-SECRET"]));
    expect(calls[0]).toEqual(expect.arrayContaining(["-e", "SITE_URL=https://toolshare-abc123.vercel.app"]));
    const live = await d.promote({ ...r, preview: p });
    expect(live).toMatchObject({ ok: true, url: "https://toolshare-abc123.vercel.app", id: newId });
    expect(builds).toBe(3);
    expect(aliasChecks).toBe(2);
    const liveRel = { url: live.url!, id: live.id!, version: "r1" };
    expect((await d.verifyRollback({ dir: "/w", live: liveRel })).ok).toBe(true);
    expect((await d.rollback({ dir: "/w", live: liveRel })).ok).toBe(true);
    expect(calls.find((c) => c[0] === "rollback")?.slice(0, 2)).toEqual(["rollback", `dpl_${newId}`]);
    expect((await d.rollback({ dir: "/w" })).ok).toBe(false);
    delete process.env["DATABASE_URL"];
  });

  it("settings go in on stdin as sensitive values for production and previews, and a redeploy applies them", async () => {
    const calls: { args: string[]; input?: string }[] = [];
    const id = "NEWNEWNEWNEWNEWNEWNEWNEW";
    const exec: VercelExec = async (_f, args, o) => {
      calls.push({ args, ...(o.input !== undefined ? { input: o.input } : {}) });
      if (args[0] === "redeploy") return { stdout: "", stderr: `> Successfully created new deployment of p at https://vercel.com/t/p/${id}`, code: 0 };
      if (args[0] === "inspect" && args[1] === id) return { stdout: `    id\t\tdpl_${id}\n    status\t● Ready\n\n  Aliases\n\n    ╶ https://p.vercel.app\n\n  Builds\n`, stderr: "", code: 0 };
      if (args[0] === "inspect") return { stdout: `    id\t\tdpl_${id}\n`, stderr: "", code: 0 };
      return { stdout: "Added", stderr: "", code: 0 };
    };
    const ok = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const d = new VercelDeploy({ project: "p", token: "tok-123", exec, fetchImpl: ok, pollMs: 1 });
    const saved = await d.setSettings("/w", { FAMILY_PASSCODE: "plum-tree-42" });
    expect(saved).toEqual({ ok: true, output: "saved on Vercel as sensitive settings: FAMILY_PASSCODE" });
    const adds = calls.filter((c) => c.args[0] === "env");
    expect(adds.map((c) => c.args.slice(0, 4))).toEqual([["env", "add", "FAMILY_PASSCODE", "production"], ["env", "add", "FAMILY_PASSCODE", "preview"]]);
    expect(adds.every((c) => c.input === "plum-tree-42" && !c.args.includes("plum-tree-42") && c.args.includes("--sensitive"))).toBe(true);
    const live = await d.applySettings({ dir: "/w", live: { url: "https://p.vercel.app", id: "OLDOLDOLDOLDOLDOLDOLDOLD", version: "r1" } });
    expect(live).toMatchObject({ ok: true, id, url: "https://p.vercel.app" });
    expect(calls.find((c) => c.args[0] === "redeploy")?.args.slice(0, 4)).toEqual(["redeploy", "dpl_OLDOLDOLDOLDOLDOLDOLDOLD", "--target", "production"]);
  });

  it("a production build that errors fails the promotion", async () => {
    const exec: VercelExec = async (_f, args) =>
      args[0] === "promote" ? { stdout: "at https://vercel.com/t/p/AAAAAAAAAAAAAAAAAAAAAAAA", stderr: "", code: 0 } : { stdout: "    id\t\tdpl_AAAAAAAAAAAAAAAAAAAAAAAA\n    status\t● Error\n", stderr: "", code: 0 };
    const d = new VercelDeploy({ project: "p", token: "tok-123", exec, pollMs: 1 });
    const res = await d.promote({ dir: "/w", version: "r1", commit: "c", key: "k", preview: { ok: true, url: "https://p-x.vercel.app", output: "" } });
    expect(res).toMatchObject({ ok: false, output: expect.stringMatching(/production build failed \(Error\)/) });
  });

  it("production that never answers publicly fails the promotion", async () => {
    const { exec } = scripted({ promote: { stdout: "at https://vercel.com/t/p/AAAAAAAAAAAAAAAAAAAAAAAA" }, inspect: { stdout: "    id\t\tdpl_AAAAAAAAAAAAAAAAAAAAAAAA\n    status\t● Ready\n" } });
    const login = (async () => new Response(null, { status: 302, headers: { location: "https://vercel.com/sso-api?url=x" } })) as unknown as typeof fetch;
    const d = new VercelDeploy({ project: "p", token: "tok-123", exec, fetchImpl: login, productionWaitMs: 0, pollMs: 1 });
    const res = await d.promote({ dir: "/w", version: "r1", commit: "c", key: "k", preview: { ok: true, url: "https://p-x.vercel.app", id: "https://p-x.vercel.app", output: "" } });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/was not live in time \(checking/);
  });

  it("checks protected deployments with the project's bypass secret, read on demand and never shown", async () => {
    const { calls, exec } = scripted({ project: { stdout: '{"protectionBypass":{"BYPASS-SECRET-1234567890":{"scope":"automation-bypass"}}}' } });
    const seen: Record<string, string>[] = [];
    const f = (async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers);
      return init.headers["x-vercel-protection-bypass"] ? new Response("BYPASS-SECRET-1234567890 ok", { status: 200 }) : new Response(null, { status: 302, headers: { location: "https://vercel.com/sso-api?url=x" } });
    }) as unknown as typeof fetch;
    const d = new VercelDeploy({ project: "p", token: "tok-123", exec, fetchImpl: f });
    const r = await d.checkUrl("https://p-x.vercel.app/api/health");
    expect(r.ok).toBe(true);
    expect(r.output).not.toMatch(/BYPASS-SECRET/);
    expect(seen.at(-1)).toEqual({ "x-vercel-protection-bypass": "BYPASS-SECRET-1234567890" });
    await d.checkUrl("https://p-x.vercel.app/");
    expect(calls.filter((c) => c[0] === "project").length).toBe(1);
  });

  it("creates a bypass secret when there is none, waits for it to appear, and does not remember a miss", async () => {
    let reads = 0;
    let enabled = false;
    const exec: VercelExec = async (_f, args) => {
      if (args[2] === "enable") {
        enabled = true;
        return { stdout: "", stderr: "", code: 0 };
      }
      if (args[0] === "project") {
        reads++;
        // the new secret shows up only on the third read after enabling
        const visible = enabled && reads >= 3;
        return { stdout: visible ? '{"protectionBypass":{"NEW-SECRET-0123456789":{"scope":"automation-bypass"}}}' : "{}", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };
    const f = (async (_u: string, init: { headers: Record<string, string> }) =>
      init.headers["x-vercel-protection-bypass"] ? new Response("ok", { status: 200 }) : new Response(null, { status: 302, headers: { location: "https://vercel.com/sso-api" } })) as unknown as typeof fetch;
    const d = new VercelDeploy({ project: "p", token: "tok-123", exec, fetchImpl: f, pollMs: 1 });
    expect((await d.checkUrl("https://p-x.vercel.app/")).ok).toBe(true);
    expect(enabled).toBe(true);
  });

  it("a redirect to Vercel's login is not healthy without a bypass", async () => {
    const { exec } = scripted({ project: { stdout: "{}" } });
    const toLogin = (async () => new Response(null, { status: 302, headers: { location: "https://vercel.com/sso-api?url=x" } })) as unknown as typeof fetch;
    const d = new VercelDeploy({ project: "p", token: "tok-123", exec, fetchImpl: toLogin });
    expect((await d.checkUrl("https://p-x.vercel.app/api/health")).ok).toBe(false);
  });

  it("parses URLs and names projects", () => {
    expect(deploymentUrl('{"deployment":{"url":"a-b.vercel.app"}}')).toBe("https://a-b.vercel.app");
    expect(deploymentUrl("Preview: https://x-1.vercel.app [2s]\nhttps://x-2.vercel.app")).toBe("https://x-2.vercel.app");
    expect(productionUrl("aliased https://x-k2j3h4g5f-t.vercel.app and https://x.vercel.app", "x")).toBe("https://x.vercel.app");
    expect(parseInspect("  General\n\n    id\t\tdpl_abc123\n    status\t● Ready\n\n  Aliases\n\n    ╶ https://x.vercel.app\n\n  Builds\n")).toEqual({ id: "dpl_abc123", status: "Ready", aliases: ["https://x.vercel.app"] });
    expect(productionDeploymentId("created new deployment of x at https://vercel.com/team/x/4mFd6c4V66uCWqj8LhnoUxJvPpW5")).toBe("4mFd6c4V66uCWqj8LhnoUxJvPpW5");
    expect(projectSlug("ToolShare: Neighbours' Tools!", "20261020-abcdef")).toBe("toolshare-neighbours-tools-abcdef");
    expect(projectSlug("A page where my family keeps one shared list", "p-x-01d1")).toBe("a-page-where-my-family-keeps-p-x-01d1".replace("p-x-01d1", "x-01d1"));
  });
});

/** Real install, real Next.js build and start. Run with KARIGOR_REAL_DEPLOY=1; needs the network once. */
describe.runIf(process.env["KARIGOR_REAL_DEPLOY"] === "1")("LocalDeploy (live, web-app profile)", () => {
  it("previews, promotes and verifies the real scaffold", async () => {
    const { webApp } = await import("@karigor/profiles");
    const projectDir = await mkdtemp(join(tmpdir(), "karigor-live-deploy-"));
    const ws = await Workspace.create(join(projectDir, "workspace"), webApp);
    const deploy = new LocalDeploy({ projectDir, profile: webApp, healthTimeoutMs: 120_000 });
    started.push(deploy);
    const sha = await ws.head();
    const r = { dir: ws.dir, version: releaseVersion(1, sha), commit: sha, key: "live" };
    const p = await deploy.preview(r);
    expect(p.ok, p.output.slice(-3000)).toBe(true);
    expect(await (await fetch(`${p.url}/api/health`)).json()).toHaveProperty("status");
    expect((await deploy.promote({ ...r, preview: p })).ok).toBe(true);
    expect((await deploy.verifyRollback({ dir: ws.dir })).ok).toBe(true);
  }, 900_000);

  it("runs the template's browser journeys on a fresh database, at desktop and phone size", async () => {
    const { webApp } = await import("@karigor/profiles");
    const { LocalSandbox } = await import("@karigor/sandbox");
    const projectDir = await mkdtemp(join(tmpdir(), "karigor-live-journeys-"));
    const ws = await Workspace.create(join(projectDir, "workspace"), webApp);
    const j = await new LocalSandbox(ws, webApp).journeys();
    expect(j.available).toBe(true);
    expect(j.failures, j.output.slice(-3000)).toEqual([]);
    expect(j.passed).toBeGreaterThanOrEqual(6);
  }, 900_000);
});
