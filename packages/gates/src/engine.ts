import type { Artifact, GateName, MetaOf } from "@karigor/store";
import type { GateContext } from "./context.js";
import { isJudged, runJudged } from "./judged.js";
import { mechanical } from "./mechanical/index.js";

type GateResultMeta = MetaOf<"gate-result">;

export interface GateOutcome {
  verdict: "pass" | "fail";
  evidence: GateResultMeta["evidence"];
  citations: GateResultMeta["citations"];
  reasons: string[];
  /** Extra artifacts the gate wrote (a test report, for instance). */
  artifactIds?: string[];
}

export interface GateResult {
  verdict: "pass" | "fail";
  resultId: string;
  artifactIds: string[];
  reasons: string[];
}

export class GateError extends Error {
  override name = "GateError";
}

export function gateKind(gate: GateName): "mechanical" | "judged" {
  return isJudged(gate) ? "judged" : "mechanical";
}

/**
 * Evaluate one gate, write its `gate-result` artifact, and return the verdict.
 * A gate cannot pass without evidence; the schema enforces at least one item.
 */
export async function evaluate(ctx: GateContext): Promise<GateResult> {
  const impl = isJudged(ctx.gate) ? runJudged : mechanical[ctx.gate as keyof typeof mechanical];
  if (!impl) throw new GateError(`no implementation for gate "${ctx.gate}"`);
  const out = await impl(ctx);
  if (out.evidence.length === 0) throw new GateError(`gate "${ctx.gate}" returned no evidence`);
  const id = ctx.makeId("gate-result");
  const meta: GateResultMeta = {
    id,
    kind: "gate-result",
    createdAt: ctx.clock().toISOString(),
    createdBy: "system",
    phase: ctx.phase,
    gate: ctx.gate,
    gateKind: gateKind(ctx.gate),
    verdict: out.verdict,
    evidence: out.evidence,
    citations: out.citations,
    reasons: out.reasons,
    ...(ctx.transitionTo !== undefined ? { transitionTo: ctx.transitionTo } : {}),
    ...(ctx.itemId !== undefined ? { itemId: ctx.itemId } : {}),
  };
  const body = renderBody(meta);
  const artifact: Artifact = { meta, body };
  await ctx.store.writeArtifact(artifact);
  return { verdict: out.verdict, resultId: id, artifactIds: [...(out.artifactIds ?? []), id], reasons: out.reasons };
}

function renderBody(m: GateResultMeta): string {
  const lines = [`# Gate ${m.gate}: ${m.verdict.toUpperCase()}`, "", `Phase: ${m.phase ?? ""}${m.itemId ? `, item ${m.itemId}` : ""}`, ""];
  if (m.reasons.length) lines.push("## Reasons", ...m.reasons.map((r) => `- ${r}`), "");
  if (m.citations.length) lines.push("## Citations", ...m.citations.map((c) => `- ${c.ref.kind} ${c.ref.id}${c.ref.locator ? ` (${c.ref.locator})` : ""}: "${c.quote}"`), "");
  lines.push("## Evidence", ...m.evidence.map((e) => (e.type === "artifact" ? `- ${e.ref.kind} ${e.ref.id}` : `- ${e.text.split("\n")[0]}`)));
  return lines.join("\n") + "\n";
}
