import { describe, expect, it } from "vitest";
import { loadTemplate } from "@karigor/process";
import type { MetaOf } from "@karigor/store";
import { check, costOf, estimate, meter, priceFor, record, renderMeter } from "../src/index.js";

describe("prices", () => {
  it("prices a call with cache reads and writes", () => {
    // 10k input of which 8k cached reads and 1k cache writes; 2k output on opus 5.5
    const c = costOf({ inputTokens: 10_000, outputTokens: 2_000, cacheReadTokens: 8_000, cacheWriteTokens: 1_000 }, "claude-opus-5-5");
    // uncached 1k*4 + reads 8k*0.2 + writes 1k*5 + out 2k*20 = 0.004+0.0016+0.005+0.04
    expect(c).toBeCloseTo(0.0506, 6);
  });
  it("local and mock models are free; unknown models assume the dearest rate", () => {
    expect(costOf({ inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 }, "ollama/llama3")).toBe(0);
    expect(costOf({ inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, "mock")).toBe(0);
    expect(priceFor("claude-mystery-9")).toEqual(priceFor("claude-fable-5-1"));
    expect(costOf({ inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 }, "claude-code/claude-opus-5-5")).toBe(0);
  });
});

describe("estimate", () => {
  it("gives three ordered tiers with free at exactly zero, for every template", async () => {
    for (const name of ["iterative", "linear", "spike-then-build", "maintenance"]) {
      const t = await loadTemplate(name);
      const [free, cheap, best] = estimate(t);
      expect(free!.total).toBe(0);
      expect(cheap!.total).toBeGreaterThan(0);
      expect(best!.total).toBeGreaterThan(cheap!.total);
      expect(Object.keys(best!.phaseBudgets).sort()).toEqual(Object.keys(t.phases).filter((p) => !t.phases[p]!.terminal).sort());
      expect(Object.values(best!.phaseBudgets).reduce((a, b) => a + b, 0)).toBeCloseTo(best!.total, 4);
    }
  });
  it("scales with expected items", async () => {
    const t = await loadTemplate("iterative");
    const small = estimate(t, { expectedItems: 2 })[2]!;
    const big = estimate(t, { expectedItems: 20 })[2]!;
    expect(big.phaseBudgets["build"]).toBeGreaterThan(small.phaseBudgets["build"]! * 5);
    expect(big.phaseBudgets["specify"]).toBe(small.phaseBudgets["specify"]);
  });
  it("keeps the best tier for a typical idea in the single-digit dollars", async () => {
    const t = await loadTemplate("iterative");
    const best = estimate(t)[2]!;
    expect(best.total).toBeLessThan(10);
  });
});

const ledger = (over: Partial<MetaOf<"cost-ledger">> = {}): MetaOf<"cost-ledger"> => ({
  id: "cost-1", kind: "cost-ledger", createdAt: "2026-10-16T20:00:00.000Z", createdBy: "system",
  currency: "USD", tier: "best", budgetTotal: 2, phaseBudgets: { specify: 0.5, build: 1.5 }, entries: [], ...over,
});
const entry = (phase: string, cost: number, key: string) => ({
  at: "2026-10-16T20:00:00.000Z", role: "developer" as const, tier: "judgment" as const, model: "claude-opus-5-5",
  inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, cost, idempotencyKey: key, phase,
});

describe("check", () => {
  it("allows calls within budget and free calls under a zero budget", () => {
    const base = { phase: "build", tier: "judgment" as const, downgraded: false, parkableItems: 0 };
    expect(check({ ...base, ledger: ledger(), estimatedCost: 0.1 }).ok).toBe(true);
    expect(check({ ...base, ledger: ledger({ tier: "free", budgetTotal: 0, phaseBudgets: { build: 0 } }), estimatedCost: 0 }).ok).toBe(true);
  });
  it("walks downgrade -> park -> stop when a phase budget would be exceeded", () => {
    const l = ledger({ entries: [entry("build", 1.45, "a")] });
    const base = { ledger: l, phase: "build", estimatedCost: 0.1 };
    expect(check({ ...base, tier: "judgment", downgraded: false, parkableItems: 2 })).toMatchObject({ ok: false, action: "downgrade" });
    expect(check({ ...base, tier: "routine", downgraded: true, parkableItems: 2 })).toMatchObject({ ok: false, action: "park" });
    expect(check({ ...base, tier: "routine", downgraded: true, parkableItems: 0 })).toMatchObject({ ok: false, action: "stop" });
    expect(check({ ...base, tier: "routine", downgraded: true, parkableItems: 0 }).reason).toMatch(/phase "build" budget USD 1.5000 would be exceeded/);
  });
  it("enforces the project total even when the phase has room", () => {
    const l = ledger({ entries: [entry("specify", 0.4, "a"), entry("build", 1.5, "b")], phaseBudgets: { specify: 0.5, build: 5 } });
    const r = check({ ledger: l, phase: "build", estimatedCost: 0.2, tier: "routine", downgraded: true, parkableItems: 0 });
    expect(r).toMatchObject({ ok: false, action: "stop" });
    expect(r.reason).toMatch(/project budget/);
  });
});

describe("ledger", () => {
  it("records entries and refuses a duplicate idempotency key", () => {
    let l = ledger();
    l = record(l, entry("specify", 0.1, "k1"));
    l = record(l, entry("build", 0.2, "k2"));
    expect(() => record(l, entry("build", 0.2, "k2"))).toThrow(/billed twice/);
    const m = meter(l);
    expect(m.total).toBeCloseTo(0.3, 6);
    expect(m.calls).toBe(2);
    expect(renderMeter(m)).toMatch(/Spent USD 0.3000 of USD 2.00 \(best tier, 2 model calls, 2 tokens in \/ 2 out\)/);
    expect(renderMeter(m)).not.toMatch(/subscription/);
    const sub = record(ledger(), { ...entry("build", 0, "s1"), model: "claude-code/claude-opus-5-5", apiEquivalentCost: 0.42 });
    expect(renderMeter(meter(sub))).toMatch(/Covered by your subscription; the same calls would cost about USD 0.42/);
    expect(renderMeter(m)).toMatch(/build\s+USD 0.2000 \/ 1.50\s+13%/);
  });
});
