import { mkdtemp, appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, StoreError, TornTailError, gitCommitter, makeId } from "../src/index.js";
import * as fx from "./fixtures/artifacts.js";

const root = () => mkdtemp(join(tmpdir(), "karigor-store-"));
const fixedClock = () => new Date("2026-10-16T20:00:00.000Z");

describe("FsStore", () => {
  it("writes and reads artifacts by kind and id", async () => {
    const s = await FsStore.createEphemeral(await root(), "p1");
    await s.writeArtifact(fx.spec);
    expect(await s.readArtifact("spec", "spec-1")).toEqual(fx.spec);
    expect(await s.listArtifacts("spec")).toEqual(["spec-1"]);
    expect(await s.listArtifacts("backlog")).toEqual([]);
    await expect(s.readArtifact("idea", "spec-1")).rejects.toThrow(StoreError);
  });

  it("assigns seq and timestamps on append, and replays", async () => {
    const s = await FsStore.createEphemeral(await root(), "p1", fixedClock);
    const e0 = await s.appendEvent({ type: "project-created", by: "system", projectId: "p1", ideaId: "idea-1" });
    const e1 = await s.appendEvent({ type: "phase-entered", by: "system", phase: "specify" });
    expect([e0.seq, e1.seq]).toEqual([0, 1]);
    expect(e0.at).toBe("2026-10-16T20:00:00.000Z");
    const state = await s.replay();
    expect(state.status).toBe("running");
    expect(state.phase).toBe("specify");
    expect(state.lastSeq).toBe(1);
  });

  it("reopens and continues the sequence", async () => {
    const r = await root();
    const s = await FsStore.createEphemeral(r, "p1");
    await s.appendEvent({ type: "project-created", by: "system", projectId: "p1", ideaId: "idea-1" });
    const s2 = await FsStore.open(r, "p1", { committer: { init: async () => {}, commit: async () => {} } });
    const e = await s2.appendEvent({ type: "project-finished", by: "system" });
    expect(e.seq).toBe(1);
    expect((await s2.replay()).status).toBe("finished");
  });

  it("refuses to create over an existing project and to open a missing one", async () => {
    const r = await root();
    await FsStore.createEphemeral(r, "p1");
    await expect(FsStore.createEphemeral(r, "p1")).rejects.toThrow(/already exists/);
    await expect(FsStore.open(r, "nope")).rejects.toThrow(/no project/);
  });

  it("a torn last line is reported by readEvents and repaired by open", async () => {
    const r = await root();
    const s = await FsStore.createEphemeral(r, "p1");
    await s.appendEvent({ type: "project-created", by: "system", projectId: "p1", ideaId: "idea-1" });
    await appendFile(join(r, "p1", "events.jsonl"), '{"seq":1,"at":"2026-10-16T20:00:00.000Z","type":"phase-ent');
    await expect(s.readEvents()).rejects.toThrow(TornTailError);
    const reopened = await FsStore.open(r, "p1", { committer: { init: async () => {}, commit: async () => {} } });
    expect((await reopened.readEvents()).length).toBe(1);
    const e = await reopened.appendEvent({ type: "project-finished", by: "system" });
    expect(e.seq).toBe(1);
    expect((await reopened.readEvents()).length).toBe(2);
  });

  it("a corrupt line in the middle is an error, not a repair", async () => {
    const r = await root();
    const s = await FsStore.createEphemeral(r, "p1");
    await s.appendEvent({ type: "project-created", by: "system", projectId: "p1", ideaId: "idea-1" });
    await appendFile(join(r, "p1", "events.jsonl"), 'garbage\n{"seq":2,"at":"2026-10-16T20:00:00.000Z","type":"project-finished","by":"system"}\n');
    await expect(s.readEvents()).rejects.toThrow(/line 2 is not valid JSON/);
  });

  it("appends a batch atomically with consecutive seqs", async () => {
    const r = await root();
    const s = await FsStore.createEphemeral(r, "p1");
    const batch = await s.appendEvents([
      { type: "project-created", by: "system", projectId: "p1", ideaId: "idea-1" },
      { type: "phase-entered", by: "system", phase: "specify" },
      { type: "project-finished", by: "system" },
    ]);
    expect(batch.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect((await s.replay()).status).toBe("finished");
    expect(await s.appendEvents([])).toEqual([]);
  });

  it("rejects a seq gap on replay", async () => {
    const r = await root();
    const s = await FsStore.createEphemeral(r, "p1");
    await s.appendEvent({ type: "project-created", by: "system", projectId: "p1", ideaId: "idea-1" });
    await appendFile(join(r, "p1", "events.jsonl"), '{"seq":5,"at":"2026-10-16T20:00:00.000Z","type":"project-finished","by":"system"}\n');
    await expect(s.replay()).rejects.toThrow(/seq gap/);
  });

  it("commits with git when asked", async () => {
    const r = await root();
    const s = await FsStore.create(r, "p1", { committer: gitCommitter });
    await s.writeArtifact(fx.idea);
    await s.commit("add idea");
    const head = await readFile(join(r, "p1", ".git", "HEAD"), "utf8");
    expect(head.trim()).toBe("ref: refs/heads/main");
    await s.commit("nothing changed"); // must not throw on a clean tree
  });

  it("makes lowercase sortable ids", () => {
    const id = makeId("spec", fixedClock());
    expect(id).toMatch(/^spec-[a-z0-9]+-[a-f0-9]{6}$/);
  });
});

describe("run lock and inbox", () => {
  it("one process at a time; re-entrant within a process; a dead process's lock is stale; the inbox drains once", async () => {
    const { mkdtemp, writeFile, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { acquireRunLock, assertIdle, drainInbox, queueInbox, runningPid } = await import("../src/index.js");
    const dir = await mkdtemp(join(tmpdir(), "karigor-lock-"));
    const outer = await acquireRunLock(dir);
    const inner = await acquireRunLock(dir);
    await inner();
    expect(await readFile(join(dir, "run.lock"), "utf8")).toBe(`${process.pid}\n`);
    await outer();
    await expect(readFile(join(dir, "run.lock"))).rejects.toThrow();
    // another live process holds it (the parent of this test runner is alive)
    await writeFile(join(dir, "run.lock"), `${process.ppid}\n`);
    expect(await runningPid(dir)).toBe(process.ppid);
    await expect(acquireRunLock(dir)).rejects.toThrow(/already working on this project/);
    await expect(assertIdle(dir, "a correction")).rejects.toThrow(/a correction has to wait/);
    // a process that no longer exists leaves a stale lock
    await writeFile(join(dir, "run.lock"), "999999\n");
    expect(await runningPid(dir)).toBeUndefined();
    await (await acquireRunLock(dir))();
    await queueInbox(dir, { kind: "feedback", text: "one" });
    await queueInbox(dir, { kind: "feedback", text: "two" });
    expect((await drainInbox<{ text: string }>(dir)).map((x) => x.text).sort()).toEqual(["one", "two"]);
    expect(await drainInbox(dir)).toEqual([]);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toMatch(/^run\.lock$[\s\S]*^inbox\/$/m);
  });
});
