import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, noopCommitter } from "@karigor/store";
import { FakeSandbox } from "@karigor/gates";
import { createProject, renderCost, renderExplain, renderStatus, runProject, scriptedAdapter } from "../src/index.js";

const NOW = () => new Date("2026-10-16T20:00:00.000Z");

describe("renderers", () => {
  it("status, cost and explain read like plain language on a finished project", async () => {
    const root = await mkdtemp(join(tmpdir(), "karigor-render-"));
    const projectId = await createProject(root, "A site where neighbours lend tools", { clock: NOW, committer: noopCommitter, projectId: "p1" });
    const state = await runProject({ root, projectId, adapter: scriptedAdapter(), sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    const status = await renderStatus(store, state);
    expect(status).toMatch(/Idea: A site where neighbours lend tools/);
    expect(status).toMatch(/Status: finished\. ToolShare is live/);
    expect(status).toMatch(/Link: https:\/\/toolshare.pages.dev/);
    expect(status).toMatch(/Work: 3 done, 0 in progress, 0 to do, 0 parked/);
    expect(status).toMatch(/Decisions made on your behalf/);
    expect(status).toMatch(/- English only for now\./);
    expect(await renderCost(store, state)).toMatch(/Spent USD 0.0000 of USD 0.00 \(free tier/);
    const story = await renderExplain(store, await store.readEvents());
    expect(story).toMatch(/Chose the "iterative" process; building a web-app/);
    expect(story).toMatch(/Started writing down what to build/);
    expect(story).toMatch(/Check "spec-complete": passed/);
    expect(story).toMatch(/Sprint 1 started with b1, b2, b3/);
    expect(story).toMatch(/Finished\./);
  });

  it("explain names the reason a check failed", async () => {
    const root = await mkdtemp(join(tmpdir(), "karigor-render-"));
    const projectId = await createProject(root, "x", { clock: NOW, committer: noopCommitter, projectId: "p1" });
    const sandbox = new FakeSandbox({ scan: { findings: [{ severity: "critical", title: "secret committed" }] } });
    await runProject({ root, projectId, adapter: scriptedAdapter(), sandbox, clock: NOW, committer: noopCommitter });
    const store = await FsStore.open(root, projectId, { committer: noopCommitter });
    const story = await renderExplain(store, await store.readEvents());
    expect(story).toMatch(/Check "security-scan-clean": FAILED\. critical: secret committed/);
    expect(story).toMatch(/Stopped: gate "security-scan-clean" failed/);
    const status = await renderStatus(store, await store.replay());
    expect(status).toMatch(/Status: stopped\. gate "security-scan-clean" failed/);
  });
});
