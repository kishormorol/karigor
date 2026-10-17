import { describe, expect, it } from "vitest";
import { ArtifactSchema, EventSchema, META_BY_KIND, ARTIFACT_KINDS } from "../src/index.js";
import * as fx from "./fixtures/artifacts.js";

describe("artifact schemas", () => {
  it("accepts every fixture and round-trips through JSON", () => {
    for (const a of fx.all) {
      const parsed = ArtifactSchema.parse(JSON.parse(JSON.stringify(a)));
      expect(parsed).toEqual(a);
    }
  });

  it("has a meta schema for every kind", () => {
    for (const kind of ARTIFACT_KINDS) expect(META_BY_KIND[kind]).toBeDefined();
  });

  it("rejects a spec with no features", () => {
    const bad = { ...fx.spec, meta: { ...fx.spec.meta, features: [] } };
    expect(ArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a gate result with no evidence", () => {
    const bad = { ...fx.gatePass, meta: { ...fx.gatePass.meta, evidence: [] } };
    expect(ArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown kind and an uppercase id", () => {
    expect(ArtifactSchema.safeParse({ meta: { ...fx.idea.meta, kind: "poem" }, body: "" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ meta: { ...fx.idea.meta, id: "Idea-1" }, body: "" }).success).toBe(false);
  });

  it("rejects a cost entry with a negative cost", () => {
    const m = fx.costLedger.meta as Extract<typeof fx.costLedger.meta, { kind: "cost-ledger" }>;
    const bad = { ...fx.costLedger, meta: { ...m, entries: [{ ...m.entries[0]!, cost: -1 }] } };
    expect(ArtifactSchema.safeParse(bad).success).toBe(false);
  });
});

describe("event schema", () => {
  const at = "2026-10-16T20:00:00.000Z";
  it("accepts each event type", () => {
    const events = [
      { seq: 0, at, type: "project-created", projectId: "p1", ideaId: "idea-1" },
      { seq: 1, at, type: "template-selected", template: "iterative", targetProfile: "web-app" },
      { seq: 2, at, type: "budget-chosen", tier: "cheap", ledgerId: "cost-1" },
      { seq: 3, at, type: "phase-entered", phase: "specify" },
      { seq: 4, at, type: "worker-started", role: "product-owner", key: "spec:specify:1", attempt: 1, tier: "judgment" },
      { seq: 5, at, type: "worker-finished", role: "product-owner", key: "spec:specify:1", attempt: 1, outcome: "ok", artifacts: [{ kind: "spec", id: "spec-1" }] },
      { seq: 6, at, type: "artifact-written", kind: "spec", id: "spec-1" },
      { seq: 7, at, type: "gate-evaluated", gate: "schema-valid", key: "specify#1:schema-valid", verdict: "pass", resultId: "gate-1" },
      { seq: 8, at, type: "transition", from: "specify", to: "design" },
      { seq: 9, at, type: "item-status", itemId: "b1", status: "parked", reason: "retry budget exhausted" },
      { seq: 10, at, type: "budget-downgraded", phase: "build", from: "judgment", to: "routine" },
      { seq: 11, at, type: "project-stopped", reason: "budget exhausted" },
      { seq: 12, at, type: "project-finished" },
    ];
    for (const e of events) {
      const r = EventSchema.safeParse(e);
      expect(r.success, `${e.type}: ${r.success ? "" : r.error.message}`).toBe(true);
    }
  });

  it("rejects an unknown type and a missing seq", () => {
    expect(EventSchema.safeParse({ seq: 0, at, type: "coffee-break" }).success).toBe(false);
    expect(EventSchema.safeParse({ at, type: "project-finished" }).success).toBe(false);
  });
});
