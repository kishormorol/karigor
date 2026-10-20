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
