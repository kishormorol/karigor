import type { ArtifactKind, BudgetTier, Event, ItemStatus, Role } from "./schemas/index.js";

export type ProjectStatus = "created" | "running" | "stopped" | "finished";

export interface ItemState {
  status: ItemStatus;
  failCount: number;
  reason?: string;
}

export interface WorkerState {
  role: Role;
  attempts: number;
  lastOutcome?: "ok" | "invalid" | "failed" | "over-budget";
  artifactIds: string[];
}

export interface GateState {
  verdict: "pass" | "fail";
  resultId: string;
  seq: number;
}

export interface PhaseEntry {
  phase: string;
  /** 1-based count of entries into this phase so far. Part of every scope key. */
  n: number;
  sprint?: number;
  itemIds?: string[];
  seq: number;
}

export interface ProjectState {
  projectId: string;
  status: ProjectStatus;
  ideaId?: string;
  template?: string;
  targetProfile?: string;
  budgetTier?: BudgetTier;
  ledgerId?: string;
  phase?: string;
  sprint?: number;
  phaseHistory: PhaseEntry[];
  /** The current entry; undefined before the first phase. */
  entry?: PhaseEntry;
  phaseEntries: Record<string, number>;
  /** Phase-level failures (worker or gate without an item), per phase, across entries. */
  phaseFails: Record<string, number>;
  items: Record<string, ItemState>;
  /** keyed by the worker's scope key. */
  workers: Record<string, WorkerState>;
  /** keyed by the gate's scope key; holds the latest evaluation. */
  gates: Record<string, GateState>;
  /** Total failed gate evaluations and non-ok worker outcomes. */
  failures: number;
  /** Phases whose budget ladder already downgraded the model tier. */
  downgradedPhases: string[];
  artifacts: Partial<Record<ArtifactKind, string[]>>;
  lastSeq: number;
  stopReason?: string;
}

export function emptyState(projectId: string): ProjectState {
  return {
    projectId,
    status: "created",
    phaseHistory: [],
    phaseEntries: {},
    phaseFails: {},
    items: {},
    workers: {},
    gates: {},
    failures: 0,
    downgradedPhases: [],
    artifacts: {},
    lastSeq: -1,
  };
}

function item(s: ProjectState, id: string): ItemState {
  return (s.items[id] ??= { status: "todo", failCount: 0 });
}

/** Pure fold of one event into state. Mutates and returns `s` for speed; callers own the copy. */
export function applyEvent(s: ProjectState, e: Event): ProjectState {
  if (e.seq !== s.lastSeq + 1) {
    throw new Error(`event seq gap: expected ${s.lastSeq + 1}, got ${e.seq} (${e.type})`);
  }
  s.lastSeq = e.seq;
  switch (e.type) {
    case "project-created":
      s.projectId = e.projectId;
      s.ideaId = e.ideaId;
      s.status = "created";
      break;
    case "template-selected":
      s.template = e.template;
      s.targetProfile = e.targetProfile;
      break;
    case "budget-chosen":
      s.budgetTier = e.tier;
      s.ledgerId = e.ledgerId;
      break;
    case "phase-entered": {
      s.status = "running";
      s.phase = e.phase;
      if (e.sprint !== undefined) s.sprint = e.sprint;
      const n = (s.phaseEntries[e.phase] = (s.phaseEntries[e.phase] ?? 0) + 1);
      const entry: PhaseEntry = { phase: e.phase, n, seq: e.seq };
      if (e.sprint !== undefined) entry.sprint = e.sprint;
      if (e.itemIds !== undefined) entry.itemIds = e.itemIds;
      s.entry = entry;
      s.phaseHistory.push(entry);
      break;
    }
    case "worker-started": {
      const w = (s.workers[e.key] ??= { role: e.role, attempts: 0, artifactIds: [] });
      w.attempts = Math.max(w.attempts, e.attempt);
      if (e.itemId) item(s, e.itemId).status = "in-progress";
      break;
    }
    case "worker-finished": {
      const w = (s.workers[e.key] ??= { role: e.role, attempts: e.attempt, artifactIds: [] });
      w.lastOutcome = e.outcome;
      w.artifactIds.push(...e.artifactIds);
      if (e.outcome !== "ok") {
        s.failures += 1;
        if (e.itemId) item(s, e.itemId).failCount += 1;
        else if (s.phase) s.phaseFails[s.phase] = (s.phaseFails[s.phase] ?? 0) + 1;
      }
      break;
    }
    case "artifact-written":
      (s.artifacts[e.kind] ??= []).push(e.id);
      break;
    case "gate-evaluated":
      s.gates[e.key] = { verdict: e.verdict, resultId: e.resultId, seq: e.seq };
      if (e.verdict === "fail") {
        s.failures += 1;
        if (e.itemId) item(s, e.itemId).failCount += 1;
        else if (s.phase) s.phaseFails[s.phase] = (s.phaseFails[s.phase] ?? 0) + 1;
      }
      break;
    case "transition":
      // phase-entered follows and sets `phase`; nothing else to do here.
      break;
    case "item-status": {
      const it = item(s, e.itemId);
      it.status = e.status;
      if (e.reason !== undefined) it.reason = e.reason;
      break;
    }
    case "budget-downgraded":
      if (!s.downgradedPhases.includes(e.phase)) s.downgradedPhases.push(e.phase);
      break;
    case "project-stopped":
      s.status = "stopped";
      s.stopReason = e.reason;
      break;
    case "project-finished":
      s.status = "finished";
      break;
  }
  return s;
}

export function replay(projectId: string, events: Iterable<Event>): ProjectState {
  const s = emptyState(projectId);
  for (const e of events) applyEvent(s, e);
  return s;
}
