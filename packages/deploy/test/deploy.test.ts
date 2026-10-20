import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixture } from "@karigor/profiles";
import { Workspace } from "@karigor/sandbox";
import { LocalDeploy, VercelDeploy, deploymentUrl, productionUrl, projectSlug, releaseVersion, type VercelExec } from "../src/index.js";

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

  it("refuses plainly without a token", async () => {
    const d = new VercelDeploy({ project: "toolshare-abc123", token: "", exec: async () => ({ stdout: "", stderr: "", code: 0 }) });
    const prevToken = process.env["VERCEL_TOKEN"];
    delete process.env["VERCEL_TOKEN"];
    const p = await d.preview({ dir: "/w", version: "r1-abc", commit: "abc", key: "k" });
    if (prevToken !== undefined) process.env["VERCEL_TOKEN"] = prevToken;
    expect(p.ok).toBe(false);
    expect(p.output).toMatch(/VERCEL_TOKEN is not set/);
  });

  it("deploys, promotes and rolls back with the token masked and env passed by name", async () => {
    process.env["DATABASE_URL"] = "libsql://secret-db.turso.io";
    const { calls, exec } = scripted({
      deploy: { stdout: "Vercel CLI\nhttps://toolshare-abc123-k2j3h4g5f-team.vercel.app\n" },
      promote: { stdout: "Success! https://toolshare-abc123.vercel.app now points to the deployment\n" },
      rollback: { stdout: "Success!" },
    });
    const d = new VercelDeploy({ project: "toolshare-abc123", token: "tok-SECRET", exec, fetchImpl: okFetch, healthPath: "/api/health" });
    const r = { dir: "/w", version: "r1-abc1234", commit: "abc1234", key: "k" };
    const p = await d.preview(r);
    expect(p).toMatchObject({ ok: true, url: "https://toolshare-abc123-k2j3h4g5f-team.vercel.app" });
    expect(p.output).not.toMatch(/tok-SECRET|secret-db/);
    expect(calls[0]).toEqual(expect.arrayContaining(["deploy", "/w", "--yes", "--project", "toolshare-abc123", "-e", "DATABASE_URL=libsql://secret-db.turso.io", "--token", "tok-SECRET"]));
    const live = await d.promote({ ...r, preview: p });
    expect(live).toMatchObject({ ok: true, url: "https://toolshare-abc123.vercel.app" });
    expect((await d.rollback({ dir: "/w", live: { url: "https://x.vercel.app", id: "https://old.vercel.app", version: "r0" } })).ok).toBe(true);
    expect(calls[2]?.slice(0, 2)).toEqual(["rollback", "https://old.vercel.app"]);
    expect((await d.rollback({ dir: "/w" })).ok).toBe(false);
    delete process.env["DATABASE_URL"];
  });

  it("checks protected previews through vercel curl", async () => {
    const { calls, exec } = scripted({ curl: { stdout: '{"status":"ok"}' } });
    const denied = (async () => new Response("login", { status: 401 })) as unknown as typeof fetch;
    const d = new VercelDeploy({ project: "p", token: "t", exec, fetchImpl: denied });
    const r = await d.checkUrl("https://p-x.vercel.app/api/health");
    expect(r.ok).toBe(true);
    expect(calls[0]?.slice(0, 4)).toEqual(["curl", "/api/health", "--deployment", "https://p-x.vercel.app"]);
  });

  it("parses URLs and names projects", () => {
    expect(deploymentUrl('{"deployment":{"url":"a-b.vercel.app"}}')).toBe("https://a-b.vercel.app");
    expect(deploymentUrl("Preview: https://x-1.vercel.app [2s]\nhttps://x-2.vercel.app")).toBe("https://x-2.vercel.app");
    expect(productionUrl("aliased https://x-k2j3h4g5f-t.vercel.app and https://x.vercel.app", "x")).toBe("https://x.vercel.app");
    expect(projectSlug("ToolShare: Neighbours' Tools!", "20261020-abcdef")).toBe("toolshare-neighbours-tools-abcdef");
  });
});
