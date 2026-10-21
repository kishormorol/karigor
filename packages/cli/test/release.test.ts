import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, noopCommitter, type ProjectState } from "@karigor/store";
import { fixture } from "@karigor/profiles";
import { Workspace, run } from "@karigor/sandbox";
import { FakeDeploy, LocalDeploy, type DeployAdapter } from "@karigor/deploy";
import { MockAgent, type AgentRequest } from "@karigor/runtime";
import { createProject, runProject, scriptedAdapter } from "../src/index.js";

const NOW = () => new Date("2026-10-20T00:00:00.000Z");

class Crash extends Error {
  override name = "Crash";
}

/** Implements each item as a file with passing fixture tests; `extra` adds files for chosen items. */
export function devAgent(extra: (itemId: string) => Record<string, string> = () => ({})) {
  return new MockAgent((req: AgentRequest) => {
    const itemId = /"id": "([a-z0-9-]+)"/.exec(req.user)?.[1] ?? "x";
    return { files: { [`src/${itemId}.js`]: `export const v = "${itemId}";\n`, "tests.json": JSON.stringify({ passed: 2, failed: 0, skipped: 0 }), ...extra(itemId) }, summary: `Implemented ${itemId} with tests.` };
  });
}

async function fresh() {
  const root = await mkdtemp(join(tmpdir(), "karigor-release-"));
  const projectId = await createProject(root, "A site where neighbours lend tools", { clock: NOW, committer: noopCommitter, projectId: "p1" });
  return { root, projectId };
}

const opts = (root: string, projectId: string, deploy: DeployAdapter, agent = devAgent(), more: Record<string, unknown> = {}) => ({
  root,
  projectId,
  adapter: scriptedAdapter(),
  profile: fixture,
  agent,
  deploy,
  clock: NOW,
  committer: noopCommitter,
  ...more,
});

const local = (root: string, projectId: string) => new LocalDeploy({ projectDir: join(root, projectId), profile: fixture, healthTimeoutMs: 10_000 });

async function records(root: string, projectId: string, state: ProjectState) {
  const store = await FsStore.open(root, projectId, { committer: noopCommitter });
  return Promise.all((state.artifacts["deploy-record"] ?? []).map(async (id) => (await store.readArtifact("deploy-record", id)).meta));
}

