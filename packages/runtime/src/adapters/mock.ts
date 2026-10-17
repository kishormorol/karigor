import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

/** Decides what the "model" answers. Return raw (unvalidated) output; the adapter validates like a real one. */
export type MockScript = (req: ModelRequest<unknown>, attempt: number) => unknown;

/**
 * Deterministic, free, offline. Validates scripted output against the request schema so
 * tests can simulate malformed answers, and counts tokens as text length / 4.
 */
export class MockAdapter implements ModelAdapter {
  readonly name = "mock";
  readonly calls: { key: string; role: string; attempt: number }[] = [];
  private readonly attempts = new Map<string, number>();

  constructor(private readonly script: MockScript) {}

  modelFor(): string {
    return "mock";
  }

  async complete<T>(req: ModelRequest<T>): Promise<ModelResponse<T>> {
    const attempt = (this.attempts.get(req.key) ?? 0) + 1;
    this.attempts.set(req.key, attempt);
    this.calls.push({ key: req.key, role: req.role, attempt });
    const inputTokens = Math.ceil((req.system.length + req.user.length) / 4);
    let raw: unknown;
    try {
      raw = this.script(req as ModelRequest<unknown>, attempt);
    } catch (e) {
      return { ok: false, error: "api", message: (e as Error).message, retryable: false, usage: { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: "mock" };
    }
    if (raw === MockAdapter.REFUSE) {
      return { ok: false, error: "refusal", message: "scripted refusal", retryable: false, usage: { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: "mock" };
    }
    const text = JSON.stringify(raw ?? null);
    const outputTokens = Math.ceil(text.length / 4);
    const usage = { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const r = req.schema.safeParse(raw);
    if (!r.success) {
      return { ok: false, error: "invalid", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), retryable: true, usage, model: "mock", raw: text };
    }
    return { ok: true, output: r.data, usage, model: "mock" };
  }

  static readonly REFUSE: unique symbol = Symbol("refuse");
}
