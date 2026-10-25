import type { BacklogItem, ProjectState, Role, GateName, ItemStatus } from "@karigor/store";
import { rungFor } from "./ladder.js";
import type { Template, Phase } from "./template-schema.js";

/** What the orchestrator should do next. The machine never performs IO. */
export type Action =
  | { type: "selectTemplate" }
  | { type: "chooseBudget" }
  | { type: "enterPhase"; phase: string }
  | { type: "startSprint"; phase: string; sprint: number; itemIds: string[] }
  | { type: "invokeRole"; role: Role; key: string; phase: string; itemId?: string; round?: number }
  | { type: "shrinkItem"; key: string; phase: string; itemId: string; round: number }
  | { type: "evaluateGate"; gate: GateName; key: string; phase: string; itemId?: string; round?: number; transitionTo?: string }
  | { type: "itemDone"; itemId: string }
  | { type: "parkItem"; itemId: string; reason: string }
  | { type: "transition"; from: string; to: string }
  | { type: "retryPhase"; phase: string; reason: string }
  | { type: "sendBack"; from: string; to: string; reason: string }
  | { type: "stop"; reason: string }
  | { type: "finish" }
  | { type: "idle" };

export interface MachineInput {
  template: Template;
  state: ProjectState;
  /** Latest backlog, in planner order. Empty before planning. */
  backlog: BacklogItem[];
}

export class MachineError extends Error {
  override name = "MachineError";
}

/** Scope prefix for every key produced inside one phase entry. */
export function scopeOf(phase: string, entry: number): string {
  return `${phase}#${entry}`;
}

function effectiveStatus(state: ProjectState, item: BacklogItem): ItemStatus {
  return state.items[item.id]?.status ?? item.status;
}

function settled(status: ItemStatus): boolean {
  return status === "done" || status === "parked" || status === "dropped";
}

/** Items that can be worked on now: not settled, and every dependency done. */
export function readyItems(state: ProjectState, backlog: BacklogItem[]): BacklogItem[] {
  return backlog.filter((it) => {
    const st = effectiveStatus(state, it);
    if (settled(st)) return false;
    return it.dependsOn.every((d) => {
      const dep = backlog.find((b) => b.id === d);
      return dep !== undefined && effectiveStatus(state, dep) === "done";
    });
  });
}

/**
 * An unsettled item that can never become ready: a dependency is parked, dropped or missing.
 * Returned with the reason so the kernel can park it instead of forgetting it.
 */
export function blockedItem(state: ProjectState, backlog: BacklogItem[]): { item: BacklogItem; reason: string } | undefined {
  for (const it of backlog) {
    if (settled(effectiveStatus(state, it))) continue;
    for (const d of it.dependsOn) {
      const dep = backlog.find((b) => b.id === d);
      if (!dep) return { item: it, reason: `depends on "${d}", which is not in the backlog` };
      const st = effectiveStatus(state, dep);
      if (st === "parked" || st === "dropped") return { item: it, reason: `depends on "${d}", which was ${st}` };
    }
  }
  return undefined;
}