describe("release: deploy, verify, promote", { timeout: 120_000 }, () => {
  it("on the local target, the build is previewed, checked, promoted and linked from the summary", async () => {
    const { root, projectId } = await fresh();
    const deploy = local(root, projectId);
    const state = await runProject(opts(root, projectId, deploy));
    expect(state.status, state.stopReason).toBe("finished");
    const recs = await records(root, projectId, state);
    expect(recs.map((r) => `${r.environment}:${r.status}`)).toEqual(["preview:deployed", "production:deployed"]);
    const [preview, prod] = recs;
    expect(preview!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(prod).toMatchObject({ target: "local", url: "http://localhost:3000", version: preview!.version, key: `promote:${state.artifacts["deploy-record"]![0]}` });
    expect(prod!.version).toMatch(/^r1-[0-9a-f]{7}$/);
    expect(await deploy.current()).toEqual({ version: prod!.version, history: [] });
    // the preview server is stopped when the run ends
    await expect(fetch(preview!.url!)).rejects.toThrow();
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    const summary = await store.readArtifact("summary", state.artifacts.summary!.at(-1)!);
    expect(summary.meta.url).toBe("http://localhost:3000");
    expect(summary.body).toMatch(/karigor serve/);
    const ws = await Workspace.open(join(root, projectId, "workspace"));
    const tags = await run("git", ["tag"], { cwd: ws.dir });
    expect(tags.stdout).toMatch(new RegExp(`karigor-release-${prod!.version}`));
    // the rollback gate went to the deploy target
    const gates = await Promise.all((state.artifacts["gate-result"] ?? []).map((id) => store.readArtifact("gate-result", id)));
    const rb = gates.find((g) => g.meta.gate === "rollback-verified")!;
    expect(JSON.stringify(rb.meta.evidence)).toMatch(/first release/);
  });

  it("a release that needs the person's own settings waits for them, then carries on; no value enters the log", async () => {
    const { root, projectId } = await fresh();
    const deploy = local(root, projectId);
    const env = "# Signs the remember-me cookie\n# karigor: generate\nSESSION_SECRET=\n# The passcode the family types once on each phone\n# karigor: ask\nFAMILY_PASSCODE=\n";
    // the app cannot answer its health check without both
    const agent = devAgent((id) => (id === "b1" ? { ".env.example": env, "needs-setting": "SESSION_SECRET FAMILY_PASSCODE" } : {}));
    const state = await runProject(opts(root, projectId, deploy, agent));
    expect(state.status, state.stopReason).toBe("waiting");
    expect(state.waitingFor).toEqual(["FAMILY_PASSCODE"]);
    expect(state.settingsProvided).toEqual(["SESSION_SECRET"]);
    expect(state.artifacts["deploy-record"]).toBeUndefined();
    const { provideSettings, renderStatus, renderExplain } = await import("../src/index.js");
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    expect(await renderStatus(store, state)).toMatch(/waiting for you[\s\S]*FAMILY_PASSCODE[\s\S]*karigor setup/);
    await expect(provideSettings({ store, deploy, values: { NOT_A_SETTING: "x" } })).rejects.toThrow(/no setting called NOT_A_SETTING/);
    const r = await provideSettings({ store, deploy, values: { FAMILY_PASSCODE: "plum-tree-42" } });
    expect(r).toMatchObject({ stored: ["FAMILY_PASSCODE"], stillMissing: [], resumed: true });
    const after = await runProject(opts(root, projectId, deploy, agent));
    expect(after.status, after.stopReason).toBe("finished");
    expect(after.settingsProvided).toEqual(["SESSION_SECRET", "FAMILY_PASSCODE"]);
    const prod = (await records(root, projectId, after)).at(-1)!;
    expect(prod).toMatchObject({ environment: "production", status: "deployed" });
    expect(prod.missingSettings).toBeUndefined();
    expect(await renderExplain(store, await store.readEvents())).toMatch(/Made and stored the setting SESSION_SECRET[\s\S]*Waiting for you to give: FAMILY_PASSCODE[\s\S]*Stored the setting FAMILY_PASSCODE[\s\S]*Carrying on/);
    // values live only in the private settings file
    const saved = JSON.parse(await readFile(join(root, projectId, "run", "settings.json"), "utf8")) as Record<string, string>;
    expect(saved["FAMILY_PASSCODE"]).toBe("plum-tree-42");
    const { run: sh } = await import("@karigor/sandbox");
    const grep = await sh("grep", ["-rl", "--exclude-dir=run", "--exclude-dir=releases", "--exclude-dir=workspace", "-e", "plum-tree-42", "-e", saved["SESSION_SECRET"]!, "."], { cwd: join(root, projectId) });
    expect(grep.stdout).toBe("");
  });

  it("when the model's allowance runs out mid-build the project pauses, counts nothing as failed, and finishes on resume", async () => {
    const { QuotaError } = await import("@karigor/runtime");
    const { root, projectId } = await fresh();
    let limited = true;
    const agent = new MockAgent((req: AgentRequest) => {
      const itemId = /"id": "([a-z0-9-]+)"/.exec(req.user)?.[1] ?? "x";
      if (itemId === "b2" && limited) throw new QuotaError("You've hit your weekly limit · resets Oct 26 at 1pm", "Oct 26 at 1pm");
      return { files: { [`src/${itemId}.js`]: `export const v = "${itemId}";\n`, "tests.json": JSON.stringify({ passed: 2, failed: 0, skipped: 0 }) }, summary: `Implemented ${itemId}.` };
    });
    const paused = await runProject(opts(root, projectId, new FakeDeploy(), agent));
    expect(paused.status).toBe("waiting");
    expect(paused.pausedReason).toMatch(/usage allowance is used up \(it resets Oct 26 at 1pm\)/);
    expect(paused.failures).toBe(0);
    expect(Object.values(paused.items).some((i) => i.status === "parked")).toBe(false);
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    const { renderStatus } = await import("../src/index.js");
    expect(await renderStatus(store, paused)).toMatch(/Status: paused\. The model's usage allowance is used up/);
    limited = false;
    const done = await runProject(opts(root, projectId, new FakeDeploy(), agent));
    expect(done.status, done.stopReason).toBe("finished");
    for (const id of ["b1", "b2", "b3"]) expect(done.items[id]?.status).toBe("done");
  });

  it("reopen puts a stopped project's parked work back, with fresh retries, and it carries on to release", async () => {
    const { root, projectId } = await fresh();
    // b3 never changes anything, so it is shrunk and its replacement parked; then going live fails, so the project stops
    const stuck = new MockAgent((req: AgentRequest) => {
      const itemId = /"id": "([a-z0-9-]+)"/.exec(req.user)?.[1] ?? "x";
      if (itemId.startsWith("b3")) return { summary: "Nothing to do." };
      return { files: { [`src/${itemId}.js`]: `export const v = "${itemId}";\n`, "tests.json": JSON.stringify({ passed: 2, failed: 0, skipped: 0 }) }, summary: `Implemented ${itemId}.` };
    });
    const noShrink: Parameters<typeof scriptedAdapter>[0] = { override: (req) => (req.role === "planner" && req.user.includes("SHRINK this item") ? { items: [], notes: "" } : undefined) };
    const stopped = await runProject({ ...opts(root, projectId, new FakeDeploy({ promote: () => ({ ok: false, output: "502" }) }), stuck), adapter: scriptedAdapter(noShrink) });
    expect(stopped.status).toBe("stopped");
    expect(stopped.items["b3"]?.status).toBe("parked");
    const { reopenProject } = await import("../src/index.js");
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    expect(await reopenProject(store)).toEqual(["b3"]);
    const again = await runProject(opts(root, projectId, new FakeDeploy(), devAgent()));
    expect(again.status, again.stopReason).toBe("finished");
    expect(again.items["b3"]).toMatchObject({ status: "done" });
    await expect(reopenProject(store)).rejects.toThrow(/only a stopped project/);
  });

  it("a release whose health check fails is never promoted; the ladder retries and stops with the reason", async () => {
    const { root, projectId } = await fresh();
    const deploy = local(root, projectId);
    const state = await runProject(opts(root, projectId, deploy, devAgent((id) => (id === "b2" ? { "health-fail": "" } : {}))));
    expect(state.status).toBe("stopped");
    expect(state.stopReason).toMatch(/preview-healthy/);
    const recs = await records(root, projectId, state);
    expect(recs.every((r) => r.environment === "preview" && r.status === "failed")).toBe(true);
    expect(recs.length).toBe(3);
    expect(await deploy.current()).toBeUndefined();
    expect(await readFile(join(root, projectId, "artifacts", "deploy-record", `${state.artifacts["deploy-record"]![0]}.md`), "utf8")).toMatch(/answered 500/);
    // the failed release is work for a fix round
    const [wid] = Object.keys(state.workItems);
    expect(state.workItems[wid!]).toMatchObject({ status: "todo", severity: "high" });
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    const w = await store.readArtifact("work-item", wid!);
    expect(w.meta).toMatchObject({ source: "error", fingerprint: `release:${recs[0]!.version}` });
    expect(w.meta.description).toMatch(/preview-healthy[\s\S]*answered 500/);
    const { canStartMaintenance } = await import("../src/index.js");
    expect(canStartMaintenance(state)).toBe(true);
  });

  it("a promotion that fails goes back, files a critical work item, and stops plainly", async () => {
    const { root, projectId } = await fresh();
    const deploy = new FakeDeploy({ promote: () => ({ ok: false, output: "production answered 502" }) });
    const state = await runProject(opts(root, projectId, deploy));
    expect(state.status).toBe("stopped");
    expect(state.stopReason).toMatch(/failed after going live; it was taken offline and a fix is queued/);
    expect(deploy.calls.filter((c) => c.startsWith("rollback"))).toEqual(["rollback:offline"]);
    const recs = await records(root, projectId, state);
    expect(recs.at(-1)).toMatchObject({ environment: "production", status: "rolled-back" });
    const [wid] = Object.keys(state.workItems);
    expect(state.workItems[wid!]).toMatchObject({ status: "todo", severity: "critical" });
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    expect((await store.readArtifact("work-item", wid!)).meta.description).toMatch(/502/);
  });

  it("survives a crash at any event of the release: one production record, same end state", async () => {
    const reference = await (async () => {
      const { root, projectId } = await fresh();
      const state = await runProject(opts(root, projectId, new FakeDeploy()));
      const store = await FsStore.open(root, projectId, { committer: noopCommitter });
      return { state, events: await store.readEvents() };
    })();
    const total = reference.events.length;
    const releaseStart = reference.events.findIndex((e) => e.type === "phase-entered" && e.phase === "release");
    const shape = (s: ProjectState) => ({ status: s.status, items: s.items, phaseEntries: s.phaseEntries });
    for (let n = releaseStart; n < total; n++) {
      const { root, projectId } = await fresh();
      let count = 0;
      await expect(runProject(opts(root, projectId, new FakeDeploy(), devAgent(), { onEvent: () => { if (++count === n) throw new Crash(`at ${n}`); } }))).rejects.toThrow(Crash);
      const deploy = new FakeDeploy();
      const resumed = await runProject(opts(root, projectId, deploy));
      expect(shape(resumed), `crash at ${n}`).toEqual(shape(reference.state));
      const recs = await records(root, projectId, resumed);
      expect(recs.filter((r) => r.environment === "production").length, `crash at ${n}`).toBe(1);
    }
  }, 240_000);
});
