import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsStore, emptyState, makeId, type Artifact, type ProjectState } from "@karigor/store";
import { loadTemplate, listTemplates } from "@karigor/process";
import type { RoleContext } from "../src/index.js";
import type { WorkerBudget } from "../src/index.js";

export const NOW = () => new Date("2026-10-16T20:00:00.000Z");

export async function freshStore(): Promise<FsStore> {
  return FsStore.createEphemeral(await mkdtemp(join(tmpdir(), "karigor-rt-")), "p1", NOW);
}

export async function roleContext(store: FsStore, state: ProjectState, over: Partial<RoleContext> = {}): Promise<RoleContext> {
  const templates = await Promise.all((await listTemplates()).map((n) => loadTemplate(n)));
  return { state, store, phase: "specify", backlog: [], templates, clock: NOW, makeId: (k) => makeId(k, NOW()), ...over };
}

export async function seed(store: FsStore, state: ProjectState, artifacts: Artifact[]): Promise<void> {
  for (const a of artifacts) {
    await store.writeArtifact(a);
    (state.artifacts[a.meta.kind] ??= []).push(a.meta.id);
  }
}

export const idea: Artifact = {
  meta: { id: "idea-1", kind: "idea", createdAt: NOW().toISOString(), createdBy: "user", text: "A site where neighbours lend tools", locale: "en" },
  body: "A site where neighbours lend tools",
};

export function openBudget(): WorkerBudget & { entries: { key: string; tier: string }[] } {
  const entries: { key: string; tier: string }[] = [];
  return {
    entries,
    allow: () => ({ ok: true, reason: "open" }),
    record: (e) => {
      if (entries.some((x) => x.key === e.key)) throw new Error(`double record ${e.key}`);
      entries.push({ key: e.key, tier: e.tier });
    },
  };
}

export const fakeSpecOutput = {
  title: "ToolShare",
  audience: "Neighbours on the same street",
  problem: "Borrowing a drill from a neighbour is awkward to arrange",
  goals: ["A neighbour can list a tool in under a minute"],
  nonGoals: ["Payments"],
  features: [{ id: "f1", name: "List a tool", description: "Add a tool with a photo", priority: "must" }],
  successCriteria: ["Two neighbours complete a loan within a week of launch"],
  assumptions: [{ topic: "language", decision: "The site is in English.", reason: "The idea was written in English." }],
  body: "# ToolShare\n\nA site where neighbours lend tools.",
};

export { emptyState };
