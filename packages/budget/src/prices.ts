import pricesJson from "./prices.json" with { type: "json" };

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const PRICES: Record<string, ModelPrice> = pricesJson.models;
export const CURRENCY = pricesJson.currency;

const FREE: ModelPrice = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Flat-rate or local providers whose calls cost the user nothing extra. */
export function isFlatRate(model: string): boolean {
  return model === "mock" || model.startsWith("ollama/") || model.startsWith("claude-code/");
}

/** Price for a model id. Flat-rate and local models cost zero; the caller may override. */
export function priceFor(model: string, overrides: Record<string, ModelPrice> = {}): ModelPrice {
  const p = overrides[model] ?? PRICES[model];
  if (p) return p;
  if (isFlatRate(model)) return FREE;
  // Unknown paid model: assume the most expensive known rate so the budget errs on the safe side.
  return PRICES["claude-fable-5-1"]!;
}

/** Cost of one call in currency units. */
export function costOf(usage: Usage, model: string, overrides?: Record<string, ModelPrice>): number {
  const p = priceFor(model, overrides);
  const perTok = 1 / 1_000_000;
  const uncached = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  return round(
    uncached * p.input * perTok +
      usage.cacheReadTokens * p.cacheRead * perTok +
      usage.cacheWriteTokens * p.cacheWrite * perTok +
      usage.outputTokens * p.output * perTok,
  );
}

export function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
