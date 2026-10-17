import { describe, expect, it } from "vitest";
import { emptyState } from "@karigor/store";
import { MockAdapter, runWorker } from "../src/index.js";
import { fakeSpecOutput, freshStore, idea, openBudget, roleContext, seed } from "./helpers.js";

describe("runWorker", () => {
  it("runs a role, writes its artifacts, and books one cost entry per attempt", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state);
    const adapter = new MockAdapter(() => fakeSpecOutput);
    const budget = openBudget();
    const r = await runWorker({ role: "product-owner", key: "specify#1:product-owner", ctx, adapter, budget });
    expect(r.outcome).toBe("ok");
    expect(r.attempt).toBe(1);
    expect(r.artifacts.map((a) => a.meta.kind)).toEqual(["spec", "ledger"]);
    const ledger = r.artifacts[1]!;
    expect(ledger.meta.kind === "ledger" && ledger.meta.assumptions[0]?.madeBy).toBe("product-owner");
    expect(budget.entries).toEqual([{ key: "specify#1:product-owner#1", tier: "mock" }]);
    expect(adapter.calls[0]?.role).toBe("product-owner");
  });

  it("retries once with the validation error quoted, then succeeds", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state);
    let sawFeedback = false;
    const adapter = new MockAdapter((req, attempt) => {
      if (attempt === 2) sawFeedback = req.user.includes("previous answer was rejected") && req.user.includes("goals");
      return attempt === 1 ? { ...fakeSpecOutput, goals: [] } : fakeSpecOutput;
    });
    const budget = openBudget();
    const r = await runWorker({ role: "product-owner", key: "k", ctx, adapter, budget });
    expect(r.outcome).toBe("ok");
    expect(r.attempt).toBe(2);
    expect(sawFeedback).toBe(true);
    expect(budget.entries.map((e) => e.key)).toEqual(["k#1", "k#2"]);
  });

  it("escalates a routine role to the judgment tier after a second invalid answer, then gives up as invalid", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state, { phase: "build", itemId: "b1" });
    const tiers: string[] = [];
    const adapter = new MockAdapter(() => ({ summary: "x" })); // always missing files
    const budget = openBudget();
    const r = await runWorker({ role: "developer", key: "k", ctx, adapter, budget, onAttempt: (_a, t) => void tiers.push(t) });
    expect(r.outcome).toBe("invalid");
    expect(r.error).toMatch(/files/);
    expect(r.attempt).toBe(3);
    expect(budget.entries.length).toBe(3);
  });

  it("stops with over-budget when the ladder says park or stop, and downgrades when it says so", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state);
    const adapter = new MockAdapter(() => fakeSpecOutput);
    const stop = { ...openBudget(), allow: () => ({ ok: false, action: "stop" as const, reason: "project budget exceeded" }) };
    const r1 = await runWorker({ role: "product-owner", key: "k", ctx, adapter, budget: stop });
    expect(r1).toMatchObject({ outcome: "over-budget", budgetAction: "stop", attempt: 0 });
    expect(adapter.calls.length).toBe(0);

    const seen: string[] = [];
    const downgrade = {
      ...openBudget(),
      allow: (tier: string) => {
        seen.push(tier);
        return tier === "judgment" ? { ok: false, action: "downgrade" as const, reason: "phase budget" } : { ok: true, reason: "ok" };
      },
    };
    const r2 = await runWorker({ role: "product-owner", key: "k2", ctx, adapter, budget: downgrade });
    expect(r2.outcome).toBe("ok");
    expect(r2.downgraded).toBe(true);
    expect(seen).toEqual(["judgment", "routine"]);
  });

  it("reports a refusal as failed without retrying", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state);
    const adapter = new MockAdapter(() => MockAdapter.REFUSE);
    const r = await runWorker({ role: "product-owner", key: "k", ctx, adapter, budget: openBudget() });
    expect(r.outcome).toBe("failed");
    expect(r.error).toMatch(/declined/);
    expect(adapter.calls.length).toBe(1);
  });

  it("retries transport errors and then fails", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state);
    const adapter = new MockAdapter(() => {
      throw new Error("ECONNRESET");
    });
    const r = await runWorker({ role: "product-owner", key: "k", ctx, adapter, budget: openBudget(), retryDelayMs: 1 });
    expect(r.outcome).toBe("failed");
    expect(r.error).toMatch(/ECONNRESET/);
  });
});
