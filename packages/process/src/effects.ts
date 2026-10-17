import type { ArtifactRef, NewEvent } from "@karigor/store";
import type { Action } from "./machine.js";

/** Outcome of performing an action. Pure data; the orchestrator fills it in. */
export type Outcome =
  | { type: "selectTemplate"; template: string; targetProfile: string }
  | { type: "chooseBudget"; tier: "free" | "cheap" | "best"; ledgerId: string }
  | { type: "worker"; outcome: "ok" | "invalid" | "failed" | "over-budget"; attempt: number; artifacts: ArtifactRef[]; error?: string }
  | { type: "gate"; verdict: "pass" | "fail"; resultId: string; artifacts: ArtifactRef[] }
  | { type: "none" };

/** Events to append after `action` produced `outcome`. Deterministic, so replay and tests agree. */
export function eventsFor(action: Action, outcome: Outcome): NewEvent[] {
  switch (action.type) {
    case "selectTemplate":
      if (outcome.type !== "selectTemplate") throw mismatch(action, outcome);
      return [{ type: "template-selected", by: "selector", template: outcome.template, targetProfile: outcome.targetProfile }];
    case "chooseBudget":
      if (outcome.type !== "chooseBudget") throw mismatch(action, outcome);
      return [{ type: "budget-chosen", by: "user", tier: outcome.tier, ledgerId: outcome.ledgerId }];
    case "enterPhase":
      return [{ type: "phase-entered", by: "system", phase: action.phase }];
    case "startSprint":
      return [{ type: "phase-entered", by: "system", phase: action.phase, sprint: action.sprint, itemIds: action.itemIds }];
    case "invokeRole": {
      if (outcome.type !== "worker") throw mismatch(action, outcome);
      const e: NewEvent = {
        type: "worker-finished",
        by: "system",
        role: action.role,
        key: action.key,
        attempt: outcome.attempt,
        outcome: outcome.outcome,
        artifacts: outcome.artifacts,
      };
      if (outcome.error !== undefined) e.error = outcome.error;
      if (action.itemId !== undefined) e.itemId = action.itemId;
      return [e];
    }
    case "shrinkItem": {
      if (outcome.type !== "worker") throw mismatch(action, outcome);
      const e: NewEvent = {
        type: "worker-finished",
        by: "system",
        role: "planner",
        key: action.key,
        attempt: outcome.attempt,
        outcome: outcome.outcome,
        artifacts: outcome.artifacts,
        itemId: action.itemId,
      };
      if (outcome.error !== undefined) e.error = outcome.error;
      if (outcome.outcome !== "ok") return [e];
      return [e, { type: "item-status", by: "planner", itemId: action.itemId, status: "dropped", reason: "split into smaller items" }];
    }
    case "evaluateGate": {
      if (outcome.type !== "gate") throw mismatch(action, outcome);
      const e: NewEvent = { type: "gate-evaluated", by: "system", gate: action.gate, key: action.key, verdict: outcome.verdict, resultId: outcome.resultId, artifacts: outcome.artifacts };
      if (action.itemId !== undefined) e.itemId = action.itemId;
      return [e];
    }
    case "itemDone":
      return [{ type: "item-status", by: "system", itemId: action.itemId, status: "done" }];
    case "parkItem":
      return [{ type: "item-status", by: "system", itemId: action.itemId, status: "parked", reason: action.reason }];
    case "transition":
      return [
        { type: "transition", by: "system", from: action.from, to: action.to },
        { type: "phase-entered", by: "system", phase: action.to },
      ];
    case "retryPhase":
      return [{ type: "phase-entered", by: "system", phase: action.phase }];
    case "sendBack":
      return [
        { type: "transition", by: "system", from: action.from, to: action.to },
        { type: "phase-entered", by: "system", phase: action.to },
      ];
    case "stop":
      return [{ type: "project-stopped", by: "system", reason: action.reason }];
    case "finish":
      return [{ type: "project-finished", by: "system" }];
    case "idle":
      return [];
  }
}

/** Event to append before running a worker. */
export function workerStartEvent(action: Extract<Action, { type: "invokeRole" | "shrinkItem" }>, attempt: number, tier: "judgment" | "routine" | "mock"): NewEvent {
  const e: NewEvent = {
    type: "worker-started",
    by: "system",
    role: action.type === "shrinkItem" ? "planner" : action.role,
    key: action.key,
    attempt,
    tier,
  };
  if (action.itemId !== undefined) e.itemId = action.itemId;
  return e;
}

function mismatch(action: Action, outcome: Outcome): Error {
  return new Error(`action ${action.type} cannot take outcome ${outcome.type}`);
}
