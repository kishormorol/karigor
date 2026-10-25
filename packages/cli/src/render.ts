import { join } from "node:path";
import { readSettings } from "@karigor/profiles";
import { stagePlan } from "./stages.js";
import type { FsStore, ProjectState, Event, BacklogItem, MetaOf } from "@karigor/store";
import { meter, renderMeter } from "@karigor/budget";
import { statusWords, storyWords, type Lang } from "./words.js";

/** Plain-language project status for a non-technical reader. */
export async function renderStatus(store: FsStore, state: ProjectState, lang: Lang = "en"): Promise<string> {
  const w = statusWords(lang);
  const lines: string[] = [];
  const idea = state.ideaId ? await store.readArtifact("idea", state.ideaId) : undefined;
  lines.push(w.project(state.projectId));
  if (idea) lines.push(w.idea(idea.meta.text));
  lines.push("");
  switch (state.status) {
    case "created":
      lines.push(w.created());
      break;
    case "running":
      lines.push(w.running(storyWords(lang).phase(state.phase), state.sprint));
      break;
    case "stopped":
      lines.push(w.stopped(state.stopReason));
      break;
    case "waiting": {
      if (state.pausedReason) {
        lines.push(w.paused(state.pausedReason));
        break;
      }
      lines.push(w.waiting());
      const all = state.waitingFor ?? [];
      lines.push(...all.map((n) => `  - ${n}`), w.giveWith(state.projectId));
      break;
    }
    case "finished": {
      const ids = state.artifacts.summary ?? [];
      const summary = ids.length ? await store.readArtifact("summary", ids[ids.length - 1]!) : undefined;
      lines.push(w.finished(!!state.stage, state.cycle, summary?.meta.headline));
      if (summary?.meta.url) lines.push(w.link(summary.meta.url));
      break;
    }
  }
  if (state.cycle > 0 && state.status === "running") lines.push(state.stage ? w.roundGrow(state.cycle) : w.roundFix(state.cycle));
  const plan = await stagePlan(store, state);
  if (plan.stages.length > 1) {
    lines.push("", w.stages());
    for (const s of plan.stages) lines.push(`  ${w.stageMark(plan.built.has(s.id) ? "built" : s.id === plan.current?.id ? "building" : "later")} ${s.name}: ${s.goal}`);
    if (state.status === "finished" && plan.next) lines.push(w.growWith(state.projectId));
  }
  const live = await liveRecord(store, state);
  if (live && state.status !== "finished") lines.push(w.liveVersion(live.version, live.url));
  if (live?.missingSettings?.length) {
    lines.push("", w.missingSettings());
    const bn = lang === "bn" ? await readSettings(join(store.dir, "workspace")) : [];
    for (const m of live.missingSettings) {
      const note = bn.find((s) => s.name === m.name)?.noteBn ?? m.note;
      lines.push(`  - ${m.name}${note ? `: ${note}` : ""}`);
    }
  }
  const open = Object.entries(state.workItems).filter(([, w]) => w.status !== "done");
  if (open.length) {
    lines.push("", w.openItems(open.length));
    for (const [id] of open.slice(0, 10)) {
      const w = await store.readArtifact("work-item", id).catch(() => undefined);
      if (w) lines.push(`  - ${w.meta.title ?? w.meta.description.split("\n")[0]}`);
    }
  }
  if (state.template) lines.push(w.process(state.template, state.targetProfile ?? "?"));
  if (state.budgetTier) lines.push(w.budget(state.budgetTier));

  const backlogId = state.artifacts.backlog?.at(-1);
  if (backlogId) {
    const items = (await store.readArtifact("backlog", backlogId)).meta.items;
    const st = (b: BacklogItem) => state.items[b.id]?.status ?? b.status;
    const count = (s: string) => items.filter((b) => st(b) === s).length;
    lines.push("", w.work(count("done"), count("in-progress"), count("todo"), count("parked"), count("dropped")));
    for (const b of items) {
      if (st(b) === "parked") lines.push(`  ${w.parked(b.title, state.items[b.id]?.reason)}`);
    }
  }
  if (state.failures > 0) lines.push("", w.failures(state.failures));

  const ledgerId = state.artifacts.ledger?.at(-1);
  if (ledgerId) {
    const ledger = await store.readArtifact("ledger", ledgerId);
    lines.push("", w.decisions());
    for (const a of ledger.meta.assumptions) lines.push(`  - ${a.id}: ${state.corrections[a.id] ? w.corrected(state.corrections[a.id]!) : a.decision}`);
  }
  return lines.join("\n") + "\n";
}

