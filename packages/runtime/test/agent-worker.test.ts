import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyState, type Artifact } from "@karigor/store";
import { fixture } from "@karigor/profiles";
import { Workspace } from "@karigor/sandbox";
import { MockAgent, runAgentWorker, type AgentRequest } from "../src/index.js";
import { freshStore, idea, openBudget, roleContext, seed, fakeSpecOutput } from "./helpers.js";

const item = { id: "b1", title: "Greeting", description: "Add a greet function", acceptance: ["greet('x') returns 'hello x'", "a test covers it"], priority: "must" as const, estimate: "S" as const, status: "todo" as const, dependsOn: [] };

async function setup() {
  const store = await freshStore();
  const state = emptyState("p1");
  const spec: Artifact = { meta: { id: "spec-1", kind: "spec", createdAt: "2026-10-17T00:00:00.000Z", createdBy: "product-owner", ...(({ assumptions: _a, body: _b, ...rest }) => rest)(fakeSpecOutput) } as Artifact["meta"], body: "# spec" };
  await seed(store, state, [idea, spec]);
  const ctx = await roleContext(store, state, { phase: "build", itemId: "b1", backlog: [item] });
  const workspace = await Workspace.create(join(await mkdtemp(join(tmpdir(), "karigor-agent-")), "ws"), fixture);
  return { ctx, workspace };
}

describe("runAgentWorker", () => {
  it("runs the agent in the workspace, commits as karigor(item), and records a change artifact with the diff", async () => {
    const { ctx, workspace } = await setup();
    let seen: AgentRequest | undefined;
    const agent = new MockAgent((req) => {
      seen = req;
      return { files: { "src/greet.js": "export const greet = (n) => `hello ${n}`;\n", "tests.json": JSON.stringify({ passed: 2, failed: 0, skipped: 0 }) }, summary: "Added greet with a test.\nIt handles empty names." };
    });
    const budget = openBudget();
    const r = await runAgentWorker({ key: "build#1:developer:b1@0", ctx, agent, budget, workspace, stackGuide: "# Stack\nfixture" });
    expect(r.outcome).toBe("ok");
    expect(r.commit).toBeDefined();
    expect(await workspace.itemCommits("b1")).toEqual([r.commit]);
    const change = r.artifacts[0]!;
    expect(change.meta.kind === "change" && change.meta.files.map((f) => f.path).sort()).toEqual(["src/greet.js", "tests.json"]);
    expect(change.meta.kind === "change" && change.meta.commit).toBe(r.commit);
    expect(change.meta.kind === "change" && change.meta.summary).toBe("Added greet with a test.");
    expect(change.body).toMatch(/\+export const greet/);
    expect(seen!.cwd).toBe(workspace.dir);
    expect(seen!.system).toMatch(/# Role: developer \(working in the code\)/);
    expect(seen!.system).toMatch(/# Stack/);
    expect(seen!.user).toMatch(/"id": "b1"/);
    expect(seen!.user).toMatch(/ToolShare/);
    expect(budget.entries.map((e) => e.key)).toEqual(["build#1:developer:b1@0#1"]);
    expect(await workspace.isClean()).toBe(true);
  });

  it("rejects an agent that changes nothing, retries with that feedback, then gives up as invalid", async () => {
    const { ctx, workspace } = await setup();
    const agent = new MockAgent(() => ({ summary: "All done!" }));
    const r = await runAgentWorker({ key: "k", ctx, agent, budget: openBudget(), workspace, stackGuide: "" });
    expect(r.outcome).toBe("invalid");
    expect(r.error).toMatch(/without changing any files/);
    expect(agent.calls.length).toBe(3);
    expect(agent.calls[1]!.user).toMatch(/no files changed/);
  });

  it("resets the tree before each attempt so a crashed attempt leaves nothing behind", async () => {
    const { ctx, workspace } = await setup();
    const agent = new MockAgent((_r, attempt) =>
      attempt === 1 ? { files: { "src/half.js": "broken\n" }, fail: { error: "api", message: "connection reset", retryable: true }, crashAfterWriting: true } : { files: { "src/ok.js": "ok\n" }, summary: "Done." },
    );
    const r = await runAgentWorker({ key: "k", ctx, agent, budget: openBudget(), workspace, stackGuide: "", retryDelayMs: 1 });
    expect(r.outcome).toBe("ok");
    expect(r.attempt).toBe(2);
    const files = r.artifacts[0]!.meta.kind === "change" ? r.artifacts[0]!.meta.files.map((f) => f.path) : [];
    expect(files).toEqual(["src/ok.js"]);
    await expect(readFile(join(workspace.dir, "src/half.js"))).rejects.toThrow();
  });

  it("passes gate feedback into the task and honours budget stops", async () => {
    const { ctx, workspace } = await setup();
    ctx.feedback = { reasons: ["tests-pass: 1 test(s) failed"], previous: [] };
    let user = "";
    const agent = new MockAgent((req) => {
      user = req.user;
      return { files: { "x.txt": "x" }, summary: "fixed" };
    });
    expect((await runAgentWorker({ key: "k", ctx, agent, budget: openBudget(), workspace, stackGuide: "" })).outcome).toBe("ok");
    expect(user).toMatch(/Your previous attempt was rejected/);
    expect(user).toMatch(/tests-pass: 1 test\(s\) failed/);

    const stop = { ...openBudget(), allow: () => ({ ok: false, action: "park" as const, reason: "phase budget exhausted" }) };
    const r = await runAgentWorker({ key: "k2", ctx, agent, budget: stop, workspace, stackGuide: "" });
    expect(r).toMatchObject({ outcome: "over-budget", budgetAction: "park" });
  });

  it("reuses a commit that already carries this key instead of running the agent again", async () => {
    const { ctx, workspace } = await setup();
    const agent = new MockAgent(() => ({ files: { "src/first.js": "1\n" }, summary: "First attempt." }));
    const r1 = await runAgentWorker({ key: "build#1:developer:b1@0", ctx, agent, budget: openBudget(), workspace, stackGuide: "" });
    expect(r1.outcome).toBe("ok");
    const r2 = await runAgentWorker({ key: "build#1:developer:b1@0", ctx, agent, budget: openBudget(), workspace, stackGuide: "" });
    expect(r2.outcome).toBe("ok");
    expect(r2.commit).toBe(r1.commit);
    expect(agent.calls.length).toBe(1);
    expect(r2.artifacts[0]!.meta.kind === "change" && r2.artifacts[0]!.meta.files.map((f) => f.path)).toEqual(["src/first.js"]);
    expect(await workspace.commitForKey("nope")).toBeUndefined();
  });

  it("a refusal is a failure without retry", async () => {
    const { ctx, workspace } = await setup();
    const agent = new MockAgent(() => ({ fail: { error: "refusal", message: "declined" } }));
    const r = await runAgentWorker({ key: "k", ctx, agent, budget: openBudget(), workspace, stackGuide: "" });
    expect(r.outcome).toBe("failed");
    expect(agent.calls.length).toBe(1);
    await writeFile(join(workspace.dir, "dirty.txt"), "x"); // sanity: workspace still usable
    expect(await workspace.isClean()).toBe(false);
  });
});
