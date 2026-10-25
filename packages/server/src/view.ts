import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { FsStore, type BacklogItem, type ProjectState } from "@karigor/store";
import { meter } from "@karigor/budget";
import { liveRecord, reasonIn, renderExplain, stagePlan, storyWords, type Lang } from "@karigor/cli";
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
  /** The kernel's name for the phase (specify, design, plan, build, release...), for the progress steps. */
  phaseKey?: string;
  cycle: number;
  work: { done: number; open: number; parked: { title: string; reason: string }[] };
  decisions: { id: string; topic: string; decision: string; correctedTo?: string }[];
  cost?: { currency: string; spent: number; budget: number; tier: string; apiEquivalent: number };
  summary?: { headline: string; whatItDoes: string; howToUse: string; url?: string };
  live?: NonNullable<Awaited<ReturnType<typeof liveRecord>>>;
  /** While waiting: the settings only the person can give, with the developer's plain description. */
  waitingFor?: { name: string; note: string; kind: string; service?: string }[];
  workItems: { id: string; title: string; status: string; source: string }[];
  /** The plan's stages when there is more than one, and the next one to build. */
  stages?: { name: string; goal: string; state: "built" | "building" | "later" }[];
  nextStage?: { name: string; goal: string };
  /** The event log as plain sentences, oldest first. */
  story: string[];
  lastSeq: number;
  updatedAt: string;
}

/** The one-sentence headline, in the page's language; what the agents wrote (a stop reason, the summary) stays as written. */
const HEADLINES: Record<Lang, { starting: string; notStarted: string; working: string; paused: string; adding: (name?: string) => string; fixRound: (n: number) => string; waiting: string; finished: string; stopped: (why?: string) => string }> = {
  en: {
    starting: "Starting.", notStarted: "Waiting to start.", working: "Working", paused: "Paused",
    adding: (name) => `adding ${name ?? "the next part"}`, fixRound: (n) => `fix round ${n}`,
    waiting: "Built. Waiting for a few things only you can give.", finished: "Finished.",
    stopped: (why) => `Stopped: ${why ?? "no reason recorded"}`,
  },
  bn: {
    starting: "শুরু হচ্ছে।", notStarted: "শুরুর অপেক্ষায়।", working: "কাজ চলছে", paused: "বিরতি",
    adding: (name) => `${name ?? "পরের অংশ"} যোগ হচ্ছে`, fixRound: (n) => `ঠিক করার রাউন্ড ${n}`,
    waiting: "তৈরি হয়ে গেছে। শুধু আপনিই দিতে পারেন এমন কয়েকটি জিনিসের অপেক্ষায়।", finished: "শেষ হয়েছে।",
    stopped: (why) => `থেমে গেছে: ${why ? reasonIn("bn", why) : "কোনো কারণ লেখা নেই"}`,
  },
};

export async function projectView(store: FsStore, running: boolean, lang: Lang = "en"): Promise<ProjectView> {
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
  const phase = state.phase && state.phase !== "done" ? storyWords(lang).phase(state.phase) : undefined;
  const h = HEADLINES[lang];
  const end = lang === "bn" ? "।" : ".";
  const plan = await stagePlan(store, state);
  const stages = plan.stages.length > 1 ? plan.stages.map((s) => ({ name: s.name, goal: s.goal, state: plan.built.has(s.id) ? ("built" as const) : s.id === plan.current?.id ? ("building" as const) : ("later" as const) })) : undefined;
  const headline =
    state.status === "created"
      ? running ? h.starting : h.notStarted
      : state.status === "running"
        ? `${running ? h.working : h.paused}: ${phase ?? h.starting.slice(0, -1)}${state.stage ? ` (${h.adding(plan.current?.name)})` : state.cycle ? ` (${h.fixRound(state.cycle)})` : ""}${end}`
        : state.status === "waiting"
          ? h.waiting
          : state.status === "finished"
          ? summary?.headline ?? h.finished
          : h.stopped(state.stopReason);
  const last = events.at(-1);
  const waitingFor = state.status === "waiting" ? (await readSettings(join(store.dir, "workspace"))).filter((s) => state.waitingFor?.includes(s.name)).map((s) => ({ name: s.name, note: s.note, kind: s.kind, ...(s.service ? { service: s.service } : {}) })) : [];
  return {
    id: store.projectId,
    idea,
    status: state.status,
    running,
    headline,
    ...(phase ? { phase } : {}),
    ...(state.phase ? { phaseKey: state.phase } : {}),
    cycle: state.cycle,
    work: {
      done: items.filter((b) => st(b) === "done").length,
      open: items.filter((b) => ["todo", "in-progress"].includes(st(b))).length,
      parked: items.filter((b) => st(b) === "parked").map((b) => ({ title: b.title, reason: reasonIn(lang, state.items[b.id]?.reason ?? "") })),
    },
    decisions: ledger.map((a) => ({ id: a.id, topic: a.topic, decision: a.decision, ...(state.corrections[a.id] ?? a.correctedTo ? { correctedTo: state.corrections[a.id] ?? a.correctedTo! } : {}) })),
    ...(m ? { cost: { currency: m.currency, spent: m.total, budget: m.budgetTotal, tier: m.tier, apiEquivalent: m.apiEquivalent } } : {}),
    ...(summary ? { summary: { headline: summary.headline, whatItDoes: summary.whatItDoes, howToUse: summary.howToUse, ...(summary.url ? { url: summary.url } : {}) } } : {}),
    ...(live ? { live } : {}),
    ...(waitingFor.length ? { waitingFor } : {}),
    workItems,
    ...(stages ? { stages } : {}),
    ...(state.status === "finished" && plan.next && plan.stages.length > 1 ? { nextStage: { name: plan.next.name, goal: plan.next.goal } } : {}),
    story: (await renderExplain(store, events, lang)).split("\n").filter(Boolean),
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
