import { describe, expect, it } from "vitest";
import { emptyState, type Artifact } from "@karigor/store";
import { NOW } from "./helpers.js";
import { ROLE_DEFINITIONS, readPrompt, ROLES, MockAdapter, runWorker } from "../src/index.js";
import { ROLES as ALL_ROLES } from "@karigor/store";
import { fakeSpecOutput, freshStore, idea, openBudget, roleContext, seed } from "./helpers.js";

describe("role definitions", () => {
  it("every role has a prompt file; producing roles have a schema and a writer", async () => {
    for (const r of ALL_ROLES) {
      if (r === "estimator") continue; // the estimator is code, not a model call
      const p = await readPrompt(r);
      expect(p, r).toMatch(new RegExp(`# Role: ${r.replace("-", " ")}|# Role: ${r}`));
    }
    for (const def of Object.values(ROLE_DEFINITIONS)) {
      expect(def.schema).toBeDefined();
      expect(typeof def.write).toBe("function");
    }
  });

  it("selector writes process and target assumptions into the ledger", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state);
    let prompt = "";
    const adapter = new MockAdapter((req) => {
      prompt = req.user;
      return { template: "iterative", targetProfile: "web-app", reasons: ["several features"], assumptions: [] };
    });
    const r = await runWorker({ role: "selector", key: "k", ctx, adapter, budget: openBudget() });
    expect(r.outcome).toBe("ok");
    expect(prompt).toMatch(/spike-then-build/);
    expect(prompt).toMatch(/mobile-app/);
    const ledger = r.artifacts[0]!;
    expect(ledger.meta.kind === "ledger" && ledger.meta.assumptions.map((a) => a.topic)).toEqual(["process", "kind of software"]);
  });

  it("ledger entries accumulate across roles with stable numbering", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state);
    const r1 = await runWorker({ role: "selector", key: "k1", ctx, adapter: new MockAdapter(() => ({ template: "linear", targetProfile: "static-site", reasons: ["tiny"], assumptions: [] })), budget: openBudget() });
    await seed(store, state, r1.artifacts);
    const r2 = await runWorker({ role: "product-owner", key: "k2", ctx, adapter: new MockAdapter(() => fakeSpecOutput), budget: openBudget() });
    const ledger = r2.artifacts.find((a) => a.meta.kind === "ledger")!;
    expect(ledger.meta.kind === "ledger" && ledger.meta.assumptions.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(ledger.body).toMatch(/\*\*language\*\*: The site is in English/);
  });

  it("planner shrink replaces one item with new ones and refuses reused ids", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const backlog = [
      { id: "b1", title: "big", description: "d", acceptance: ["a"], priority: "must" as const, estimate: "L" as const, status: "todo" as const, dependsOn: [] },
      { id: "b2", title: "other", description: "d", acceptance: ["a"], priority: "should" as const, estimate: "S" as const, status: "todo" as const, dependsOn: ["b1"] },
    ];
    const ctx = await roleContext(store, state, { phase: "build", itemId: "b1", purpose: "shrink", backlog });
    const sub = (id: string) => ({ id, title: id, description: "d", acceptance: ["a"], priority: "must", estimate: "S", dependsOn: [] });
    const good = new MockAdapter(() => ({ items: [sub("b1-a"), sub("b1-b")], notes: "dropped the export" }));
    const r = await runWorker({ role: "planner", key: "k", ctx, adapter: good, budget: openBudget() });
    expect(r.outcome).toBe("ok");
    const bl = r.artifacts[0]!;
    expect(bl.meta.kind === "backlog" && bl.meta.items.map((i) => `${i.id}:${i.status}`)).toEqual(["b1:dropped", "b2:todo", "b1-a:todo", "b1-b:todo"]);
    // b2 depended on b1; it now depends on b1's replacements
    expect(bl.meta.kind === "backlog" && bl.meta.items.find((i) => i.id === "b2")?.dependsOn).toEqual(["b1-a", "b1-b"]);

    const reuse = new MockAdapter(() => ({ items: [sub("b1"), sub("b2")], notes: "" }));
    const r2 = await runWorker({ role: "planner", key: "k2", ctx, adapter: reuse, budget: openBudget() });
    expect(r2.outcome).toBe("invalid");
    expect(r2.error).toMatch(/no new items/);
  });

  it("developer records a change artifact with file sizes and the full contents in the body", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state, { phase: "build", itemId: "b1" });
    const adapter = new MockAdapter(() => ({ summary: "Added the listing form.", files: [{ path: "src/list.ts", content: "export const a = 1;\n" }], notes: [], assumptions: [] }));
    const r = await runWorker({ role: "developer", key: "k", ctx, adapter, budget: openBudget() });
    const change = r.artifacts[0]!;
    expect(change.meta.kind === "change" && change.meta.files).toEqual([{ path: "src/list.ts", action: "write", bytes: 20 }]);
    expect(change.body).toMatch(/## src\/list.ts/);
  });

  it("releaser never invents a URL: a failed deploy yields a record without one", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const ctx = await roleContext(store, state, { phase: "release" });
    const adapter = new MockAdapter(() => ({
      deploy: { target: "none", environment: "preview", version: "0.1.0", status: "failed", rollbackVerified: false, notes: "No deploy adapter ran." },
      summary: { headline: "ToolShare is built but not yet online", whatItDoes: "Lets neighbours list tools.", howToUse: "Not yet available.", whatWasParked: [] },
    }));
    const r = await runWorker({ role: "releaser", key: "k", ctx, adapter, budget: openBudget() });
    expect(r.outcome).toBe("ok");
    const deploy = r.artifacts[0]!;
    expect(deploy.meta.kind === "deploy-record" && deploy.meta.url).toBeUndefined();
    expect(r.artifacts[1]!.body).toMatch(/# ToolShare is built but not yet online/);
  });

  it("releaser describes a real deploy instead of writing its own record, and links the real URL", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const deploy = { meta: { id: "deploy-record-1", kind: "deploy-record" as const, createdAt: NOW().toISOString(), createdBy: "system" as const, target: "local", environment: "preview" as const, url: "http://127.0.0.1:4100", version: "r1-abc1234", status: "deployed" as const, rollbackVerified: false }, body: "preview running" };
    let prompt = "";
    const ctx = await roleContext(store, state, { phase: "release", deploy, deployTarget: "this computer" });
    const adapter = new MockAdapter((req) => {
      prompt = req.user;
      return { summary: { headline: "ToolShare is ready", whatItDoes: "Lends tools.", howToUse: "Open it.", whatWasParked: [] } };
    });
    const r = await runWorker({ role: "releaser", key: "k", ctx, adapter, budget: openBudget() });
    expect(prompt).toMatch(/already ran/);
    expect(r.artifacts.map((a) => a.meta.kind)).toEqual(["summary"]);
    expect(r.artifacts[0]!.meta.kind === "summary" && r.artifacts[0]!.meta.url).toBe("http://127.0.0.1:4100");
  });

  it("planner sent back in the first build keeps finished items' ids, so they are not rebuilt", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    state.items = { b1: { status: "done", failCount: 0 }, b2: { status: "done", failCount: 0 } };
    const ctx = await roleContext(store, state, { phase: "plan" });
    const sub = (id: string) => ({ id, title: id, description: "d", acceptance: ["a"], priority: "must", estimate: "S", dependsOn: [] });
    const r = await runWorker({ role: "planner", key: "k", ctx, adapter: new MockAdapter(() => ({ items: [sub("b1"), sub("b2"), sub("fix-vulnerable-deps")], notes: "adds a fix" })), budget: openBudget() });
    const bl = r.artifacts[0]!;
    expect(bl.meta.kind === "backlog" && bl.meta.items.map((i) => i.id)).toEqual(["b1", "b2", "fix-vulnerable-deps"]);
  });

  it("planner in maintenance sees open work items from state and never reuses a settled id", async () => {
    const store = await freshStore();
    const state = emptyState("p1");
    await seed(store, state, [idea]);
    const work: Artifact = { meta: { id: "work-item-1", kind: "work-item", createdAt: NOW().toISOString(), createdBy: "user", source: "feedback", severity: "medium", title: "Add Bangla", description: "Please add Bangla.", status: "todo", fingerprint: "feedback:bangla" }, body: "Please add Bangla." };
    const fixed: Artifact = { meta: { ...work.meta, id: "work-item-0", description: "old", fingerprint: "feedback:old" } as Artifact["meta"], body: "old" };
    await seed(store, state, [work, fixed]);
    state.workItems = { "work-item-1": { status: "in-progress", severity: "medium", fingerprint: "feedback:bangla", cycle: 1 }, "work-item-0": { status: "done", severity: "medium", fingerprint: "feedback:old", cycle: 1 } };
    state.cycle = 1;
    state.items = { b1: { status: "done", failCount: 0 }, b2: { status: "done", failCount: 0 } };
    let prompt = "";
    const ctx = await roleContext(store, state, { phase: "triage" });
    const sub = (id: string, dependsOn: string[] = []) => ({ id, title: id, description: "d", acceptance: ["a"], priority: "must", estimate: "S", dependsOn });
    const adapter = new MockAdapter((req) => {
      prompt = req.user;
      return { items: [sub("b1"), sub("b3", ["b1"]), sub("b2", ["b1"])], notes: "" };
    });
    const r = await runWorker({ role: "planner", key: "k", ctx, adapter, budget: openBudget() });
    expect(prompt).toMatch(/Please add Bangla/);
    expect(prompt).not.toMatch(/feedback:old/);
    const bl = r.artifacts[0]!;
    expect(bl.meta.kind === "backlog" && bl.meta.items.map((i) => `${i.id}<${i.dependsOn.join(",")}`)).toEqual(["m1-b1<", "b3<m1-b1", "m1-b2<m1-b1"]);
  });
});

void ROLES;
