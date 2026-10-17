import type { Judge, JudgeRequest } from "@karigor/gates";
import { JudgedVerdictSchema } from "@karigor/gates";
import type { ModelTier } from "@karigor/store";
import type { ModelAdapter, Usage } from "./adapters/index.js";
import { readPrompt, renderArtifact } from "./roles/index.js";

export interface JudgeBudget {
  allow(tier: Exclude<ModelTier, "mock">): { ok: boolean; action?: "downgrade" | "park" | "stop"; reason: string };
  record(entry: { key: string; role: "reviewer" | "skeptic"; tier: ModelTier; model: string; usage: Usage }): void;
}

/**
 * The judge behind every judged gate. Runs the reviewer or skeptic prompt with the rubric,
 * at the judgment tier when the budget allows. Invalid output after one retry becomes a
 * fail verdict with the reason, so a bad answer cannot pass a gate.
 */
export function makeJudge(adapter: ModelAdapter, budget: JudgeBudget): Judge {
  return async (req: JudgeRequest) => {
    const [preamble, prompt] = await Promise.all([readPrompt("preamble"), readPrompt(req.role)]);
    const system = `${preamble}\n\n${prompt}\n\n${req.rubric}`;
    const user = renderJudgeInputs(req);
    let tier: Exclude<ModelTier, "mock"> = "judgment";
    const allowance = budget.allow(tier);
    if (!allowance.ok) {
      if (allowance.action === "downgrade") tier = "routine";
      else return { verdict: "fail", citations: [], reasons: [`could not run the ${req.role}: ${allowance.reason}`] };
    }
    let feedback = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await adapter.complete({
        tier: adapter.name === "mock" ? "mock" : tier,
        system,
        user: feedback ? `${user}\n\n## Your previous answer was rejected\n\n${feedback}` : user,
        schema: JudgedVerdictSchema,
        key: `${req.key}:judge`,
        role: req.role,
      });
      budget.record({ key: `${req.key}:judge#${attempt}`, role: req.role as "reviewer" | "skeptic", tier: adapter.name === "mock" ? "mock" : tier, model: res.model, usage: res.usage });
      if (res.ok) return res.output;
      if (res.error === "api" && res.retryable && attempt === 1) continue;
      if (res.error === "invalid" && attempt === 1) {
        feedback = res.message;
        continue;
      }
      return { verdict: "fail", citations: [], reasons: [`${req.role} could not produce a usable verdict: ${res.message}`] };
    }
    return { verdict: "fail", citations: [], reasons: [`${req.role} could not produce a usable verdict`] };
  };
}

export function renderJudgeInputs(req: JudgeRequest): string {
  const parts = [`# Gate: ${req.gate}${req.itemId ? ` for item ${req.itemId}` : ""} (phase ${req.phase})`, ""];
  parts.push("You may cite only these artifacts, by kind and id:", ...req.inputs.map((a) => `- ${a.meta.kind} ${a.meta.id}`), "");
  for (const a of req.inputs) parts.push(renderArtifact(a));
  for (const [name, text] of Object.entries(req.extras)) parts.push(`## ${name}\n\n\`\`\`\n${text}\n\`\`\`\n`);
  return parts.join("\n");
}
