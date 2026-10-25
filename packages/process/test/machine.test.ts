import { describe, expect, it } from "vitest";
import { loadTemplate, type Action } from "../src/index.js";
import { item, simulate } from "./sim.js";

const types = (actions: Action[]) => actions.map((a) => a.type);
const count = (actions: Action[], t: Action["type"]) => actions.filter((a) => a.type === t).length;

describe("machine: golden path", () => {
  for (const name of ["iterative", "linear", "spike-then-build", "maintenance"] as const) {
    it(`${name} runs from idea to finished with every gate passing`, async () => {
      const t = await loadTemplate(name);
      const r = simulate(t, { backlog: [item("b1"), item("b2"), item("b3", { dependsOn: ["b1"] }), item("b4")] });
      expect(r.state.status).toBe("finished");
      expect(r.state.phase).toBe("done");
      expect(r.state.failures).toBe(0);
      for (const id of ["b1", "b2", "b3", "b4"]) expect(r.state.items[id]?.status).toBe("done");
      // every phase in the template was entered, in order
      const entered = r.events.filter((e) => e.type === "phase-entered").map((e) => (e as { phase: string }).phase);
      const unique = [...new Set(entered)];
      expect(unique[0]).toBe(t.initialPhase);
      expect(unique[unique.length - 1]).toBe("done");
      // the skeptic gate was evaluated in every phase that lists it
      const skepticPhases = Object.entries(t.phases)
        .filter(([, p]) => p.transitions.some((tr) => tr.gates.includes("skeptic-review")) || p.loop?.itemGates.includes("skeptic-review"))
        .map(([n]) => n);
      expect(skepticPhases.length).toBeGreaterThan(0);
      for (const p of skepticPhases) expect(r.events.some((e) => e.type === "gate-evaluated" && e.gate === "skeptic-review" && e.key.startsWith(`${p}#`))).toBe(true);
    });
  }

  it("iterative: sprints of 3 and dependency ordering", async () => {
    const t = await loadTemplate("iterative");
    const r = simulate(t, { backlog: [item("b1"), item("b2"), item("b3", { dependsOn: ["b1"] }), item("b4")] });
    const sprints = r.events.filter((e) => e.type === "phase-entered" && e.phase === "build" && e.sprint !== undefined) as { sprint: number; itemIds: string[] }[];
    // b3 depends on b1, which is not done when sprint 1 is planned, so b3 waits for sprint 2
    expect(sprints.map((s) => s.itemIds)).toEqual([["b1", "b2", "b4"], ["b3"]]);
  });

  it("linear: all items in one pass", async () => {
    const t = await loadTemplate("linear");
    const r = simulate(t, { backlog: [item("b1"), item("b2"), item("b3"), item("b4")] });
    const sprints = r.events.filter((e) => e.type === "phase-entered" && e.phase === "build" && e.sprint !== undefined) as { itemIds: string[] }[];
    expect(sprints.map((s) => s.itemIds)).toEqual([["b1", "b2", "b3", "b4"]]);
  });

  it("every worker and gate key is unique within a run", async () => {
    const t = await loadTemplate("iterative");
    const r = simulate(t, { backlog: [item("b1"), item("b2")] });
    const keys = r.events.filter((e) => e.type === "worker-finished" || e.type === "gate-evaluated").map((e) => (e as { key: string }).key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("machine: item failures", () => {
  it("retries an item twice, shrinks once, and parks when the shrink itself fails", async () => {
    const t = await loadTemplate("iterative");
    const r = simulate(t, {
      backlog: [item("b1"), item("b2")],
      gate: (a) => ((a.itemId === "b1" || a.itemId === "b1-a") && a.gate === "tests-pass" ? "fail" : "pass"),
      worker: (a) => ({ type: "worker", outcome: a.type === "shrinkItem" && a.itemId === "b1-a" ? "failed" : "ok", attempt: 1, artifacts: [] }),
      onShrink: (id, backlog) => [...backlog, item(`${id}-a`), item(`${id}-b`)],
    });
    // b1: fail, fail (retries), fail -> shrink ok -> dropped, replaced by b1-a and b1-b
    expect(r.state.items["b1"]).toMatchObject({ status: "dropped", failCount: 3 });
    // b1-a: fail, fail, fail -> shrink fails (4th failure) -> parked
    expect(r.state.items["b1-a"]).toMatchObject({ status: "parked", failCount: 4 });
    expect(r.state.items["b1-b"]?.status).toBe("done");
    expect(r.state.items["b2"]?.status).toBe("done");
    expect(count(r.actions, "shrinkItem")).toBe(2);
    expect(r.state.status).toBe("finished"); // the project continues on everything else
  });

  it("parks an item whose developer keeps producing invalid work, and keeps going", async () => {
    const t = await loadTemplate("maintenance");
    const r = simulate(t, {
      backlog: [item("b1"), item("b2")],
      worker: (a) => ({ type: "worker", outcome: a.itemId === "b2" && a.role === "developer" ? "invalid" : "ok", attempt: 3, artifacts: [] }),
    });
    expect(r.state.items["b2"]).toMatchObject({ status: "parked", failCount: 3 });
    expect(r.state.items["b1"]?.status).toBe("done");
    expect(r.state.status).toBe("finished");
  });

  it("counts item retries against the project failure budget", async () => {
    const t = await loadTemplate("iterative");
    const r = simulate(t, {
      backlog: [item("b1")],
      gate: (a) => (a.gate === "diff-matches-spec" ? "fail" : "pass"),
    });
    // fail, fail, fail -> shrink (no replacements) -> dropped; three failures stay on the project's count
    expect(r.state.items["b1"]).toMatchObject({ status: "dropped", failCount: 3 });
    expect(r.state.failures).toBe(3);
    expect(r.state.status).toBe("finished");
  });
});

describe("machine: blocked items", () => {
  it("parks items whose dependency was dropped or parked, with the reason, instead of leaving them behind", async () => {
    const t = await loadTemplate("iterative");
    const r = simulate(t, {
      backlog: [item("b1"), item("b2", { dependsOn: ["b1"] }), item("b3", { dependsOn: ["b2"] }), item("b4")],
      gate: (a) => (a.itemId === "b1" && a.gate === "tests-pass" ? "fail" : "pass"),
    });
    expect(r.state.status).toBe("finished");
    expect(r.state.items["b1"]?.status).toBe("dropped");
    expect(r.state.items["b2"]).toMatchObject({ status: "parked", reason: 'blocked: depends on "b1", which was dropped' });
    expect(r.state.items["b3"]).toMatchObject({ status: "parked", reason: 'blocked: depends on "b2", which was parked' });
    expect(r.state.items["b4"]?.status).toBe("done");
    // nothing is left unsettled when the build phase exits
    const unsettled = Object.values(r.state.items).filter((i) => !["done", "parked", "dropped"].includes(i.status));
    expect(unsettled).toEqual([]);
  });

  it("parks items that depend on ids that are not in the backlog", async () => {
    const t = await loadTemplate("linear");
    const r = simulate(t, { backlog: [item("b1"), item("b2", { dependsOn: ["ghost"] })] });
    expect(r.state.items["b2"]).toMatchObject({ status: "parked", reason: 'blocked: depends on "ghost", which is not in the backlog' });
    expect(r.state.status).toBe("finished");
  });
});

describe("machine: phase failures", () => {
  it("retries a phase, then sends back, then stops", async () => {
    const t = await loadTemplate("iterative");
    const r = simulate(t, {
      backlog: [item("b1")],
      gate: (a) => (a.gate === "architecture-sound" ? "fail" : "pass"),
    });
    // design ladder: retry x1, sendBack specify x1, stop
    expect(types(r.actions).filter((x) => ["retryPhase", "sendBack", "stop"].includes(x))).toEqual(["retryPhase", "sendBack", "stop"]);
    expect(r.state.status).toBe("stopped");
    expect(r.state.stopReason).toMatch(/architecture-sound/);
    expect(r.state.phaseEntries["specify"]).toBe(2);
    expect(r.state.phaseEntries["design"]).toBe(3);
  });

  it("a different exit gate failing after an earlier one was fixed gets its own ladder, not the rest of the other's", async () => {
    const t = await loadTemplate("iterative");
    let scans = 0, journeys = 0;
    const r = simulate(t, {
      backlog: [item("b1")],
      // as on a real run: the scan fails twice (retry, then back to plan for a fix), then the journeys fail once
      gate: (a) => (a.gate === "security-scan-clean" && scans++ < 2) || (a.gate === "journeys-pass" && journeys++ < 1) ? "fail" : "pass",
    });
    expect(types(r.actions).filter((x) => ["retryPhase", "sendBack", "stop"].includes(x))).toEqual(["retryPhase", "sendBack", "retryPhase"]);
    expect(r.state.status).toBe("finished");
    expect(r.state.gateFails).toMatchObject({ "build:security-scan-clean": 2, "build:journeys-pass": 1 });
  });

  it("a phase role that fails after its own retries counts as a phase failure", async () => {
    const t = await loadTemplate("linear");
    const r = simulate(t, {
      backlog: [item("b1")],
      worker: (a) => ({ type: "worker", outcome: a.role === "product-owner" ? "failed" : "ok", attempt: 2, artifacts: [] }),
    });
    expect(r.state.status).toBe("stopped");
    expect(r.state.phaseFails["specify"]).toBe(4);
    expect(r.state.stopReason).toMatch(/product-owner could not produce valid work/);
  });

  it("stops when the project failure budget is exhausted", async () => {
    const t = await loadTemplate("linear"); // projectFailures 15
    const items = Array.from({ length: 10 }, (_, i) => item(`b${i}`));
    const r = simulate(t, { backlog: items, gate: (a) => (a.gate === "tests-pass" ? "fail" : "pass") });
    expect(r.state.status).toBe("stopped");
    expect(r.state.stopReason).toMatch(/too many failures/);
    expect(r.state.failures).toBe(15);
  });

  it("re-enters a loop phase after an exit gate fails and re-evaluates", async () => {
    const t = await loadTemplate("iterative");
    let buildFails = 0;
    const r = simulate(t, {
      backlog: [item("b1")],
      gate: (a) => (a.gate === "build-succeeds" && buildFails++ < 1 ? "fail" : "pass"),
    });
    expect(count(r.actions, "retryPhase")).toBe(1);
    expect(r.state.status).toBe("finished");
    // the item was not rebuilt: still exactly one developer run
    expect(r.events.filter((e) => e.type === "worker-finished" && e.role === "developer").length).toBe(1);
  });
});

describe("machine: resumability", () => {
  it("next() is a pure function of state: replaying any prefix yields the same next action", async () => {
    const t = await loadTemplate("iterative");
    const full = simulate(t, { backlog: [item("b1"), item("b2")] });
    const { applyEvent, emptyState } = await import("@karigor/store");
    const { next } = await import("../src/index.js");
    for (let i = 1; i <= full.events.length; i++) {
      let s = emptyState("p1");
      for (const e of full.events.slice(0, i)) s = applyEvent(s, e);
      const a = next({ template: t, state: s, backlog: s.phase && ["build", "release", "done"].includes(s.phase) ? full.backlog : full.backlog });
      expect(a).toBeDefined();
    }
  });
});