/** The production release that is live now, if any. */
export async function liveRecord(store: FsStore, state: ProjectState) {
  const stack: { version: string; url?: string; releaseId?: string; target: string; missingSettings?: MetaOf<"deploy-record">["missingSettings"] }[] = [];
  for (const id of state.artifacts["deploy-record"] ?? []) {
    const r = (await store.readArtifact("deploy-record", id).catch(() => undefined))?.meta;
    if (!r || r.environment !== "production") continue;
    if (r.status === "deployed") stack.push({ version: r.version, target: r.target, ...(r.url ? { url: r.url } : {}), ...(r.releaseId ? { releaseId: r.releaseId } : {}), ...(r.missingSettings ? { missingSettings: r.missingSettings } : {}) });
    else if (r.status === "rolled-back") stack.pop();
  }
  return stack.at(-1);
}

export async function renderCost(store: FsStore, state: ProjectState): Promise<string> {
  if (!state.ledgerId) return "No budget chosen yet.\n";
  const ledger = await store.readArtifact("cost-ledger", state.ledgerId);
  return renderMeter(meter(ledger.meta)) + "\n";
}

/** The event log as a story, one line per thing that happened. */
/** The story of a project, one line per event; `lang` picks the language of the fixed sentences (the chat page offers Bangla). */
export async function renderExplain(store: FsStore, events: Event[], lang: Lang = "en"): Promise<string> {
  const w = storyWords(lang);
  const lines: string[] = [];
  for (const e of events) {
    const t = e.at.slice(11, 19);
    switch (e.type) {
      case "project-created":
        lines.push(`${t} ${w.created()}`);
        break;
      case "template-selected":
        lines.push(`${t} ${w.template(e.template, e.targetProfile)}`);
        break;
      case "budget-chosen":
        lines.push(`${t} ${w.budget(e.tier)}`);
        break;
      case "phase-entered":
        if (e.phase === "done") break; // "Finished." follows
        lines.push(`${t} ${e.sprint ? w.sprint(e.sprint, e.itemIds?.join(", ") ?? "") : w.phaseStarted(e.phase)}`);
        break;
      case "worker-started":
        lines.push(`${t}   ${w.workerStarted(e.role, e.itemId, e.attempt, e.tier)}`);
        break;
      case "worker-finished":
        lines.push(`${t}   ${e.outcome === "ok" ? w.workerOk(e.role, e.itemId, e.artifacts.map((a) => a.kind).join(", ")) : w.workerFailed(e.role, e.itemId, e.outcome, e.error)}`);
        break;
      case "gate-evaluated": {
        let reasons = "";
        try {
          const r = await store.readArtifact("gate-result", e.resultId);
          reasons = r.meta.reasons.length ? ` ${r.meta.reasons.join("; ")}` : "";
        } catch {
          /* artifact missing; still report the verdict */
        }
        lines.push(`${t}   ${w.gate(e.gate, e.itemId, e.verdict === "pass", reasons)}`);
        break;
      }
      case "transition":
        lines.push(`${t} ${w.transition(e.from, e.to)}`);
        break;
      case "item-status":
        lines.push(`${t}   ${w.itemStatus(e.itemId, e.status, e.reason)}`);
        break;
      case "budget-downgraded":
        lines.push(`${t} ${w.downgraded(e.phase)}`);
        break;
      case "project-stopped":
        lines.push(`${t} ${w.stopped(e.reason)}`);
        break;
      case "project-finished":
        lines.push(`${t} ${w.finished()}`);
        break;
      case "artifact-written":
        if (e.kind === "deploy-record") {
          try {
            const r = (await store.readArtifact("deploy-record", e.id)).meta;
            const preview = r.environment === "preview";
            lines.push(`${t}   ${r.status === "deployed" ? w.deployed(r.version, preview, r.url) : r.status === "failed" ? w.deployFailed(r.version, preview) : w.rolledBack(r.version)}`);
          } catch {
            /* artifact missing */
          }
        }
        break;
      case "signal-received": {
        const a = await store.readArtifact("work-item", e.workItemId).catch(() => undefined);
        const title = a?.meta.title ?? a?.meta.description.split("\n")[0] ?? e.workItemId;
        lines.push(`${t} ${e.source === "feedback" ? w.feedback(title) : w.problem(e.source, e.severity, title)}`);
        break;
      }
      case "maintenance-started":
        lines.push(`${t} ${w.fixRound(e.cycle, e.workItemIds.length)}`);
        break;
      case "project-waiting":
        lines.push(`${t} ${w.waiting(e.needs.join(", "))}`);
        break;
      case "project-resumed":
        lines.push(`${t} ${w.resumed()}`);
        break;
      case "project-paused":
        lines.push(`${t} ${w.paused(e.reason)}`);
        break;
      case "work-item-dismissed":
        lines.push(`${t} ${w.dismissed(e.reason)}`);
        break;
      case "project-reopened":
        lines.push(`${t} ${w.reopened(e.itemIds.length)}`);
        break;
      case "settings-provided":
        lines.push(`${t} ${w.settings(e.by === "system", e.names)}`);
        break;
      case "assumption-corrected":
        lines.push(`${t} ${w.corrected(e.assumptionId, e.correctedTo)}`);
        break;
    }
  }
  return lines.join("\n") + "\n";
}

