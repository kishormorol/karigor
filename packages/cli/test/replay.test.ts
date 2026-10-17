import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, noopCommitter, type Event, type ProjectState } from "@karigor/store";
import { FakeSandbox } from "@karigor/gates";
import { createProject, runProject, scriptedAdapter } from "../src/index.js";

const NOW = () => new Date("2026-10-16T20:00:00.000Z");

class Crash extends Error {
  override name = "Crash";
}

async function fullRun(sandbox = new FakeSandbox()) {
  const root = await mkdtemp(join(tmpdir(), "karigor-replay-"));
  const projectId = await createProject(root, "A site where neighbours lend tools", { clock: NOW, committer: noopCommitter, projectId: "p1" });
  const state = await runProject({ root, projectId, adapter: scriptedAdapter(), sandbox, clock: NOW, committer: noopCommitter });
  const store = await FsStore.open(root, projectId, { committer: noopCommitter });
  return { state, events: await store.readEvents(), store };
}

function significant(events: Event[]): string[] {
  return events
    .filter((e) => ["transition", "item-status", "project-finished", "project-stopped", "template-selected", "budget-chosen"].includes(e.type))
    .map((e) => JSON.stringify({ ...e, seq: 0, at: "", ...("ledgerId" in e ? { ledgerId: "x" } : {}) }));
}

function shape(s: ProjectState) {
  return {
    status: s.status,
    phase: s.phase,
    items: s.items,
    phaseEntries: s.phaseEntries,
    template: s.template,
    counts: Object.fromEntries(Object.entries(s.artifacts).map(([k, v]) => [k, v?.length ?? 0])),
  };
}

describe("resume after a crash", () => {
  it("killing the run after any event and resuming reaches the same end state with no double billing", async () => {
    const reference = await fullRun();
    const total = reference.events.length;
    expect(total).toBeGreaterThan(30);
    // Every 3rd event keeps the test fast; the boundaries are always included.
    const crashPoints = [...new Set([1, 2, 3, ...Array.from({ length: total }, (_, i) => i).filter((i) => i % 3 === 0), total - 2, total - 1])].filter((n) => n > 0 && n < total);
    for (const n of crashPoints) {
      const root = await mkdtemp(join(tmpdir(), "karigor-replay-"));
      const projectId = await createProject(root, "A site where neighbours lend tools", { clock: NOW, committer: noopCommitter, projectId: "p1" });
      let count = 0;
      await expect(
        runProject({ root, projectId, adapter: scriptedAdapter(), sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter, onEvent: () => { if (++count === n) throw new Crash(`at event ${n}`); } }),
      ).rejects.toThrow(Crash);
      const resumed = await runProject({ root, projectId, adapter: scriptedAdapter(), sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
      expect(shape(resumed), `crash at ${n}`).toEqual(shape(reference.state));
      const store = await FsStore.open(root, projectId, { committer: noopCommitter });
      const events = await store.readEvents();
      expect(significant(events), `crash at ${n}`).toEqual(significant(reference.events));
      const ledger = await store.readArtifact("cost-ledger", resumed.ledgerId!);
      const keys = ledger.meta.entries.map((e) => e.idempotencyKey);
      expect(new Set(keys).size, `crash at ${n}`).toBe(keys.length);
      expect(ledger.meta.entries.reduce((s, e) => s + e.cost, 0)).toBe(0);
    }
  }, 120_000);

  it("resuming a finished project is a no-op", async () => {
    const r = await fullRun();
    const again = await runProject({ root: r.store.dir.replace(/\/p1$/, ""), projectId: "p1", adapter: scriptedAdapter(), sandbox: new FakeSandbox(), clock: NOW, committer: noopCommitter });
    expect(again.lastSeq).toBe(r.state.lastSeq);
  });
});
