/**
 * In-memory driver: runs the machine against a script of worker and gate outcomes,
 * appending events exactly as the orchestrator will. Used by the machine tests and
 * later by the replay tests.
 */
import { applyEvent, emptyState, type BacklogItem, type Event, type NewEvent, type ProjectState } from "@karigor/store";
import { eventsFor, next, workerStartEvent, type Action, type Outcome, type Template } from "../src/index.js";

export interface Script {
  /** Decide a worker's outcome by key. Default ok. */
  worker?: (action: Extract<Action, { type: "invokeRole" | "shrinkItem" }>, state: ProjectState) => Outcome & { type: "worker" };
  /** Decide a gate's verdict by key. Default pass. */
  gate?: (action: Extract<Action, { type: "evaluateGate" }>, state: ProjectState) => "pass" | "fail";
  /** Backlog produced when the planner runs; may also be changed by shrink. */
  backlog?: BacklogItem[];
  onShrink?: (itemId: string, backlog: BacklogItem[]) => BacklogItem[];
  maxSteps?: number;
}

export interface SimResult {
  state: ProjectState;
  events: Event[];
  actions: Action[];
  backlog: BacklogItem[];
}

const AT = "2026-10-16T20:00:00.000Z";

export function simulate(template: Template, script: Script = {}): SimResult {
  const events: Event[] = [];
  const actions: Action[] = [];
  let state = emptyState("p1");
  let backlog: BacklogItem[] = [];
  const append = (e: NewEvent) => {
    const full = { ...e, seq: events.length, at: AT } as Event;
    events.push(full);
    state = applyEvent(state, full);
  };
  append({ type: "project-created", by: "system", projectId: "p1", ideaId: "idea-1" });
  let steps = 0;
  const max = script.maxSteps ?? 500;
  for (;;) {
    if (++steps > max) throw new Error(`simulation did not settle in ${max} steps; last actions: ${actions.slice(-5).map((a) => a.type).join(", ")}`);
    const action = next({ template, state, backlog });
    actions.push(action);
    if (action.type === "idle") break;
    let outcome: Outcome = { type: "none" };
    switch (action.type) {
      case "selectTemplate":
        outcome = { type: "selectTemplate", template: template.name, targetProfile: "web-app" };
        break;
      case "chooseBudget":
        outcome = { type: "chooseBudget", tier: "cheap", ledgerId: "cost-1" };
        break;
      case "invokeRole":
      case "shrinkItem": {
        append(workerStartEvent(action, 1, "mock"));
        outcome = script.worker?.(action, state) ?? { type: "worker", outcome: "ok", attempt: 1, artifacts: [] };
        if (outcome.outcome === "ok" && action.type === "invokeRole" && action.role === "planner" && script.backlog) backlog = script.backlog;
        if (outcome.outcome === "ok" && action.type === "shrinkItem") backlog = script.onShrink?.(action.itemId, backlog) ?? backlog;
        break;
      }
      case "evaluateGate":
        outcome = { type: "gate", verdict: script.gate?.(action, state) ?? "pass", resultId: `gr-${events.length}`, artifacts: [] };
        break;
    }
    for (const e of eventsFor(action, outcome)) append(e);
  }
  return { state, events, actions, backlog };
}

export const item = (id: string, extra: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  title: id,
  description: `do ${id}`,
  acceptance: ["it works"],
  priority: "must",
  estimate: "S",
  status: "todo",
  dependsOn: [],
  ...extra,
});
