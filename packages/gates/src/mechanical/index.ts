import type { ArtifactRef, ArtifactMeta } from "@karigor/store";
import { ArtifactSchema } from "@karigor/store";
import type { GateContext } from "../context.js";
import type { GateOutcome } from "../engine.js";

type Evidence = GateOutcome["evidence"][number];
const text = (t: string): Evidence => ({ type: "text", text: t.slice(0, 4000) });
const art = (ref: ArtifactRef): Evidence => ({ type: "artifact", ref });

function latest(ctx: GateContext, kind: ArtifactMeta["kind"]): string | undefined {
  const ids = ctx.state.artifacts[kind];
  return ids?.[ids.length - 1];
}

export const mechanical = {
  async "schema-valid"(ctx: GateContext): Promise<GateOutcome> {
    const reasons: string[] = [];
    const evidence: Evidence[] = [];
    for (const ref of ctx.produced) {
      try {
        const a = await ctx.store.readArtifact(ref.kind, ref.id);
        ArtifactSchema.parse(a);
        evidence.push(art(ref));
      } catch (e) {
        reasons.push(`${ref.kind} ${ref.id}: ${(e as Error).message}`);
      }
    }
    if (ctx.produced.length === 0) reasons.push("nothing was produced in this scope");
    return { verdict: reasons.length ? "fail" : "pass", evidence: evidence.length ? evidence : [text("no artifacts")], citations: [], reasons };
  },

  async "budget-ok"(ctx: GateContext): Promise<GateOutcome> {
    const r = ctx.budgetCheck?.() ?? { ok: true, reason: "no budget check configured" };
    return { verdict: r.ok ? "pass" : "fail", evidence: [text(r.reason)], citations: [], reasons: r.ok ? [] : [r.reason] };
  },

  async "tests-pass"(ctx: GateContext): Promise<GateOutcome> {
    const run = await ctx.sandbox.runTests(ctx.itemId);
    const id = ctx.makeId("test-report");
    const meta = {
      id,
      kind: "test-report" as const,
      createdAt: ctx.clock().toISOString(),
      createdBy: "system" as const,
      phase: ctx.phase,
      suite: run.suite,
      passed: run.passed,
      failed: run.failed,
      skipped: run.skipped,
      durationMs: run.durationMs,
      ...(ctx.itemId !== undefined ? { itemId: ctx.itemId } : {}),
    };
    await ctx.store.writeArtifact({ meta, body: run.output });
    const reasons: string[] = [];
    if (run.failed > 0) reasons.push(`${run.failed} test(s) failed`);
    if (run.passed === 0) reasons.push("no tests ran; every item must come with tests");
    return { verdict: reasons.length ? "fail" : "pass", evidence: [art({ kind: "test-report", id })], citations: [], reasons, artifactIds: [id] };
  },

  async "lint-clean"(ctx: GateContext): Promise<GateOutcome> {
    const r = await ctx.sandbox.lint();
    return { verdict: r.ok ? "pass" : "fail", evidence: [text(r.output)], citations: [], reasons: r.ok ? [] : ["lint reported problems"] };
  },

  async "build-succeeds"(ctx: GateContext): Promise<GateOutcome> {
    const r = await ctx.sandbox.build();
    return { verdict: r.ok ? "pass" : "fail", evidence: [text(r.output)], citations: [], reasons: r.ok ? [] : ["build failed"] };
  },

  async "security-scan-clean"(ctx: GateContext): Promise<GateOutcome> {
    const r = await ctx.sandbox.securityScan();
    const blocking = r.findings.filter((f) => f.severity === "high" || f.severity === "critical");
    return {
      verdict: blocking.length ? "fail" : "pass",
      evidence: [text(r.output)],
      citations: [],
      reasons: blocking.map((f) => `${f.severity}: ${f.title}${f.location ? ` at ${f.location}` : ""}`),
    };
  },

  async "journeys-pass"(ctx: GateContext): Promise<GateOutcome> {
    const r = await ctx.sandbox.journeys();
    if (!r.available) return { verdict: "pass", evidence: [text(r.output)], citations: [], reasons: [] };
    const reasons = r.failures.length ? r.failures.map((f) => `journey failed: ${f}`) : r.failed > 0 ? [`${r.failed} journey(s) failed`] : [];
    if (r.passed + r.failed === 0) reasons.push("no browser journeys ran; each kind of user's main job needs one in tests/e2e");
    return { verdict: reasons.length ? "fail" : "pass", evidence: [text(`${r.passed} passed, ${r.failed} failed\n${r.output}`)], citations: [], reasons };
  },

  async "preview-healthy"(ctx: GateContext): Promise<GateOutcome> {
    const id = latest(ctx, "deploy-record");
    if (!id) return { verdict: "fail", evidence: [text("no deploy record")], citations: [], reasons: ["nothing has been deployed to a preview"] };
    const rec = await ctx.store.readArtifact("deploy-record", id);
    if (rec.meta.environment !== "preview" || rec.meta.status !== "deployed" || !rec.meta.url) {
      return { verdict: "fail", evidence: [art({ kind: "deploy-record", id })], citations: [], reasons: ["latest deploy record is not a successful preview with a URL"] };
    }
    const r = await ctx.sandbox.checkUrl(rec.meta.url);
    return {
      verdict: r.ok ? "pass" : "fail",
      evidence: [art({ kind: "deploy-record", id }), text(`${rec.meta.url} -> ${r.status}: ${r.output}`)],
      citations: [],
      reasons: r.ok ? [] : [`preview ${rec.meta.url} answered ${r.status}`],
    };
  },

  async "rollback-verified"(ctx: GateContext): Promise<GateOutcome> {
    const r = await ctx.sandbox.verifyRollback();
    return { verdict: r.ok ? "pass" : "fail", evidence: [text(r.output)], citations: [], reasons: r.ok ? [] : ["rollback dry run failed"] };
  },
};
