import type { Artifact } from "../../src/index.js";

const now = "2026-10-16T20:00:00.000Z";

export const idea: Artifact = {
  meta: { id: "idea-1", kind: "idea", createdAt: now, createdBy: "user", text: "A site where neighbours lend tools", locale: "en" },
  body: "A site where neighbours lend tools",
};

export const spec: Artifact = {
  meta: {
    id: "spec-1",
    kind: "spec",
    createdAt: now,
    createdBy: "product-owner",
    phase: "specify",
    title: "ToolShare",
    audience: "People living near each other who own tools they rarely use",
    problem: "Buying a drill for one shelf is wasteful; borrowing from a neighbour is awkward to arrange.",
    goals: ["List a tool in under a minute", "Request a tool and agree a pickup time"],
    nonGoals: ["Payments"],
    features: [
      { id: "f1", name: "List a tool", description: "Add a tool with a photo and availability", priority: "must" },
      { id: "f2", name: "Request a tool", description: "Ask to borrow and pick a time", priority: "must" },
    ],
    successCriteria: ["A neighbour can list and another can request within 5 minutes of signing up"],
  },
  body: "# ToolShare\n\n...",
};

export const gatePass: Artifact = {
  meta: {
    id: "gate-1",
    kind: "gate-result",
    createdAt: now,
    createdBy: "system",
    phase: "specify",
    gate: "schema-valid",
    gateKind: "mechanical",
    verdict: "pass",
    evidence: [{ type: "artifact", ref: { kind: "spec", id: "spec-1" } }],
    citations: [],
    reasons: [],
    transitionTo: "design",
  },
  body: "",
};

export const costLedger: Artifact = {
  meta: {
    id: "cost-1",
    kind: "cost-ledger",
    createdAt: now,
    createdBy: "system",
    currency: "USD",
    tier: "cheap",
    budgetTotal: 5,
    phaseBudgets: { specify: 1, design: 1, build: 2, release: 1 },
    entries: [
      {
        at: now,
        role: "product-owner",
        tier: "judgment",
        model: "claude-opus-5-5",
        inputTokens: 1200,
        outputTokens: 800,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.0208,
        idempotencyKey: "spec:specify:1",
        phase: "specify",
      },
    ],
  },
  body: "",
};

export const all: Artifact[] = [idea, spec, gatePass, costLedger];
