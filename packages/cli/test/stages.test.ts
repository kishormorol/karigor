import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, noopCommitter } from "@karigor/store";
import { fixture } from "@karigor/profiles";
import { LocalDeploy } from "@karigor/deploy";
import { MockAgent, type AgentRequest, type ModelRequest } from "@karigor/runtime";
import { answerFor, createProject, feedbackSignal, growOnce, recordSignals, renderStatus, runProject, scriptedAdapter, stagePlan } from "../src/index.js";

const NOW = () => new Date("2026-10-22T00:00:00.000Z");

function devAgent() {
  return new MockAgent((req: AgentRequest) => {
    const itemId = /"id": "([a-z0-9-]+)"/.exec(req.user)?.[1] ?? "x";
    return { files: { [`src/${itemId}.js`]: `export const v = "${itemId}";\n`, "tests.json": JSON.stringify({ passed: 2, failed: 0, skipped: 0 }) }, summary: `Implemented ${itemId} with tests.` };
  });
}

/** A product owner that plans three stages; every other role answers as the demo does. */
function threeStages(seen: Record<string, string[]> = {}) {
  return scriptedAdapter({
    override: (req: ModelRequest<unknown>) => {
      (seen[req.role] ??= []).push(req.user);
      if (req.role !== "product-owner") return undefined;
      const spec = answerFor(req, 1) as Record<string, unknown>;
      return {
        ...spec,
        features: [
          { id: "f1", name: "List a tool", description: "Add a tool", priority: "must" },
          { id: "f2", name: "Ask to borrow", description: "Request a tool", priority: "must" },
          { id: "f3", name: "Reports", description: "Who borrowed what", priority: "should" },
        ],
        stages: [
          { id: "listing", name: "Listing tools", goal: "Neighbours list their tools", featureIds: ["f1"] },
          { id: "borrowing", name: "Borrowing", goal: "Neighbours ask to borrow a tool", featureIds: ["f2"] },
          { id: "reports", name: "Reports", goal: "See who borrowed what", featureIds: ["f3"] },
        ],
      };
    },
  });
}

async function firstBuild(seen: Record<string, string[]> = {}) {
  const root = await mkdtemp(join(tmpdir(), "karigor-stages-"));
  const projectId = await createProject(root, "A site where neighbours lend tools, with borrowing and reports", { clock: NOW, committer: noopCommitter, projectId: "p1" });
  const deploy = new LocalDeploy({ projectDir: join(root, projectId), profile: fixture, healthTimeoutMs: 10_000 });
  const base = { root, projectId, adapter: threeStages(seen), profile: fixture, agent: devAgent(), deploy, clock: NOW, committer: noopCommitter };
  const state = await runProject(base);
  expect(state.status).toBe("finished");
  return { root, projectId, deploy, base, store: await FsStore.open(root, projectId, { committer: noopCommitter }) };
}

