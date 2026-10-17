import type { BudgetTier, CostEntry, MetaOf, ModelTier } from "@karigor/store";
import { round } from "./prices.js";

export type CostLedgerMeta = MetaOf<"cost-ledger">;

export interface Allowance {
  ok: boolean;
  /** When not ok: the first rung of the ladder that has not been used. */
  action?: "downgrade" | "park" | "stop";
  reason: string;
  spent: number;
  budget: number;
}

export interface CheckInput {
  ledger: CostLedgerMeta;
  phase: string;
  /** What the next call is expected to cost. */
  estimatedCost: number;
  /** Tier the next call would run at. */
  tier: ModelTier;
  /** Has this phase already been downgraded to the routine tier? */
  downgraded: boolean;
  /** Backlog items that are optional (should/could) and still open. */
  parkableItems: number;
}

export function spentInPhase(ledger: CostLedgerMeta, phase: string): number {
  return round(ledger.entries.filter((e) => e.phase === phase).reduce((s, e) => s + e.cost, 0));
}

export function spentTotal(ledger: CostLedgerMeta): number {
  return round(ledger.entries.reduce((s, e) => s + e.cost, 0));
}

/**
 * Decide whether the next call may run. Never silently overspend:
 * over the phase budget -> downgrade the tier, then park optional work, then stop.
 */
export function check(input: CheckInput): Allowance {
  const { ledger, phase, estimatedCost } = input;
  const budget = ledger.phaseBudgets[phase] ?? 0;
  const spent = spentInPhase(ledger, phase);
  const total = spentTotal(ledger);
  const fmt = (n: number) => `${ledger.currency} ${n.toFixed(4)}`;
  if (total + estimatedCost > ledger.budgetTotal && estimatedCost > 0) {
    return { ok: false, action: ladder(input), reason: `project budget ${fmt(ledger.budgetTotal)} would be exceeded (spent ${fmt(total)}, next call ~${fmt(estimatedCost)})`, spent, budget };
  }
  if (spent + estimatedCost > budget && estimatedCost > 0) {
    return { ok: false, action: ladder(input), reason: `phase "${phase}" budget ${fmt(budget)} would be exceeded (spent ${fmt(spent)}, next call ~${fmt(estimatedCost)})`, spent, budget };
  }
  return { ok: true, reason: `within budget (phase ${fmt(spent)} of ${fmt(budget)})`, spent, budget };
}

function ladder(input: CheckInput): "downgrade" | "park" | "stop" {
  if (input.tier === "judgment" && !input.downgraded) return "downgrade";
  if (input.parkableItems > 0) return "park";
  return "stop";
}

export function record(ledger: CostLedgerMeta, entry: CostEntry): CostLedgerMeta {
  if (ledger.entries.some((e) => e.idempotencyKey === entry.idempotencyKey)) {
    throw new Error(`cost entry with key ${entry.idempotencyKey} already recorded; a replayed call must not be billed twice`);
  }
  return { ...ledger, entries: [...ledger.entries, entry] };
}

export interface Meter {
  currency: string;
  tier: BudgetTier;
  total: number;
  budgetTotal: number;
  phases: { phase: string; spent: number; budget: number }[];
  calls: number;
}

export function meter(ledger: CostLedgerMeta): Meter {
  const phases = Object.keys(ledger.phaseBudgets).map((phase) => ({ phase, spent: spentInPhase(ledger, phase), budget: ledger.phaseBudgets[phase]! }));
  return { currency: ledger.currency, tier: ledger.tier, total: spentTotal(ledger), budgetTotal: ledger.budgetTotal, phases, calls: ledger.entries.length };
}

/** Plain-language rendering, like a taxi meter. */
export function renderMeter(m: Meter): string {
  const lines = [`Spent ${m.currency} ${m.total.toFixed(4)} of ${m.currency} ${m.budgetTotal.toFixed(2)} (${m.tier} tier, ${m.calls} model calls)`];
  for (const p of m.phases) {
    const pct = p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : 0;
    lines.push(`  ${p.phase.padEnd(10)} ${m.currency} ${p.spent.toFixed(4)} / ${p.budget.toFixed(2)}  ${pct}%`);
  }
  return lines.join("\n");
}
