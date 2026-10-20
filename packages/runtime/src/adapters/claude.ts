import Anthropic, { APIConnectionError, AuthenticationError, RateLimitError, APIError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ModelAdapter, ModelRequest, ModelResponse, Usage } from "./types.js";

export interface ClaudeAdapterOptions {
  /** Strongest model, for specs, architecture and judged gates. */
  judgmentModel?: string;
  /** Cheap model, for routine work. */
  routineModel?: string;
  effort?: { judgment: "low" | "medium" | "high" | "xhigh" | "max"; routine: "low" | "medium" | "high" | "xhigh" | "max" };
  client?: Anthropic;
  /** A key for this adapter only (bring your own key). Otherwise the SDK reads ANTHROPIC_API_KEY. */
  apiKey?: string;
}

export const CLAUDE_DEFAULTS = {
  judgmentModel: "claude-opus-5-5",
  routineModel: "claude-haiku-5-5",
  effort: { judgment: "high", routine: "low" },
} as const;

/**
 * Claude through the plain Anthropic SDK with structured outputs.
 * - The system prompt is cached (prompt caching), so repeated role calls share the prefix.
 * - Thinking is adaptive by default; depth is controlled by `effort` per tier.
 * - Server-side fallbacks are on ("default"), so a policy decline re-runs on a substitute model.
 * - Streaming is used so long outputs do not hit HTTP timeouts.
 */
export class ClaudeAdapter implements ModelAdapter {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly judgmentModel: string;
  private readonly routineModel: string;
  private readonly effort: NonNullable<ClaudeAdapterOptions["effort"]>;

  constructor(opts: ClaudeAdapterOptions = {}) {
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.judgmentModel = opts.judgmentModel ?? CLAUDE_DEFAULTS.judgmentModel;
    this.routineModel = opts.routineModel ?? CLAUDE_DEFAULTS.routineModel;
    this.effort = opts.effort ?? CLAUDE_DEFAULTS.effort;
  }

  modelFor(tier: ModelRequest<unknown>["tier"]): string {
    return tier === "routine" ? this.routineModel : this.judgmentModel;
  }

  async complete<T>(req: ModelRequest<T>): Promise<ModelResponse<T>> {
    const tier = req.tier === "routine" ? "routine" : "judgment";
    const model = this.modelFor(tier);
    const format = zodOutputFormat(req.schema);
    try {
      const stream = this.client.beta.messages.stream({
        model,
        max_tokens: req.maxTokens ?? 32_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: req.user }],
        output_config: { effort: this.effort[tier], format },
      });
      const message = await stream.finalMessage();
      const usage = toUsage(message.usage);
      if (message.stop_reason === "refusal") {
        return { ok: false, error: "refusal", message: `declined (${message.stop_details?.type === "refusal" ? message.stop_details.category ?? "unknown" : "unknown"})`, retryable: false, usage, model: message.model };
      }
      const text = message.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (message.stop_reason === "max_tokens") {
        return { ok: false, error: "invalid", message: "output was cut off at max_tokens", retryable: true, usage, model: message.model, raw: text };
      }
      let output: T;
      try {
        output = format.parse(text);
      } catch (e) {
        return { ok: false, error: "invalid", message: (e as Error).message, retryable: true, usage, model: message.model, raw: text };
      }
      return { ok: true, output, usage, model: message.model };
    } catch (e) {
      return { ok: false, error: "api", message: describe(e), retryable: isRetryable(e), usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model };
    }
  }
}

function toUsage(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number | null; cache_creation_input_tokens: number | null }): Usage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function isRetryable(e: unknown): boolean {
  if (e instanceof AuthenticationError) return false;
  if (e instanceof RateLimitError || e instanceof APIConnectionError) return true;
  if (e instanceof APIError) return (e.status ?? 0) >= 500;
  return false;
}

function describe(e: unknown): string {
  if (e instanceof AuthenticationError) return "authentication failed: set ANTHROPIC_API_KEY or run `ant auth login`";
  if (e instanceof RateLimitError) return "rate limited";
  if (e instanceof APIConnectionError) return `connection error: ${e.message}`;
  if (e instanceof APIError) return `API error ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