describe("stages", { timeout: 120_000 }, () => {
  it("the first build plans only the first stage, and grow builds the rest one at a time on top of what is live", async () => {
    const seen: Record<string, string[]> = {};
    const { base, store, deploy } = await firstBuild(seen);
    // The first build's planner was told to plan the first stage only.
    expect(seen.planner?.[0]).toMatch(/Plan only the stage marked BUILDING NOW: \*\*Listing tools\*\*/);
    expect(seen.planner?.[0]).toMatch(/Borrowing.*later/);
    let state = await store.replay();
    expect(state.firstBuilt).toBe(true);
    let plan = await stagePlan(store, state);
    expect([...plan.built]).toEqual(["listing"]);
    expect(plan.next?.id).toBe("borrowing");
    expect(await renderStatus(store, state)).toMatch(/\[built\] +Listing tools[\s\S]*\[later\] +Borrowing[\s\S]*karigor grow p1/);

    // Feedback left before growing is taken on by the stage.
    await recordSignals(store, [feedbackSignal("Show the owner's street")], NOW);
    const r = await growOnce({ ...base, adapter: threeStages(seen) });
    expect(r.stage?.id).toBe("borrowing");
    expect(r.state.status).toBe("finished");
    expect(r.state.template).toBe("stage");
    expect(r.state.stagesBuilt).toEqual(["borrowing"]);
    expect(Object.values(r.state.workItems).every((w) => w.status === "done")).toBe(true);
    // The stage's architect revised the architecture it was shown; its planner planned this stage and the feedback.
    const architect = seen.architect!.at(-1)!;
    expect(architect).toMatch(/The architecture so far/);
    const planner = seen.planner!.at(-1)!;
    expect(planner).toMatch(/BUILDING NOW: \*\*Borrowing\*\*/);
    expect(planner).toMatch(/Listing tools.*built and live/);
    expect(planner).toMatch(/Show the owner's street/);
    expect(planner).toMatch(/Already built in earlier releases/);
    // Its items never collide with the first build's, and a second release went live.
    expect(Object.keys(r.state.items)).toEqual(expect.arrayContaining(["b1", "m1-b1"]));
    expect((await deploy.current())?.version).toMatch(/^r2-/);
    // Its own budget slice.
    const ledger = await store.readArtifact("cost-ledger", r.state.ledgerId!);
    expect(Object.keys(ledger.meta.phaseBudgets)).toEqual(expect.arrayContaining(["m1:design", "m1:plan", "m1:build", "m1:release"]));
    expect(await renderStatus(store, r.state)).toMatch(/a stage was added \(round 1\)/);

    // The third stage, then nothing left.
    const r3 = await growOnce({ ...base, adapter: threeStages(seen) });
    expect(r3.stage?.id).toBe("reports");
    expect(r3.state.stagesBuilt).toEqual(["borrowing", "reports"]);
    // Everything built so far is context for the last stage's planner, not just the previous round.
    expect(seen.planner!.at(-1)).toMatch(/Already built[\s\S]*- (?:.|\n)*- /);
    const none = await growOnce({ ...base, adapter: threeStages(seen) });
    expect(none.stage).toBeUndefined();
    expect(none.why).toMatch(/Every stage of the plan is built/);
    state = await store.replay();
    plan = await stagePlan(store, state);
    expect(plan.next).toBeUndefined();
  });

  it("a fix round after a stage plans fixes, not stages", async () => {
    const seen: Record<string, string[]> = {};
    const { base, store } = await firstBuild(seen);
    await growOnce({ ...base, adapter: threeStages(seen) });
    const { operateOnce } = await import("../src/index.js");
    const r = await operateOnce({ ...base, adapter: threeStages(seen), signals: [feedbackSignal("The borrow button is too small")] });
    expect(r.state.template).toBe("maintenance");
    expect(r.state.stage).toBeUndefined();
    expect(seen.planner!.at(-1)).not.toMatch(/BUILDING NOW/);
    // The next grow still knows which stage is next.
    expect((await stagePlan(store, r.state)).next?.id).toBe("reports");
  });

  it("grow says plainly why it cannot start", async () => {
    const root = await mkdtemp(join(tmpdir(), "karigor-stages-"));
    const projectId = await createProject(root, "idea", { clock: NOW, committer: noopCommitter, projectId: "p1" });
    const r = await growOnce({ root, projectId, adapter: scriptedAdapter(), clock: NOW, committer: noopCommitter });
    expect(r.stage).toBeUndefined();
    expect(r.why).toMatch(/first version is not built yet/);
  });

  it("a one-stage plan has nothing more to grow", async () => {
    const { base } = await firstBuild();
    const root = await mkdtemp(join(tmpdir(), "karigor-stages-"));
    const projectId = await createProject(root, "idea", { clock: NOW, committer: noopCommitter, projectId: "p2" });
    const deploy = new LocalDeploy({ projectDir: join(root, projectId), profile: fixture, healthTimeoutMs: 10_000 });
    const old = scriptedAdapter({
      override: (req) => {
        if (req.role !== "product-owner") return undefined;
        const { stages: _s, ...rest } = answerFor(req, 1) as Record<string, unknown>;
        return { ...rest, stages: [{ id: "all", name: "Everything", goal: "The whole idea", featureIds: ["f1"] }] };
      },
    });
    const state = await runProject({ ...base, root, projectId, adapter: old, deploy });
    expect(state.status).toBe("finished");
    const r = await growOnce({ ...base, root, projectId, adapter: old, deploy });
    expect(r.why).toMatch(/Every stage of the plan is built/);
  });
});
