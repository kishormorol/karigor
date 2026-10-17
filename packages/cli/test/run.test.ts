import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, noopCommitter } from "@karigor/store";
import { FakeSandbox } from "@karigor/gates";
import { createProject, runProject } from "../src/index.js";
import { citeFirst, scriptedAdapter } from "../src/demo.js";

const NOW = () => new Date("2026-10-16T20:00:00.000Z");
const root = () => mkdtemp(join(tmpdir(), "karigor-run-"));

async function fresh(idea = "A site where neighbours lend tools") {
  const r = await root();
  const projectId = await createProject(r, idea, { clock: NOW, committer: noopCommitter, projectId: "p1" });
  return { root: r, projectId };
}

describe("runProject: golden path", () => {
  for (const template of ["iterative", "linear", "spike-then-build"]) {
    it(`${template}: idea to released on the mock adapter at zero cost`, async () => {
      const { root: r, projectId } = await fresh();
      const adapter = scriptedAdapter({ template });
      const state = await runProject({ root: r, projectId, adapter, sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
      expect(state.status).toBe("finished");
      expect(state.template).toBe(template);
      expect(state.failures).toBe(0);
      for (const id of ["b1", "b2", "b3"]) expect(state.items[id]?.status).toBe("done");
      const store = await FsStore.open(r, projectId, { committer: noopCommitter });
      for (const kind of ["spec", "architecture", "backlog", "change", "test-report", "gate-result", "deploy-record", "summary", "cost-ledger", "ledger"] as const) {
        expect((await store.listArtifacts(kind)).length, kind).toBeGreaterThan(0);
      }
      const ledger = await store.readArtifact("cost-ledger", state.ledgerId!);
      expect(ledger.meta.tier).toBe("free");
      expect(ledger.meta.entries.length).toBeGreaterThan(5);
      expect(ledger.meta.entries.reduce((s, e) => s + e.cost, 0)).toBe(0);
      const summary = await store.readArtifact("summary", (await store.listArtifacts("summary"))[0]!);
      expect(summary.meta.url).toBe("https://toolshare.pages.dev");
    });
  }

  it("records a plain-language assumption ledger across roles", async () => {
    const { root: r, projectId } = await fresh();
    const state = await runProject({ root: r, projectId, adapter: scriptedAdapter(), sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
    const store = await FsStore.open(r, projectId, { committer: noopCommitter });
    const ledger = await store.readArtifact("ledger", state.artifacts.ledger!.at(-1)!);
    expect(ledger.meta.assumptions.map((a) => a.topic)).toEqual(["process", "kind of software", "language", "hosting"]);
  });
});

describe("runProject: failures the gates must catch", () => {
  it("a developer that never produces valid work gets its item shrunk, and a hopeless replacement parked", async () => {
    const { root: r, projectId } = await fresh();
    const adapter = scriptedAdapter({
      override: (req) => {
        // b2 and its first replacement never produce valid work; the shrink of the replacement fails too
        if (req.role === "developer" && (req.user.includes('"id": "b2"') || req.user.includes('"id": "b2-a"'))) return { summary: "oops" };
        if (req.role === "planner" && req.user.includes("SHRINK this item") && req.user.split("SHRINK this item")[1]?.includes('"id": "b2-a"')) return { items: [], notes: "" };
        return undefined;
      },
    });
    const state = await runProject({ root: r, projectId, adapter, sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
    expect(state.status).toBe("finished");
    expect(state.items["b1"]?.status).toBe("done");
    expect(state.items["b2"]).toMatchObject({ status: "dropped", failCount: 3 });
    expect(state.items["b2-a"]).toMatchObject({ status: "parked", failCount: 4 });
    expect(state.items["b2-b"]?.status).toBe("done");
    expect(state.items["b3"]?.status).toBe("done");
  });

  it("failing tests send the item back, then shrink it into smaller items", async () => {
    const { root: r, projectId } = await fresh();
    const sandbox = new FakeSandbox({ tests: (itemId) => (itemId === "b3" ? { passed: 0, failed: 2 } : {}) });
    const state = await runProject({ root: r, projectId, adapter: scriptedAdapter(), sandbox, clock: NOW, committer: noopCommitter });
    expect(state.status).toBe("finished");
    expect(state.items["b3"]).toMatchObject({ status: "dropped", failCount: 3 });
    expect(state.items["b3-a"]?.status).toBe("done");
    expect(state.items["b3-b"]?.status).toBe("done");
  });

  it("a skeptic objection to the spec retries the phase, and the second spec passes", async () => {
    const { root: r, projectId } = await fresh();
    let objections = 0;
    const adapter = scriptedAdapter({
      override: (req) => {
        if (req.role === "skeptic" && req.user.includes("Gate: skeptic-review") && req.user.includes("phase specify") && objections++ === 0) {
          return { verdict: "fail", citations: citeFirst(req.user), reasons: ["the audience is vague"] };
        }
        return undefined;
      },
    });
    const state = await runProject({ root: r, projectId, adapter, sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
    expect(state.status).toBe("finished");
    expect(state.phaseEntries["specify"]).toBe(2);
    expect(state.phaseFails["specify"]).toBe(1);
    expect(state.artifacts.spec?.length).toBe(2);
  });

  it("a verdict with no citations cannot pass a gate", async () => {
    const { root: r, projectId } = await fresh();
    const adapter = scriptedAdapter({ override: (req) => (req.role === "reviewer" ? { verdict: "pass", citations: [], reasons: ["fine"] } : undefined) });
    const state = await runProject({ root: r, projectId, adapter, sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
    expect(state.status).toBe("stopped");
    expect(state.stopReason).toMatch(/spec-complete/);
  });

  it("nothing is released without a healthy preview", async () => {
    const { root: r, projectId } = await fresh();
    const state = await runProject({ root: r, projectId, adapter: scriptedAdapter({ deployUrl: null }), sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
    expect(state.status).toBe("stopped");
    expect(state.stopReason).toMatch(/preview-healthy/);
  });

  it("a failed security scan blocks the release", async () => {
    const { root: r, projectId } = await fresh();
    const sandbox = new FakeSandbox({ scan: { findings: [{ severity: "high", title: "SQL injection", location: "src/a.ts" }] } });
    const state = await runProject({ root: r, projectId, adapter: scriptedAdapter(), sandbox, clock: NOW, committer: noopCommitter });
    expect(state.status).toBe("stopped");
    expect(state.stopReason).toMatch(/security-scan-clean/);
  });
});

describe("runProject: budget", () => {
  it("a paid tier on a free adapter still records zero cost; a free tier with a paid model stops honestly", async () => {
    const { root: r, projectId } = await fresh();
    const adapter = scriptedAdapter();
    // pretend the mock adapter is a paid one
    const paid = Object.assign(Object.create(Object.getPrototypeOf(adapter)), adapter, { name: "claude", modelFor: (t: string) => (t === "routine" ? "claude-haiku-5-5" : "claude-opus-5-5") });
    const state = await runProject({ root: r, projectId, adapter: paid, sandbox: new FakeSandbox(), tier: "free", clock: NOW, committer: noopCommitter });
    expect(state.status).toBe("stopped");
    expect(state.stopReason).toMatch(/out of budget/);
  });

  it("the ledger has one entry per model call and no duplicate keys", async () => {
    const { root: r, projectId } = await fresh();
    const adapter = scriptedAdapter();
    const state = await runProject({ root: r, projectId, adapter, sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
    const store = await FsStore.open(r, projectId, { committer: noopCommitter });
    const ledger = await store.readArtifact("cost-ledger", state.ledgerId!);
    expect(ledger.meta.entries.length).toBe(adapter.calls.length);
    expect(new Set(ledger.meta.entries.map((e) => e.idempotencyKey)).size).toBe(ledger.meta.entries.length);
  });
});

describe("runProject: retries carry feedback", () => {
  it("a retried product owner sees the reviewer's reasons and its previous spec, and the ledger does not duplicate", async () => {
    const { root: r, projectId } = await fresh();
    let specCalls = 0;
    let secondPrompt = "";
    const reviewPrompts: string[] = [];
    const adapter = scriptedAdapter({
      override: (req) => {
        if (req.role === "product-owner" && ++specCalls === 2) secondPrompt = req.user;
        if (req.role === "reviewer" && req.user.includes("Gate: spec-complete")) reviewPrompts.push(req.user);
        if (req.role === "reviewer" && req.user.includes("Gate: spec-complete") && specCalls === 1) {
          return { verdict: "fail", citations: citeFirst(req.user), reasons: ["goal 1 is not observable"] };
        }
        return undefined;
      },
    });
    const state = await runProject({ root: r, projectId, adapter, sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
    expect(state.status).toBe("finished");
    expect(specCalls).toBe(2);
    expect(secondPrompt).toMatch(/Your previous attempt was rejected/);
    expect(secondPrompt).toMatch(/spec-complete: goal 1 is not observable/);
    expect(secondPrompt).toMatch(/Your previous spec \(revise this\)/);
    // the re-review sees its own earlier verdict
    expect(reviewPrompts[1]).toMatch(/previous verdict on this same work was: FAIL/);
    expect(reviewPrompts[1]).toMatch(/goal 1 is not observable/);
    const store = await FsStore.open(r, projectId, { committer: noopCommitter });
    const ledger = await store.readArtifact("ledger", state.artifacts.ledger!.at(-1)!);
    expect(ledger.meta.assumptions.map((a) => a.topic)).toEqual(["process", "kind of software", "language", "hosting"]);
  });

  it("a developer whose tests failed sees the test gate's reason on the next round", async () => {
    const { root: r, projectId } = await fresh();
    let round1Prompt = "";
    let fails = 0;
    const sandbox = new FakeSandbox({ tests: (itemId) => (itemId === "b2" && fails++ === 0 ? { passed: 0, failed: 1 } : {}) });
    const adapter = scriptedAdapter({
      override: (req) => {
        if (req.role === "developer" && req.user.includes('"id": "b2"') && req.user.includes("previous attempt")) round1Prompt = req.user;
        return undefined;
      },
    });
    const state = await runProject({ root: r, projectId, adapter, sandbox, clock: NOW, committer: noopCommitter });
    expect(state.status).toBe("finished");
    expect(state.items["b2"]).toMatchObject({ status: "done", failCount: 1 });
    expect(round1Prompt).toMatch(/tests-pass: 1 test\(s\) failed/);
    expect(round1Prompt).toMatch(/Your previous change \(revise this\)/);
  });
});
