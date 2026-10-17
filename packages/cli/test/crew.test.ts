import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, noopCommitter, type Event, type ProjectState } from "@karigor/store";
import { fixture } from "@karigor/profiles";
import { Workspace } from "@karigor/sandbox";
import { MockAgent, type AgentRequest } from "@karigor/runtime";
import { createProject, runProject, scriptedAdapter, type ScriptOptions } from "../src/index.js";

const NOW = () => new Date("2026-10-17T00:00:00.000Z");

class Crash extends Error {
  override name = "Crash";
}

/** A developer that implements each item as a file and keeps the fixture tests green, with hooks. */
function devAgent(hooks: { failTestsFor?: (itemId: string, round: number) => boolean; noChangeFor?: (itemId: string) => boolean } = {}) {
  return new MockAgent((req: AgentRequest) => {
    const itemId = /"id": "([a-z0-9-]+)"/.exec(req.user)?.[1] ?? "x";
    const round = Number(/@(\d+)$/.exec(req.key)?.[1] ?? "0");
    if (hooks.noChangeFor?.(itemId)) return { summary: "Nothing to do." };
    const failing = hooks.failTestsFor?.(itemId, round) ?? false;
    return {
      files: { [`src/${itemId}.js`]: `export const ${itemId.replace(/-/g, "_")} = "${round}";\n`, "tests.json": JSON.stringify({ passed: 2, failed: failing ? 1 : 0, skipped: 0 }) },
      summary: `Implemented ${itemId} with tests.`,
    };
  });
}

async function fresh() {
  const root = await mkdtemp(join(tmpdir(), "karigor-crew-"));
  const projectId = await createProject(root, "A site where neighbours lend tools", { clock: NOW, committer: noopCommitter, projectId: "p1" });
  return { root, projectId };
}

const opts = (root: string, projectId: string, agent: MockAgent, more: Record<string, unknown> = {}, script: ScriptOptions = {}) => ({
  root,
  projectId,
  adapter: scriptedAdapter({ deployUrl: null, ...script }),
  profile: fixture,
  agent,
  clock: NOW,
  committer: noopCommitter,
  ...more,
});

