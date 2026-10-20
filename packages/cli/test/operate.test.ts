import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, noopCommitter } from "@karigor/store";
import { fixture } from "@karigor/profiles";
import { LocalDeploy } from "@karigor/deploy";
import { MockAgent, type AgentRequest } from "@karigor/runtime";
import { freePort } from "@karigor/deploy";
import { createProject, serveProject, errorSignals, feedbackSignal, healthSignal, normaliseError, operateOnce, recordSignals, renderExplain, renderStatus, runProject, scriptedAdapter, startMaintenance } from "../src/index.js";

const NOW = () => new Date("2026-10-20T00:00:00.000Z");

function devAgent() {
  return new MockAgent((req: AgentRequest) => {
    const itemId = /"id": "([a-z0-9-]+)"/.exec(req.user)?.[1] ?? "x";
    return { files: { [`src/${itemId}.js`]: `export const v = "${itemId}";\n`, "tests.json": JSON.stringify({ passed: 2, failed: 0, skipped: 0 }) }, summary: `Implemented ${itemId} with tests.` };
  });
}

async function released() {
  const root = await mkdtemp(join(tmpdir(), "karigor-operate-"));
  const projectId = await createProject(root, "A site where neighbours lend tools", { clock: NOW, committer: noopCommitter, projectId: "p1" });
  const deploy = new LocalDeploy({ projectDir: join(root, projectId), profile: fixture, healthTimeoutMs: 10_000 });
  const base = { root, projectId, adapter: scriptedAdapter(), profile: fixture, agent: devAgent(), deploy, clock: NOW, committer: noopCommitter };
  const state = await runProject(base);
  expect(state.status).toBe("finished");
  return { root, projectId, deploy, base };
}

