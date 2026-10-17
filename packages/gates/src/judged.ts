import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Artifact, ArtifactMeta, GateName, Role } from "@karigor/store";
import type { GateContext } from "./context.js";
import type { GateOutcome } from "./engine.js";

const here = dirname(fileURLToPath(import.meta.url));
export const RUBRICS_DIR = join(here, "..", "rubrics");

export const JUDGED: Record<"spec-complete" | "architecture-sound" | "diff-matches-spec" | "skeptic-review", Role> = {
  "spec-complete": "reviewer",
  "architecture-sound": "reviewer",
  "diff-matches-spec": "reviewer",
  "skeptic-review": "skeptic",
};
export type JudgedGateName = keyof typeof JUDGED;
export const isJudged = (g: GateName): g is JudgedGateName => g in JUDGED;

export async function readRubric(gate: JudgedGateName): Promise<string> {
  return readFile(join(RUBRICS_DIR, `${gate}.md`), "utf8");
}

async function latestOf<K extends ArtifactMeta["kind"]>(ctx: GateContext, kind: K): Promise<Artifact | undefined> {
  const ids = ctx.state.artifacts[kind];
  const id = ids?.[ids.length - 1];
  return id ? ctx.store.readArtifact(kind, id) : undefined;
}

async function producedArtifacts(ctx: GateContext): Promise<Artifact[]> {
  const out: Artifact[] = [];
  for (const ref of ctx.produced) out.push(await ctx.store.readArtifact(ref.kind, ref.id));
  return out;
}

/** Which artifacts and extras each judged gate sees. */
async function gather(ctx: GateContext): Promise<{ inputs: Artifact[]; extras: Record<string, string> }> {
  const inputs: Artifact[] = [];
  const extras: Record<string, string> = {};
  const push = (a: Artifact | undefined) => a && inputs.push(a);
  switch (ctx.gate) {
    case "spec-complete":
      push(await latestOf(ctx, "spec"));
      push(await latestOf(ctx, "idea"));
      push(await latestOf(ctx, "ledger"));
      break;
    case "architecture-sound":
      push(await latestOf(ctx, "architecture"));
      push(await latestOf(ctx, "spec"));
      break;
    case "diff-matches-spec":
      push(await latestOf(ctx, "spec"));
      inputs.push(...(await producedArtifacts(ctx)));
      if (ctx.backlogItem) extras["backlog-item"] = JSON.stringify(ctx.backlogItem, null, 2);
      extras["diff"] = await ctx.sandbox.diff(ctx.itemId);
      break;
    case "skeptic-review":
      inputs.push(...(await producedArtifacts(ctx)));
      push(await latestOf(ctx, "spec"));
      if (ctx.itemId) {
        if (ctx.backlogItem) extras["backlog-item"] = JSON.stringify(ctx.backlogItem, null, 2);
        extras["diff"] = await ctx.sandbox.diff(ctx.itemId);
      }
      break;
  }
  return { inputs, extras };
}

export async function runJudged(ctx: GateContext): Promise<GateOutcome> {
  if (!isJudged(ctx.gate)) throw new Error(`${ctx.gate} is not a judged gate`);
  const { inputs, extras } = await gather(ctx);
  if (inputs.length === 0) {
    return { verdict: "fail", evidence: [{ type: "text", text: "nothing to judge" }], citations: [], reasons: ["no artifacts were available to review"] };
  }
  const rubric = await readRubric(ctx.gate);
  if (ctx.previousReview) {
    extras["previous-review"] = [
      `Your previous verdict on this same work was: ${ctx.previousReview.verdict.toUpperCase()}.`,
      ctx.previousReview.reasons.length ? `Blocking objections you raised then:\n${ctx.previousReview.reasons.map((r) => `- ${r}`).join("\n")}` : "You raised no blocking objections then.",
      ctx.previousReview.minor.length ? `Suggestions you made then:\n${ctx.previousReview.minor.map((r) => `- ${r}`).join("\n")}` : "",
      "The author has revised the work in response. Check whether each earlier objection is now addressed. Raise a NEW blocking objection only if it is material and could not have been raised before; anything else goes in `minor`.",
    ].filter(Boolean).join("\n\n");
  }
  const v = await ctx.judge({
    gate: ctx.gate,
    role: JUDGED[ctx.gate],
    rubric,
    inputs,
    extras,
    key: ctx.key,
    phase: ctx.phase,
    ...(ctx.itemId !== undefined ? { itemId: ctx.itemId } : {}),
  });
  const evidence: GateOutcome["evidence"] = inputs.map((a) => ({ type: "artifact" as const, ref: { kind: a.meta.kind, id: a.meta.id } }));
  if (v.citations.length === 0) {
    return { verdict: "fail", evidence, citations: [], reasons: [`${JUDGED[ctx.gate]} returned a verdict with no citations; a verdict must point at evidence`, ...v.reasons] };
  }
  const known = new Set(inputs.map((a) => `${a.meta.kind}/${a.meta.id}`));
  const bad = v.citations.filter((c) => !known.has(`${c.ref.kind}/${c.ref.id}`));
  if (bad.length) {
    return { verdict: "fail", evidence, citations: v.citations, reasons: [`${JUDGED[ctx.gate]} cited artifacts it was not shown: ${bad.map((c) => c.ref.id).join(", ")}`, ...v.reasons] };
  }
  // The verdict follows the blocking list, so a judge cannot fail work on suggestions alone.
  const verdict = v.reasons.length > 0 ? "fail" : "pass";
  const minor = v.verdict !== verdict ? [...v.minor, `(verdict corrected from ${v.verdict}: ${verdict === "pass" ? "no blocking objections were given" : "blocking objections were given"})`] : v.minor;
  return { verdict, evidence, citations: v.citations, reasons: v.reasons, minor };
}
