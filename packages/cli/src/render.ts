import type { FsStore, ProjectState, Event, BacklogItem } from "@karigor/store";
import { meter, renderMeter } from "@karigor/budget";

/** Plain-language project status for a non-technical reader. */
export async function renderStatus(store: FsStore, state: ProjectState): Promise<string> {
  const lines: string[] = [];
  const idea = state.ideaId ? await store.readArtifact("idea", state.ideaId) : undefined;
  lines.push(`Project ${state.projectId}`);
  if (idea) lines.push(`Idea: ${idea.meta.text}`);
  lines.push("");
  switch (state.status) {
    case "created":
      lines.push("Status: created, not started yet.");
      break;
    case "running":
      lines.push(`Status: in progress, ${phaseWords(state.phase)}${state.sprint ? `, sprint ${state.sprint}` : ""}.`);
      break;
    case "stopped":
      lines.push(`Status: stopped. ${state.stopReason ?? ""}`.trim());
      break;
    case "finished": {
      const ids = state.artifacts.summary ?? [];
      const summary = ids.length ? await store.readArtifact("summary", ids[ids.length - 1]!) : undefined;
      lines.push(`Status: finished. ${summary?.meta.headline ?? ""}`.trim());
      if (summary?.meta.url) lines.push(`Link: ${summary.meta.url}`);
      break;
    }
  }
  if (state.template) lines.push(`Process: ${state.template}; building a ${state.targetProfile ?? "?"}.`);
  if (state.budgetTier) lines.push(`Budget tier: ${state.budgetTier}.`);

  const backlogId = state.artifacts.backlog?.at(-1);
  if (backlogId) {
    const items = (await store.readArtifact("backlog", backlogId)).meta.items;
    const st = (b: BacklogItem) => state.items[b.id]?.status ?? b.status;
    const count = (s: string) => items.filter((b) => st(b) === s).length;
    lines.push("", `Work: ${count("done")} done, ${count("in-progress")} in progress, ${count("todo")} to do, ${count("parked")} parked, ${count("dropped")} replaced by smaller pieces.`);
    for (const b of items) {
      if (st(b) === "parked") lines.push(`  Parked: ${b.title}. ${state.items[b.id]?.reason ?? ""}`.trim());
    }
  }
  if (state.failures > 0) lines.push("", `Problems caught by checks so far: ${state.failures}.`);

  const ledgerId = state.artifacts.ledger?.at(-1);
  if (ledgerId) {
    const ledger = await store.readArtifact("ledger", ledgerId);
    lines.push("", "Decisions made on your behalf (tell us if any is wrong):");
    for (const a of ledger.meta.assumptions) lines.push(`  - ${a.decision}`);
  }
  return lines.join("\n") + "\n";
}

export async function renderCost(store: FsStore, state: ProjectState): Promise<string> {
  if (!state.ledgerId) return "No budget chosen yet.\n";
  const ledger = await store.readArtifact("cost-ledger", state.ledgerId);
  return renderMeter(meter(ledger.meta)) + "\n";
}

/** The event log as a story, one line per thing that happened. */
export async function renderExplain(store: FsStore, events: Event[]): Promise<string> {
  const lines: string[] = [];
  for (const e of events) {
    const t = e.at.slice(11, 19);
    switch (e.type) {
      case "project-created":
        lines.push(`${t} Project created.`);
        break;
      case "template-selected":
        lines.push(`${t} Chose the "${e.template}" process; building a ${e.targetProfile}.`);
        break;
      case "budget-chosen":
        lines.push(`${t} Budget tier: ${e.tier}.`);
        break;
      case "phase-entered":
        lines.push(`${t} ${e.sprint ? `Sprint ${e.sprint} started with ${e.itemIds?.join(", ") ?? ""}` : `Started ${phaseWords(e.phase)}`}.`);
        break;
      case "worker-started":
        lines.push(`${t}   ${e.role}${e.itemId ? ` on ${e.itemId}` : ""} started (attempt ${e.attempt}, ${e.tier} model).`);
        break;
      case "worker-finished":
        lines.push(`${t}   ${e.role}${e.itemId ? ` on ${e.itemId}` : ""} ${e.outcome === "ok" ? `produced ${e.artifacts.map((a) => a.kind).join(", ") || "nothing new"}` : `did not succeed (${e.outcome}${e.error ? `: ${e.error}` : ""})`}.`);
        break;
      case "gate-evaluated": {
        let reasons = "";
        try {
          const r = await store.readArtifact("gate-result", e.resultId);
          reasons = r.meta.reasons.length ? ` ${r.meta.reasons.join("; ")}` : "";
        } catch {
          /* artifact missing; still report the verdict */
        }
        lines.push(`${t}   Check "${e.gate}"${e.itemId ? ` on ${e.itemId}` : ""}: ${e.verdict === "pass" ? "passed" : "FAILED"}.${reasons}`);
        break;
      }
      case "transition":
        lines.push(`${t} Moved from ${e.from} to ${e.to}.`);
        break;
      case "item-status":
        lines.push(`${t}   ${e.itemId} is now ${e.status}${e.reason ? ` (${e.reason})` : ""}.`);
        break;
      case "budget-downgraded":
        lines.push(`${t} Budget for ${e.phase} is tight; switched to the cheaper model.`);
        break;
      case "project-stopped":
        lines.push(`${t} Stopped: ${e.reason}`);
        break;
      case "project-finished":
        lines.push(`${t} Finished.`);
        break;
      case "artifact-written":
        break;
    }
  }
  return lines.join("\n") + "\n";
}

function phaseWords(phase?: string): string {
  switch (phase) {
    case "specify":
      return "writing down what to build";
    case "design":
      return "deciding how to build it";
    case "plan":
      return "breaking the work into pieces";
    case "spike":
      return "testing the riskiest part first";
    case "build":
      return "building";
    case "verify":
      return "checking the whole thing";
    case "release":
      return "putting it online";
    case "triage":
      return "sorting out what needs fixing";
    case "done":
      return "done";
    default:
      return phase ?? "not started";
  }
}
