import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FsStore, emptyState, makeId, type Artifact, type GateName, type ProjectState } from "@karigor/store";
import { FakeSandbox, evaluate, scriptedJudge, type GateContext, type Judge } from "../src/index.js";

const now = () => new Date("2026-10-16T20:00:00.000Z");
const at = now().toISOString();

const spec: Artifact = {
  meta: {
    id: "spec-1", kind: "spec", createdAt: at, createdBy: "product-owner", phase: "specify",
    title: "ToolShare", audience: "neighbours", problem: "borrowing is awkward", goals: ["list a tool"],
    nonGoals: [], features: [{ id: "f1", name: "List", description: "Add a tool", priority: "must" }], successCriteria: ["lists in 5 min"],
  },
  body: "# ToolShare spec\n",
};

let store: FsStore;
let state: ProjectState;
let sandbox: FakeSandbox;

async function ctx(gate: GateName, extra: Partial<GateContext> = {}, judge: Judge = scriptedJudge(() => "pass")): Promise<GateContext> {
  return {
    gate, key: `specify#1:${gate}`, phase: "specify", state, store, sandbox, judge,
    produced: [{ kind: "spec", id: "spec-1" }], clock: now, makeId: (k) => makeId(k, now()), ...extra,
  };
}

beforeEach(async () => {
  store = await FsStore.createEphemeral(await mkdtemp(join(tmpdir(), "karigor-gates-")), "p1");
  state = emptyState("p1");
  state.artifacts = { spec: ["spec-1"] };
  await store.writeArtifact(spec);
  sandbox = new FakeSandbox();
});

describe("mechanical gates", () => {
  it("every pass and fail writes a gate-result artifact with evidence", async () => {
    const r = await evaluate(await ctx("lint-clean"));
    expect(r.verdict).toBe("pass");
    const a = await store.readArtifact("gate-result", r.resultId);
    expect(a.meta.gateKind).toBe("mechanical");
    expect(a.meta.evidence.length).toBeGreaterThan(0);
    expect(a.body).toMatch(/Gate lint-clean: PASS/);
  });

  it("tests-pass writes a test report and fails when nothing ran or something failed", async () => {
    sandbox = new FakeSandbox({ tests: () => ({ passed: 0, failed: 0 }) });
    let r = await evaluate(await ctx("tests-pass", { itemId: "b1" }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toMatch(/no tests ran/);
    expect(r.artifactIds.length).toBe(2); // test report + gate result
    const report = await store.readArtifact("test-report", r.artifactIds[0]!);
    expect(report.meta.itemId).toBe("b1");

    sandbox = new FakeSandbox({ tests: () => ({ passed: 2, failed: 1 }) });
    r = await evaluate(await ctx("tests-pass"));
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toMatch(/1 test\(s\) failed/);
  });

  it("security-scan-clean fails only on high or critical findings", async () => {
    sandbox = new FakeSandbox({ scan: { findings: [{ severity: "low", title: "noisy" }] } });
    expect((await evaluate(await ctx("security-scan-clean"))).verdict).toBe("pass");
    sandbox = new FakeSandbox({ scan: { findings: [{ severity: "critical", title: "secret in repo", location: ".env" }] } });
    const r = await evaluate(await ctx("security-scan-clean"));
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toBe("critical: secret in repo at .env");
  });

  it("preview-healthy needs a successful preview deploy record and a healthy URL", async () => {
    expect((await evaluate(await ctx("preview-healthy"))).reasons[0]).toMatch(/nothing has been deployed/);
    await store.writeArtifact({
      meta: { id: "deploy-1", kind: "deploy-record", createdAt: at, createdBy: "releaser", target: "fake", environment: "preview", url: "https://p.example", version: "1", status: "deployed", rollbackVerified: false },
      body: "",
    });
    state.artifacts["deploy-record"] = ["deploy-1"];
    expect((await evaluate(await ctx("preview-healthy"))).verdict).toBe("pass");
    sandbox = new FakeSandbox({ url: () => ({ ok: false, status: 503 }) });
    const r = await evaluate(await ctx("preview-healthy"));
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toMatch(/answered 503/);
  });

  it("schema-valid re-reads produced artifacts and fails on an empty scope", async () => {
    expect((await evaluate(await ctx("schema-valid"))).verdict).toBe("pass");
    const r = await evaluate(await ctx("schema-valid", { produced: [] }));
    expect(r.verdict).toBe("fail");
  });

  it("budget-ok defers to the injected check", async () => {
    const r = await evaluate(await ctx("budget-ok", { budgetCheck: () => ({ ok: false, reason: "phase budget exhausted" }) }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons).toEqual(["phase budget exhausted"]);
  });
});

describe("judged gates", () => {
  it("passes a cited verdict and records the role and citations", async () => {
    const r = await evaluate(await ctx("spec-complete"));
    expect(r.verdict).toBe("pass");
    const a = await store.readArtifact("gate-result", r.resultId);
    expect(a.meta.gateKind).toBe("judged");
    expect(a.meta.citations[0]?.ref).toEqual({ kind: "spec", id: "spec-1" });
  });

  it("turns a verdict without citations into a fail", async () => {
    const judge = scriptedJudge(() => ({ verdict: "pass", citations: [], reasons: ["looks fine"] }));
    const r = await evaluate(await ctx("spec-complete", {}, judge));
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toMatch(/no citations/);
  });

  it("rejects citations of artifacts the judge was not shown", async () => {
    const judge = scriptedJudge(() => ({ verdict: "pass", citations: [{ ref: { kind: "spec", id: "spec-999" }, quote: "x" }] }));
    const r = await evaluate(await ctx("spec-complete", {}, judge));
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toMatch(/not shown: spec-999/);
  });

  it("hands the skeptic the diff and backlog item for item-level reviews", async () => {
    let seen: Record<string, string> = {};
    const judge: Judge = async (req) => {
      seen = req.extras;
      expect(req.role).toBe("skeptic");
      expect(req.rubric).toMatch(/You are the skeptic/);
      return { verdict: "fail", citations: [{ ref: { kind: "spec", id: "spec-1" }, quote: "ToolShare" }], reasons: ["no empty state"] };
    };
    const item = { id: "b1", title: "t", description: "d", acceptance: ["a"], priority: "must" as const, estimate: "S" as const, status: "todo" as const, dependsOn: [] };
    const r = await evaluate(await ctx("skeptic-review", { itemId: "b1", backlogItem: item }, judge));
    expect(r.verdict).toBe("fail");
    expect(seen["diff"]).toMatch(/\+export const done/);
    expect(JSON.parse(seen["backlog-item"]!).id).toBe("b1");
    expect(sandbox.calls).toContain("diff:b1");
  });

  it("fails when there is nothing to judge", async () => {
    state.artifacts = {};
    const r = await evaluate(await ctx("architecture-sound", { produced: [] }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toMatch(/no artifacts/);
  });
});
