import type { Artifact, ModelTier } from "@karigor/store";
import { readPrompt, renderFeedback, type RoleContext } from "./roles/index.js";
import type { WorkerBudget } from "./worker.js";
import type { AgentAdapter } from "./agents/types.js";

/** The slice of a workspace the developer worker needs. Implemented by `@karigor/sandbox`. */
export interface AgentWorkspace {
  dir: string;
  head(): Promise<string>;
  reset(): Promise<void>;
  commitAll(message: string): Promise<string | undefined>;
  changedFiles(from: string): Promise<{ path: string; action: "write" | "delete" }[]>;
  diff(from: string): Promise<string>;
}

export interface AgentContract {
  key: string;
  ctx: RoleContext;
  agent: AgentAdapter;
  budget: WorkerBudget;
  workspace: AgentWorkspace;
  /** Markdown conventions for the target profile. */
  stackGuide: string;
  tier?: Exclude<ModelTier, "mock">;
  onAttempt?: (attempt: number, tier: ModelTier) => Promise<void> | void;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Largest diff kept in the change artifact's body. */
  maxDiffChars?: number;
}

export interface AgentResult {
  outcome: "ok" | "invalid" | "failed" | "over-budget";
  attempt: number;
  artifacts: Artifact[];
  summary?: string;
  commit?: string;
  error?: string;
  budgetAction?: "park" | "stop";
  downgraded: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`;
}

/** The task text for one item: what to build, the spec and architecture context, and any feedback. */
export async function renderDeveloperTask(ctx: RoleContext): Promise<string> {
  const latest = async <K extends "spec" | "architecture">(kind: K) => {
    const ids = ctx.state.artifacts[kind];
    const id = ids?.[ids.length - 1];
    return id ? ctx.store.readArtifact(kind, id) : undefined;
  };
  const spec = await latest("spec");
  const arch = await latest("architecture");
  const item = ctx.backlog.find((b) => b.id === ctx.itemId);
  const parts = [
    section("Backlog item to implement", item ? "```json\n" + JSON.stringify(item, null, 2) + "\n```" : `(phase-level work for ${ctx.phase})`),
    spec ? section("Product", `${spec.meta.title}\n\nAudience: ${spec.meta.audience}\n\nProblem: ${spec.meta.problem}\n\nGoals:\n${spec.meta.goals.map((g) => `- ${g}`).join("\n")}`) : "",
    arch ? section("Architecture", `${arch.meta.stack.map((s) => `- ${s.layer}: ${s.choice} (${s.reason})`).join("\n")}\n\nComponents:\n${arch.meta.components.map((c) => `- ${c.name}: ${c.responsibility}`).join("\n")}\n\n${arch.body}`) : "",
    renderFeedback(ctx),
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * Run the developer as an agent inside the workspace. Each attempt starts from a clean tree;
 * success means the agent reported done and the tree changed, and the change is committed as
 * `karigor(<itemId>): <summary>`.
 */
export async function runAgentWorker(c: AgentContract): Promise<AgentResult> {
  const itemId = c.ctx.itemId ?? c.ctx.phase;
  const maxAttempts = c.maxAttempts ?? 3;
  const [preamble, prompt] = await Promise.all([readPrompt("preamble"), readPrompt("developer-agent")]);
  const system = `${preamble}\n\n${prompt}\n\n${c.stackGuide}`;
  const baseUser = await renderDeveloperTask(c.ctx);
  let tier: Exclude<ModelTier, "mock"> = c.tier ?? "routine";
  let downgraded = false;
  let lastError = "";
  let extra = "";

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
    await c.workspace.reset();
    const before = await c.workspace.head();
    const effectiveTier: ModelTier = c.agent.name === "mock" ? "mock" : tier;
    await c.onAttempt?.(attempt, effectiveTier);
    const res = await c.agent.act({ tier: effectiveTier, system, user: extra ? `${baseUser}\n${extra}` : baseUser, cwd: c.workspace.dir, key: c.key, role: "developer" });
    c.budget.record({ key: `${c.key}#${attempt}`, role: "developer", tier: effectiveTier, model: res.model, usage: res.usage, ...(res.costUsd !== undefined ? { costUsd: res.costUsd } : {}) });

    if (!res.ok) {
      lastError = res.message;
      if (res.error === "refusal") return { outcome: "failed", attempt, artifacts: [], error: `the model declined: ${res.message}`, downgraded };
      if (!res.retryable) return { outcome: "failed", attempt, artifacts: [], error: res.message, downgraded };
      await sleep(c.retryDelayMs ?? 1000 * attempt);
      continue;
    }

    const summary = firstLine(res.summary) || `work on ${itemId}`;
    const commit = await c.workspace.commitAll(`karigor(${itemId}): ${summary}`);
    if (!commit) {
      lastError = "the developer finished without changing any files";
      extra = section("Your previous attempt was rejected", "You reported being done, but no files changed. Implement the item by editing files in this workspace, add tests, and run them.");
      if (tier === "routine" && attempt >= 2) {
        tier = "judgment";
      }
      continue;
    }
    const files = (await c.workspace.changedFiles(before)).map((f) => ({ ...f, bytes: 0 }));
    const diff = await c.workspace.diff(before);
    const max = c.maxDiffChars ?? 200_000;
    const body = [`# ${summary}`, "", res.summary.trim(), "", "## Diff", "", "```diff", diff.length > max ? `${diff.slice(0, max)}\n... (${diff.length - max} more characters)` : diff, "```", ""].join("\n");
    const artifact: Artifact = {
      meta: { id: c.ctx.makeId("change"), kind: "change", createdAt: c.ctx.clock().toISOString(), createdBy: "developer", phase: c.ctx.phase, itemId, summary, files, commit },
      body,
    };
    return { outcome: "ok", attempt, artifacts: [artifact], summary: res.summary, commit, downgraded };
  }
  return { outcome: lastError.includes("without changing") ? "invalid" : "failed", attempt: maxAttempts, artifacts: [], error: lastError || "gave up", downgraded };
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.replace(/^#+\s*/, "").slice(0, 100);
}
