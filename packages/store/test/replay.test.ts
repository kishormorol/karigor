import { describe, expect, it } from "vitest";
import { replay, type Event } from "../src/index.js";

const at = "2026-10-16T20:00:00.000Z";
let n = 0;
const ev = (e: Omit<Event, "seq" | "at">): Event => ({ ...(e as Event), seq: n++, at });

describe("replay", () => {
  it("tracks phases, items, workers, gates and failures", () => {
    n = 0;
    const events: Event[] = [
      ev({ type: "project-created", by: "system", projectId: "p1", ideaId: "idea-1" }),
      ev({ type: "template-selected", by: "selector", template: "iterative", targetProfile: "web-app" }),
      ev({ type: "budget-chosen", by: "user", tier: "cheap", ledgerId: "cost-1" }),
      ev({ type: "phase-entered", by: "system", phase: "build", sprint: 1 }),
      ev({ type: "worker-started", by: "system", role: "developer", key: "dev:b1:1", attempt: 1, tier: "routine", itemId: "b1" }),
      ev({ type: "worker-started", by: "system", role: "developer", key: "dev:b1:1", attempt: 2, tier: "judgment", itemId: "b1" }),
      ev({ type: "worker-finished", by: "system", role: "developer", key: "dev:b1:1", attempt: 2, outcome: "ok", artifactIds: ["test-report-1"], itemId: "b1" }),
      ev({ type: "gate-evaluated", by: "system", gate: "tests-pass", key: "g:b1@0", verdict: "fail", resultId: "gate-1", itemId: "b1" }),
      ev({ type: "gate-evaluated", by: "system", gate: "tests-pass", key: "g:b1@1", verdict: "pass", resultId: "gate-2", itemId: "b1" }),
      ev({ type: "worker-finished", by: "system", role: "product-owner", key: "spec", attempt: 1, outcome: "failed", artifactIds: [] }),
      ev({ type: "item-status", by: "system", itemId: "b1", status: "done" }),
      ev({ type: "item-status", by: "system", itemId: "b2", status: "parked", reason: "retry budget exhausted" }),
      ev({ type: "project-finished", by: "system" }),
    ];
    const s = replay("p1", events);
    expect(s.status).toBe("finished");
    expect(s.template).toBe("iterative");
    expect(s.budgetTier).toBe("cheap");
    expect(s.phase).toBe("build");
    expect(s.sprint).toBe(1);
    expect(s.items["b1"]).toEqual({ status: "done", failCount: 1 });
    expect(s.phaseFails).toEqual({ build: 1 });
    expect(s.entry).toEqual({ phase: "build", n: 1, sprint: 1, seq: 3 });
    expect(s.items["b2"]).toEqual({ status: "parked", failCount: 0, reason: "retry budget exhausted" });
    expect(s.workers["dev:b1:1"]).toEqual({ role: "developer", attempts: 2, lastOutcome: "ok", artifactIds: ["test-report-1"] });
    expect(s.gates["g:b1@1"]).toEqual({ verdict: "pass", resultId: "gate-2", seq: 8 });
    expect(s.failures).toBe(2);
    expect(s.lastSeq).toBe(12);
  });

  it("records a stop reason", () => {
    n = 0;
    const s = replay("p1", [
      ev({ type: "project-created", by: "system", projectId: "p1", ideaId: "idea-1" }),
      ev({ type: "project-stopped", by: "system", reason: "budget exhausted" }),
    ]);
    expect(s.status).toBe("stopped");
    expect(s.stopReason).toBe("budget exhausted");
  });
});
