import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { FsStore, type BacklogItem, type ProjectState } from "@karigor/store";
import { meter } from "@karigor/budget";
import { liveRecord, renderExplain } from "@karigor/cli";
import { readSettings } from "@karigor/profiles";

/** Everything the chat page shows about one project, in plain language. */
export interface ProjectView {
  id: string;
  idea: string;
  status: ProjectState["status"];
  running: boolean;
  /** One sentence on where things stand. */
  headline: string;
  phase?: string;
  cycle: number;
  work: { done: number; open: number; parked: { title: string; reason: string }[] };
  decisions: { id: string; topic: string; decision: string; correctedTo?: string }[];
  cost?: { currency: string; spent: number; budget: number; tier: string; apiEquivalent: number };
  summary?: { headline: string; whatItDoes: string; howToUse: string; url?: string };
  live?: NonNullable<Awaited<ReturnType<typeof liveRecord>>>;
  /** While waiting: the settings only the person can give, with the developer's plain description. */
  waitingFor?: { name: string; note: string; kind: string; service?: string }[];
  workItems: { id: string; title: string; status: string; source: string }[];
  /** The event log as plain sentences, oldest first. */
  story: string[];
  lastSeq: number;
  updatedAt: string;
}

const PHASE_WORDS: Record<string, string> = {
  specify: "writing down what to build",
  design: "deciding how to build it",
  plan: "breaking the work into pieces",
  spike: "testing the riskiest part first",
  build: "building",
  verify: "checking the whole thing",
  release: "putting it online",
  triage: "sorting out what needs fixing",
};

export async function projectView(store: FsStore, running: boolean): Promise<ProjectView> {
  const events = await store.readEvents();
  const state = await store.replay();
  const idea = state.ideaId ? (await store.readArtifact("idea", state.ideaId)).meta.text : "";
  const backlogId = state.artifacts.backlog?.at(-1);
  const items: BacklogItem[] = backlogId ? (await store.readArtifact("backlog", backlogId)).meta.items : [];
  const st = (b: BacklogItem) => state.items[b.id]?.status ?? b.status;
  const ledgerId = state.artifacts.ledger?.at(-1);
  const ledger = ledgerId ? (await store.readArtifact("ledger", ledgerId)).meta.assumptions : [];
  const costLedger = state.ledgerId ? (await store.readArtifact("cost-ledger", state.ledgerId)).meta : undefined;
  const m = costLedger ? meter(costLedger) : undefined;
  const summaryId = state.artifacts.summary?.at(-1);
  const summary = summaryId ? (await store.readArtifact("summary", summaryId)).meta : undefined;
  const live = await liveRecord(store, state);
  const workItems = await Promise.all(
    Object.entries(state.workItems).map(async ([id, w]) => {
      const a = await store.readArtifact("work-item", id).catch(() => undefined);
      return { id, title: a?.meta.title ?? a?.meta.description.split("\n")[0] ?? id, status: w.status, source: a?.meta.source ?? "manual" };
    }),
  );
  const phase = state.phase ? PHASE_WORDS[state.phase] ?? state.phase : undefined;
  const headline =
    state.status === "created"
      ? running ? "Starting." : "Waiting to start."
      : state.status === "running"
        ? `${running ? "Working" : "Paused"}: ${phase ?? "starting"}${state.cycle ? ` (fix round ${state.cycle})` : ""}.`
        : state.status === "waiting"
          ? "Built. Waiting for a few things only you can give."
          : state.status === "finished"
          ? summary?.headline ?? "Finished."
          : `Stopped: ${state.stopReason ?? "no reason recorded"}`;
  const last = events.at(-1);
  const waitingFor = state.status === "waiting" ? (await readSettings(join(store.dir, "workspace"))).filter((s) => state.waitingFor?.includes(s.name)).map((s) => ({ name: s.name, note: s.note, kind: s.kind, ...(s.service ? { service: s.service } : {}) })) : [];
  return {
    id: store.projectId,
    idea,
    status: state.status,
    running,
    headline,
    ...(phase ? { phase } : {}),
    cycle: state.cycle,
    work: {
      done: items.filter((b) => st(b) === "done").length,
      open: items.filter((b) => ["todo", "in-progress"].includes(st(b))).length,
      parked: items.filter((b) => st(b) === "parked").map((b) => ({ title: b.title, reason: state.items[b.id]?.reason ?? "" })),
    },
    decisions: ledger.map((a) => ({ id: a.id, topic: a.topic, decision: a.decision, ...(state.corrections[a.id] ?? a.correctedTo ? { correctedTo: state.corrections[a.id] ?? a.correctedTo! } : {}) })),
    ...(m ? { cost: { currency: m.currency, spent: m.total, budget: m.budgetTotal, tier: m.tier, apiEquivalent: m.apiEquivalent } } : {}),
    ...(summary ? { summary: { headline: summary.headline, whatItDoes: summary.whatItDoes, howToUse: summary.howToUse, ...(summary.url ? { url: summary.url } : {}) } } : {}),
    ...(live ? { live } : {}),
    ...(waitingFor.length ? { waitingFor } : {}),
    workItems,
    story: (await renderExplain(store, events)).split("\n").filter(Boolean),
    lastSeq: state.lastSeq,
    updatedAt: last?.at ?? new Date(0).toISOString(),
  };
}

export interface ProjectListing {
  id: string;
  idea: string;
  status: ProjectState["status"];
  updatedAt: string;
}

/** Projects under `root`, most recently changed first. */
export async function listProjects(root: string): Promise<ProjectListing[]> {
  const names = await readdir(root).catch(() => [] as string[]);
  const out: ProjectListing[] = [];
  for (const n of names) {
    if (!(await stat(join(root, n, "events.jsonl")).then(() => true, () => false))) continue;
    try {
      const store = await FsStore.open(root, n);
      const events = await store.readEvents();
      const state = await store.replay();
      const idea = state.ideaId ? (await store.readArtifact("idea", state.ideaId)).meta.text : "";
      out.push({ id: n, idea, status: state.status, updatedAt: events.at(-1)?.at ?? "" });
    } catch {
      /* not a readable project */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
