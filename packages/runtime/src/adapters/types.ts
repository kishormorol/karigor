import type { z } from "zod/v4";
import type { ModelTier, Role } from "@karigor/store";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const zeroUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export interface ModelRequest<T> {
  /** Which quality tier to use. The adapter maps it to a model. */
  tier: Exclude<ModelTier, "mock"> | "mock";
  /** Stable instructions. Cached by adapters that support it. Keep volatile text out of here. */
  system: string;
  /** The task and its inputs. */
  user: string;
  /** Output must validate against this. */
  schema: z.ZodType<T>;
  /** Scope key: used for idempotency, scripting and cost attribution. */
  key: string;
  role: Role;
  maxTokens?: number;
}

export type ModelResponse<T> =
  | { ok: true; output: T; usage: Usage; model: string }
  | {
      ok: false;
      /** `invalid`: the model answered but not to schema. `refusal`: declined. `api`: transport or auth. */
      error: "invalid" | "refusal" | "api";
      message: string;
      retryable: boolean;
      usage: Usage;
      model: string;
      raw?: string;
    };

export interface ModelAdapter {
  readonly name: string;
  modelFor(tier: ModelRequest<unknown>["tier"]): string;
  complete<T>(req: ModelRequest<T>): Promise<ModelResponse<T>>;
}