describe("maintenance loop", { timeout: 120_000 }, () => {
  it("feedback on a released project runs a fix round that ships a second release", async () => {
    const { root, projectId, deploy, base } = await released();
    const first = await deploy.current();
    let planned = "";
    const adapter = scriptedAdapter({
      override: (req) => {
        if (req.role === "planner") planned = req.user;
        return undefined;
      },
    });
    const r = await operateOnce({ ...base, adapter, agent: devAgent(), signals: [feedbackSignal("Please let people add a photo of the tool.")] });
    expect(r.recorded.length).toBe(1);
    expect(r.cycle).toBe(1);
    expect(r.state.status).toBe("finished");
    expect(r.state.template).toBe("maintenance");
    expect(planned).toMatch(/add a photo of the tool/);
    // new items never collide with the first build's
    expect(Object.keys(r.state.items)).toEqual(expect.arrayContaining(["b1", "m1-b1", "m1-b2", "m1-b3"]));
    expect(r.state.items["m1-b1"]?.status).toBe("done");
    expect(Object.values(r.state.workItems).map((w) => w.status)).toEqual(["done"]);
    const now = await deploy.current();
    expect(now?.version).toMatch(/^r2-/);
    expect(now?.history).toEqual([first!.version]);
    // the fix round spent from its own budget slice
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    const ledger = await store.readArtifact("cost-ledger", r.state.ledgerId!);
    expect(Object.keys(ledger.meta.phaseBudgets)).toEqual(expect.arrayContaining(["m1:triage", "m1:build", "m1:release"]));
    expect(ledger.meta.entries.some((e) => e.phase === "m1:triage")).toBe(true);
    const keys = ledger.meta.entries.map((e) => e.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    // the story and status say it in plain words
    const story = await renderExplain(store, await store.readEvents());
    expect(story).toMatch(/Feedback received: Please let people add a photo/);
    expect(story).toMatch(/Started fix round 1 for 1 problem or request/);
    expect(story).toMatch(/Put r2-[0-9a-f]{7} on production/);
    expect(await renderStatus(store, r.state)).toMatch(/updated \(fix round 1\)/);
    // a second pass with nothing new does nothing
    const again = await operateOnce({ ...base, adapter, agent: devAgent() });
    expect(again.recorded).toEqual([]);
    expect(again.cycle).toBeUndefined();
  });

  it("files a fingerprint once while it is open, and not before the project has been built", async () => {
    const root = await mkdtemp(join(tmpdir(), "karigor-operate-"));
    const projectId = await createProject(root, "idea", { clock: NOW, committer: noopCommitter, projectId: "p1" });
    const store = await FsStore.open(root, projectId, { committer: noopCommitter, clock: NOW });
    const ids = await recordSignals(store, [feedbackSignal("More colours"), feedbackSignal("more   colours"), feedbackSignal("Dark mode")], NOW);
    expect(ids.length).toBe(2);
    expect(await recordSignals(store, [feedbackSignal("More colours")], NOW)).toEqual([]);
    expect(await startMaintenance(store, { adapter: scriptedAdapter() })).toBeUndefined();
  });

  it("a fix round that cannot fix stops with its own failure budget, leaving the work item open", async () => {
    const { base } = await released();
    // every fix attempt fails its tests
    const failing = new MockAgent((req: AgentRequest) => {
      const itemId = /"id": "([a-z0-9-]+)"/.exec(req.user)?.[1] ?? "x";
      return { files: { [`src/${itemId}.js`]: "x", "tests.json": JSON.stringify({ passed: 1, failed: 1, skipped: 0 }) }, summary: "tried" };
    });
    const r = await operateOnce({ ...base, agent: failing, signals: [feedbackSignal("Broken button")] });
    expect(r.cycle).toBe(1);
    expect(["stopped", "finished"]).toContain(r.state.status);
    expect(r.state.failures).toBeLessThanOrEqual(15);
    if (r.state.status === "stopped") expect(Object.values(r.state.workItems)[0]?.status).toBe("in-progress");
  });
});

describe("serve: production on this computer", { timeout: 120_000 }, () => {
  it("serves the live release, turns an error in its output into a fix round, and switches to the new release", async () => {
    const { root, projectId, deploy, base } = await released();
    const port = await freePort();
    const ac = new AbortController();
    const lines: string[] = [];
    const { deploy: _d, ...rest } = base;
    const serving = serveProject({ ...rest, agent: devAgent(), profile: fixture, port, everyMs: 800, auditEveryMs: 10 ** 9, signal: ac.signal, log: (l) => lines.push(l) });
    const until = async (f: () => Promise<boolean> | boolean, ms = 60_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await f()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`timed out; log:\n${lines.join("\n")}`);
    };
    const ok = async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined))?.status === 200;
    await until(ok);
    const first = (await deploy.current())!.version;
    expect(await (await fetch(`http://127.0.0.1:${port}/boom`)).text()).toBe("boom");
    await until(async () => (await deploy.current())?.version.startsWith("r2-") ?? false);
    await until(() => lines.some((l) => /serving r2-/.test(l)));
    expect(await ok()).toBe(true);
    ac.abort();
    await serving;
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    const state = await store.replay();
    const items = await Promise.all(Object.keys(state.workItems).map((id) => store.readArtifact("work-item", id)));
    expect(items.map((w) => w.meta.source)).toEqual(["error"]);
    expect(items[0]!.meta.description).toMatch(/Error: boom/);
    expect((await deploy.current())!.history).toEqual([first]);
  });
});

describe("signals", () => {
  it("normalises errors so repeats with different numbers are one problem, and repeats raise severity", () => {
    expect(normaliseError('[12:01:02] Error: user 4411 not found in "tools" at 2026-10-20T10:00:00Z')).toBe(normaliseError('Error: user 9 not found in "loans" at 2026-10-21T11:00:00Z'));
    const lines = [...Array(6)].map((_, i) => `TypeError: cannot read properties of undefined (reading 'id') at row ${i}`);
    const s = errorSignals([...lines, "GET / 200 in 12ms", "ReferenceError: x is not defined"]);
    expect(s.map((x) => x.severity)).toEqual(["high", "medium"]);
    expect(s[0]!.description).toMatch(/6 times/);
  });

  it("one failed check is a blip; two in a row is downtime", async () => {
    let n = 0;
    const flaky = async () => ({ ok: ++n > 1, status: n > 1 ? 200 : 503, output: "" });
    expect(await healthSignal("http://x/health", { gapMs: 1, check: flaky })).toBeUndefined();
    const down = async () => ({ ok: false, status: 503, output: "Service Unavailable" });
    expect(await healthSignal("http://x/health", { gapMs: 1, check: down })).toMatchObject({ source: "downtime", severity: "critical", fingerprint: "downtime" });
  });
});

void readFile;