describe("build crew: real workspace with a scripted agent", { timeout: 120_000 }, () => {
  it("items land as commits in the workspace, change artifacts carry the commit, and the run stops honestly at release", async () => {
    const { root, projectId } = await fresh();
    const agent = devAgent();
    const state = await runProject(opts(root, projectId, agent));
    expect(state.status).toBe("stopped");
    expect(state.stopReason).toMatch(/preview-healthy|rollback-verified/);
    for (const id of ["b1", "b2", "b3"]) expect(state.items[id]?.status).toBe("done");
    const ws = await Workspace.open(join(root, projectId, "workspace"));
    for (const id of ["b1", "b2", "b3"]) {
      expect((await ws.itemCommits(id)).length, id).toBe(1);
      await expect(readFile(join(ws.dir, `src/${id}.js`), "utf8")).resolves.toMatch(new RegExp(id.replace(/-/g, "_")));
    }
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    const changes = await Promise.all((state.artifacts.change ?? []).map((id) => store.readArtifact("change", id)));
    expect(changes.map((c) => c.meta.itemId).sort()).toEqual(["b1", "b2", "b3"]);
    for (const c of changes) {
      expect(c.meta.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(c.body).toMatch(/\+export const/);
    }
    // the real test gate ran the fixture suite and wrote reports
    const reports = await Promise.all((state.artifacts["test-report"] ?? []).map((id) => store.readArtifact("test-report", id)));
    expect(reports.length).toBeGreaterThanOrEqual(3);
    expect(reports.every((r) => r.meta.suite === "fixture")).toBe(true);
    // the architect and planner saw the stack guide
    expect(agent.calls.length).toBe(3);
  });

  it("a failing real test sends the item round with the gate's output as feedback, and the fix lands", async () => {
    const { root, projectId } = await fresh();
    const agent = devAgent({ failTestsFor: (id, round) => id === "b2" && round === 0 });
    const state = await runProject(opts(root, projectId, agent));
    expect(state.items["b2"]).toMatchObject({ status: "done", failCount: 1 });
    const second = agent.calls.find((c) => c.key.endsWith(":b2@1"));
    expect(second?.user).toMatch(/tests-pass: 1 test\(s\) failed/);
    expect(second?.user).toMatch(/Your previous change \(revise this\)/);
    const ws = await Workspace.open(join(root, projectId, "workspace"));
    expect((await ws.itemCommits("b2")).length).toBe(2);
    expect(await readFile(join(ws.dir, "src/b2.js"), "utf8")).toMatch(/"1"/);
  });

  it("a dropped item's commits are reverted so its half-done work does not ship", async () => {
    const { root, projectId } = await fresh();
    const agent = devAgent({ failTestsFor: (id) => id === "b3" });
    const state = await runProject(opts(root, projectId, agent));
    expect(state.items["b3"]).toMatchObject({ status: "dropped", failCount: 3 });
    expect(state.items["b3-a"]?.status).toBe("done");
    const ws = await Workspace.open(join(root, projectId, "workspace"));
    await expect(readFile(join(ws.dir, "src/b3.js"))).rejects.toThrow();
    await expect(readFile(join(ws.dir, "src/b3-a.js"), "utf8")).resolves.toMatch(/b3_a/);
    const log = await ws.itemCommits("b3");
    expect(log.length).toBe(4); // three attempts + the revert
  });

  it("a developer that changes nothing walks the ladder and the project still finishes building", async () => {
    const { root, projectId } = await fresh();
    const agent = devAgent({ noChangeFor: (id) => id.startsWith("b1") });
    // the replacement item cannot be shrunk any further, so it is parked
    const shrinkFails: ScriptOptions["override"] = (req) =>
      req.role === "planner" && req.user.split("SHRINK this item")[1]?.includes('"id": "b1-a"') ? { items: [], notes: "" } : undefined;
    const state = await runProject(opts(root, projectId, agent, {}, { override: shrinkFails }));
    expect(state.items["b1"]).toMatchObject({ status: "dropped", failCount: 3 });
    expect(state.items["b1-a"]).toMatchObject({ status: "parked", failCount: 4 });
    expect(state.items["b1-b"]?.status).toBe("done");
    expect(state.items["b2"]?.status).toBe("done");
  });

  it("survives a crash at any event: same end state, exactly one commit per finished item, no double billing", async () => {
    const reference = await (async () => {
      const { root, projectId } = await fresh();
      const state = await runProject(opts(root, projectId, devAgent()));
      const store = await FsStore.open(root, projectId, { committer: noopCommitter });
      return { state, events: await store.readEvents() };
    })();
    const total = reference.events.length;
    const shape = (s: ProjectState) => ({ status: s.status, items: s.items, phaseEntries: s.phaseEntries });
    const points = [...new Set([1, 5, ...Array.from({ length: total }, (_, i) => i).filter((i) => i % 7 === 0), total - 3, total - 1])].filter((n) => n > 0 && n < total);
    for (const n of points) {
      const { root, projectId } = await fresh();
      let count = 0;
      await expect(runProject(opts(root, projectId, devAgent(), { onEvent: () => { if (++count === n) throw new Crash(`at ${n}`); } }))).rejects.toThrow(Crash);
      const resumed = await runProject(opts(root, projectId, devAgent()));
      expect(shape(resumed), `crash at ${n}`).toEqual(shape(reference.state));
      const ws = await Workspace.open(join(root, projectId, "workspace"));
      for (const id of ["b1", "b2", "b3"]) expect((await ws.itemCommits(id)).length, `crash at ${n}, ${id}`).toBe(1);
      const store = await FsStore.open(root, projectId, { committer: noopCommitter });
      const ledger = await store.readArtifact("cost-ledger", resumed.ledgerId!);
      const keys = ledger.meta.entries.map((e: { idempotencyKey: string }) => e.idempotencyKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  }, 180_000);
});

void ((e: Event) => e);