/** Pure: given template, replayed state and backlog, decide the next action. */
export function next(input: MachineInput): Action {
  const { template, state, backlog } = input;
  if (state.status === "stopped" || state.status === "finished" || state.status === "waiting") return { type: "idle" };
  if (!state.template) return { type: "selectTemplate" };
  if (!state.budgetTier) return { type: "chooseBudget" };
  if (state.failures >= template.limits.projectFailures) {
    return { type: "stop", reason: `too many failures (${state.failures}); the failure budget is ${template.limits.projectFailures}` };
  }
  if (!state.entry) return { type: "enterPhase", phase: template.initialPhase };

  const entry = state.entry;
  const phase = template.phases[entry.phase];
  if (!phase) throw new MachineError(`state is in unknown phase "${entry.phase}"`);
  if (phase.terminal) return { type: "finish" };
  const scope = scopeOf(entry.phase, entry.n);

  // Any phase-level failure in this entry means the ladder decides, before anything else runs.
  const phaseFailure = findPhaseFailure(state, scope);
  if (phaseFailure) return phaseFailAction(template, phase, entry.phase, state, phaseFailure);

  // Phase roles (once per entry; for loop phases that is once per sprint).
  if (phase.loop && entry.sprint === undefined) {
    // Fresh entry into a loop phase: start a sprint if anything is ready, park what is blocked, else evaluate the exit gates.
    const ready = readyItems(state, backlog);
    if (ready.length > 0) {
      const n = phase.loop.itemsPerSprint === 0 ? ready.length : phase.loop.itemsPerSprint;
      return { type: "startSprint", phase: entry.phase, sprint: (state.sprint ?? 0) + 1, itemIds: ready.slice(0, n).map((i) => i.id) };
    }
    const blocked = blockedItem(state, backlog);
    if (blocked) return { type: "parkItem", itemId: blocked.item.id, reason: `blocked: ${blocked.reason}` };
    return transitionStep(phase, entry.phase, scope, state);
  }

  for (const role of phase.roles) {
    const key = `${scope}:${role}`;
    const w = state.workers[key];
    if (w?.lastOutcome === "ok") continue;
    return { type: "invokeRole", role, key, phase: entry.phase };
  }

  if (phase.loop) {
    const loop = phase.loop;
    for (const itemId of entry.itemIds ?? []) {
      const item = backlog.find((b) => b.id === itemId);
      if (!item) throw new MachineError(`sprint item "${itemId}" is not in the backlog`);
      const st = state.items[itemId] ?? { status: item.status, failCount: 0 };
      if (settled(st.status)) continue;
      const round = st.failCount;
      if (round > 0) {
        const rung = rungFor(loop.onItemFail, round);
        if (rung.action === "park") return { type: "parkItem", itemId, reason: `failed ${round} times; retry budget exhausted` };
        if (rung.action === "shrink") {
          const key = `${scope}:planner:${itemId}@${round}:shrink`;
          if (state.workers[key]?.lastOutcome !== "ok") return { type: "shrinkItem", key, phase: entry.phase, itemId, round };
          // Shrink finished but the item was not dropped: treat as done with the replacement items.
          continue;
        }
      }
      for (const role of loop.itemRoles) {
        const key = `${scope}:${role}:${itemId}@${round}`;
        if (state.workers[key]?.lastOutcome === "ok") continue;
        return { type: "invokeRole", role, key, phase: entry.phase, itemId, round };
      }
      for (const gate of loop.itemGates) {
        const key = `${scope}:${gate}:${itemId}@${round}`;
        const g = state.gates[key];
        if (g?.verdict === "pass") continue;
        if (g?.verdict === "fail") throw new MachineError(`gate ${key} failed but the item's fail count did not advance`);
        return { type: "evaluateGate", gate, key, phase: entry.phase, itemId, round };
      }
      return { type: "itemDone", itemId };
    }
    // Sprint settled. More work? Next sprint. Blocked work gets parked, not forgotten. Otherwise the exit gates.
    const ready = readyItems(state, backlog);
    if (ready.length > 0) {
      const n = loop.itemsPerSprint === 0 ? ready.length : loop.itemsPerSprint;
      return { type: "startSprint", phase: entry.phase, sprint: (state.sprint ?? 0) + 1, itemIds: ready.slice(0, n).map((i) => i.id) };
    }
    const blocked = blockedItem(state, backlog);
    if (blocked) return { type: "parkItem", itemId: blocked.item.id, reason: `blocked: ${blocked.reason}` };
    const stuck = backlog.find((b) => !settled(effectiveStatus(state, b)));
    if (stuck) return { type: "parkItem", itemId: stuck.id, reason: "blocked: its dependencies form a cycle" };
  }

  return transitionStep(phase, entry.phase, scope, state);
}

function transitionStep(phase: Phase, phaseName: string, scope: string, state: ProjectState): Action {
  const tr = phase.transitions[0];
  if (!tr) throw new MachineError(`phase "${phaseName}" has no transition`);
  for (const gate of tr.gates) {
    const key = `${scope}:${gate}`;
    const g = state.gates[key];
    if (g?.verdict === "pass") continue;
    if (g?.verdict === "fail") throw new MachineError(`gate ${key} failed but no phase failure was found`);
    return { type: "evaluateGate", gate, key, phase: phaseName, transitionTo: tr.to };
  }
  return { type: "transition", from: phaseName, to: tr.to };
}

interface PhaseFailure {
  kind: "worker" | "gate";
  name: string;
}

/** A non-ok phase-level worker or a failed phase-level gate inside this scope. */
function findPhaseFailure(state: ProjectState, scope: string): PhaseFailure | undefined {
  for (const [key, w] of Object.entries(state.workers)) {
    if (!key.startsWith(`${scope}:`)) continue;
    if (key.slice(scope.length + 1).includes(":")) continue; // item-scoped keys carry ":<itemId>@..."
    if (w.lastOutcome && w.lastOutcome !== "ok") return { kind: "worker", name: w.role };
  }
  for (const [key, g] of Object.entries(state.gates)) {
    if (!key.startsWith(`${scope}:`)) continue;
    if (key.slice(scope.length + 1).includes(":")) continue;
    if (g.verdict === "fail") return { kind: "gate", name: key.slice(scope.length + 1) };
  }
  return undefined;
}

function phaseFailAction(template: Template, phase: Phase, phaseName: string, state: ProjectState, failure: PhaseFailure): Action {
  const tr = phase.transitions[0];
  if (!tr) throw new MachineError(`phase "${phaseName}" has no transition`);
  // A gate climbs its own ladder: one that fails again stops the phase, but a different gate failing after a fix starts afresh.
  const count = failure.kind === "gate" ? (state.gateFails?.[`${phaseName}:${failure.name}`] ?? state.phaseFails[phaseName] ?? 0) : (state.phaseFails[phaseName] ?? 0);
  const why = failure.kind === "gate" ? `gate "${failure.name}" failed` : `${failure.name} could not produce valid work`;
  const rung = rungFor(tr.onFail, count);
  switch (rung.action) {
    case "retry":
      return { type: "retryPhase", phase: phaseName, reason: `${why} (attempt ${count})` };
    case "sendBack":
      if (!template.phases[rung.phase]) throw new MachineError(`sendBack to unknown phase "${rung.phase}"`);
      return { type: "sendBack", from: phaseName, to: rung.phase, reason: `${why}; going back to ${rung.phase}` };
    case "stop":
      return { type: "stop", reason: `${why} in ${phaseName} after ${count} failures` };
    default:
      throw new MachineError(`phase ladder produced item action "${rung.action}"`);
  }
}
