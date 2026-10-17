import type { Artifact, ModelTier, Role } from "@karigor/store";
import { ArtifactSchema } from "@karigor/store";
import type { ModelAdapter, ModelResponse, Usage } from "./adapters/types.js";
import { ROLE_DEFINITIONS, readPrompt, type ProducingRole, type RoleContext, type RoleDefinition } from "./roles/index.js";

export interface Allowance {
  ok: boolean;
  action?: "downgrade" | "park" | "stop";
  reason: string;
}

export interface WorkerBudget {
  /** May this attempt run at this tier? */
  allow(tier: Exclude<ModelTier, "mock">): Allowance;
  /** Book a finished call. `key` is unique per attempt so a replay cannot double-charge. */
  record(entry: { key: string; role: Role; tier: ModelTier; model: string; usage: Usage; costUsd?: number }): void;
}

export interface WorkerContract {
  role: ProducingRole;
  /** Scope key from the machine. */
  key: string;
  ctx: RoleContext;
  adapter: ModelAdapter;
  budget: WorkerBudget;
  /** Starting tier; `undefined` uses the role's default. */
  tier?: Exclude<ModelTier, "mock">;
  /** Called before each model call so the orchestrator can log `worker-started`. */
  onAttempt?: (attempt: number, tier: ModelTier) => Promise<void> | void;
  /** Hard cap on model calls for one contract. */
  maxAttempts?: number;
  /** Delay between retries of transport errors, in ms. */
  retryDelayMs?: number;
}

export interface WorkerResult {
  outcome: "ok" | "invalid" | "failed" | "over-budget";
  attempt: number;
  artifacts: Artifact[];
  error?: string;
  /** Set when over budget: what the budget ladder asks for. */
  budgetAction?: "park" | "stop";
  downgraded: boolean;
  /** The validated model output, when ok. */
  output?: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one role to completion:
 *   invalid output -> retry once quoting the validation error
 *                  -> escalate to the judgment tier once
 *                  -> give up as `invalid`
 *   refusal        -> `failed`
 *   transport      -> retry (retryable) up to maxAttempts, else `failed`
 *   budget         -> downgrade tier when asked, else stop with `over-budget`
 */
export async function runWorker(c: WorkerContract): Promise<WorkerResult> {
  const def = ROLE_DEFINITIONS[c.role] as RoleDefinition<unknown>;
  const maxAttempts = c.maxAttempts ?? 4;
  const [preamble, prompt] = await Promise.all([readPrompt("preamble"), readPrompt(def.role)]);
  const system = `${preamble}\n\n${prompt}`;
  const user = await def.inputs(c.ctx);

  let tier: Exclude<ModelTier, "mock"> = c.tier ?? def.tier;
  let downgraded = false;
  let escalated = false;
  let lastError = "";
  let feedback = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const allowance = c.budget.allow(tier);
    if (!allowance.ok) {
      if (allowance.action === "downgrade" && tier === "judgment") {
        tier = "routine";
        downgraded = true;
        const again = c.budget.allow(tier);
        if (!again.ok) return { outcome: "over-budget", attempt: attempt - 1, artifacts: [], error: again.reason, budgetAction: again.action === "park" ? "park" : "stop", downgraded };
      } else {
        return { outcome: "over-budget", attempt: attempt - 1, artifacts: [], error: allowance.reason, budgetAction: allowance.action === "park" ? "park" : "stop", downgraded };
      }
    }
    await c.onAttempt?.(attempt, c.adapter.name === "mock" ? "mock" : tier);
    const res: ModelResponse<unknown> = await c.adapter.complete({
      tier: c.adapter.name === "mock" ? "mock" : tier,
      system,
      user: feedback ? `${user}\n\n## Your previous answer was rejected\n\n${feedback}\n\nAnswer again, fixing exactly that.` : user,
      schema: def.schema,
      key: c.key,
      role: def.role,
    });
    c.budget.record({ key: `${c.key}#${attempt}`, role: c.role, tier: c.adapter.name === "mock" ? "mock" : tier, model: res.model, usage: res.usage, ...(res.costUsd !== undefined ? { costUsd: res.costUsd } : {}) });

    if (res.ok) {
      let artifacts: Artifact[];
      try {
        artifacts = await def.write(res.output, c.ctx);
        for (const a of artifacts) ArtifactSchema.parse(a);
      } catch (e) {
        lastError = `output could not be turned into valid artifacts: ${(e as Error).message}`;
        feedback = lastError;
        if (!escalated && tier === "routine") {
          tier = "judgment";
          escalated = true;
        }
        continue;
      }
      return { outcome: "ok", attempt, artifacts, downgraded, output: res.output };
    }

    lastError = res.message;
    if (res.error === "refusal") return { outcome: "failed", attempt, artifacts: [], error: `the model declined: ${res.message}`, downgraded };
    if (res.error === "api") {
      if (!res.retryable) return { outcome: "failed", attempt, artifacts: [], error: res.message, downgraded };
      await sleep(c.retryDelayMs ?? 500 * attempt);
      continue;
    }
    // invalid: first retry with feedback at the same tier, then escalate once.
    feedback = `${res.message}${res.raw ? `\n\nRejected answer (truncated):\n${res.raw.slice(0, 2000)}` : ""}`;
    if (attempt >= 2 && !escalated && tier === "routine") {
      tier = "judgment";
      escalated = true;
    } else if (attempt >= 2 && (escalated || tier === "judgment")) {
      if (attempt >= 3) return { outcome: "invalid", attempt, artifacts: [], error: lastError, downgraded };
    }
  }
  return { outcome: lastError.includes("declined") ? "failed" : "invalid", attempt: maxAttempts, artifacts: [], error: lastError || "gave up", downgraded };
}
