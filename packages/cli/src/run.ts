import {
  FsStore,
  applyEvent,
  makeId,
  makeProjectId,
  type Artifact,
  type ArtifactKind,
  type ArtifactRef,
  type BacklogItem,
  type BudgetTier,
  type Committer,
  type Event,
  type MetaOf,
  type ModelTier,
  type NewEvent,
  type ProjectState,
  type Role,
} from "@karigor/store";
import { eventsFor, listTemplates, loadTemplate, next, scopeOf, workerStartEvent, type Action, type Outcome, type Template } from "@karigor/process";
import { evaluate, type GateContext, type Sandbox } from "@karigor/gates";
import { ROLE_PRIORS, check, costOf, estimate, isFlatRate, record, type CostLedgerMeta } from "@karigor/budget";
import type { CostEntry } from "@karigor/store";
import { isProducingRole, makeJudge, runWorker, type ModelAdapter, type ProducingRole, type RoleContext, type Usage, type WorkerBudget, SelectorOutput } from "@karigor/runtime";

export interface RunOptions {
  root: string;
  projectId: string;
  adapter: ModelAdapter;
  sandbox: Sandbox;
  /** Chosen once, when the kernel asks. Defaults to `free` for mock/local adapters, else `cheap`. */
  tier?: BudgetTier;
  clock?: () => Date;
  committer?: Committer;
  templatesDir?: string;
  maxSteps?: number;
  /** Observe every action before it runs. */
  onAction?: (action: Action, state: ProjectState) => void;
  /** Observe every event after it is persisted. Tests throw here to simulate a crash. */
  onEvent?: (event: Event) => void;
  log?: (line: string) => void;
}

export class RunError extends Error {
  override name = "RunError";
}

/** Create a project directory with the idea recorded. Returns the project id. */
export async function createProject(root: string, ideaText: string, opts: { clock?: () => Date; committer?: Committer; projectId?: string } = {}): Promise<string> {
  const clock = opts.clock ?? (() => new Date());
  const projectId = opts.projectId ?? makeProjectId(clock());
  const store = await FsStore.create(root, projectId, { clock, ...(opts.committer ? { committer: opts.committer } : {}) });
  const idea: Artifact = {
    meta: { id: makeId("idea", clock()), kind: "idea", createdAt: clock().toISOString(), createdBy: "user", text: ideaText.trim(), locale: "en" },
    body: ideaText.trim() + "\n",
  };
  await store.writeArtifact(idea);
  await store.appendEvent({ type: "project-created", by: "user", projectId, ideaId: idea.meta.id });
  await store.commit("karigor: idea recorded");
  return projectId;
}

/** Drive a project until the machine goes idle (finished or stopped). Safe to call again after a crash. */
export async function runProject(opts: RunOptions): Promise<ProjectState> {
  const clock = opts.clock ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const store = await FsStore.open(opts.root, opts.projectId, { clock, ...(opts.committer ? { committer: opts.committer } : {}) });
  let state = await store.replay();
  /** Persist a batch as one atomic write, fold it into state, then notify. */
  const appendAll = async (batch: NewEvent[]): Promise<Event[]> => {
    const full = await store.appendEvents(batch);
    for (const e of full) state = applyEvent(state, e);
    for (const e of full) opts.onEvent?.(e);
    return full;
  };
  const append = async (e: NewEvent): Promise<Event> => (await appendAll([e]))[0]!;
  const templates = await Promise.all((await listTemplates(opts.templatesDir)).map((n) => loadTemplate(n, opts.templatesDir)));
  const newId = (kind: ArtifactKind) => makeId(kind, clock());

  // ---- helpers over state --------------------------------------------------
  const latestId = (kind: ArtifactKind) => state.artifacts[kind]?.at(-1);
  const kindOf = (id: string): ArtifactKind | undefined => {
    for (const [k, ids] of Object.entries(state.artifacts)) if (ids?.includes(id)) return k as ArtifactKind;
    return undefined;
  };
  let backlog: BacklogItem[] = [];
  let backlogId: string | undefined;
  const refreshBacklog = async () => {
    const id = latestId("backlog");
    if (id && id !== backlogId) {
      backlog = (await store.readArtifact("backlog", id)).meta.items;
      backlogId = id;
    }
  };
  const effectiveStatus = (b: BacklogItem) => state.items[b.id]?.status ?? b.status;
  const parkableItems = () => backlog.filter((b) => b.priority !== "must" && !["done", "parked", "dropped"].includes(effectiveStatus(b))).length;

  let ledger: CostLedgerMeta | undefined;
  /** Calls made before the budget is chosen (the selector). Folded into the ledger when it is created. */
  const pending: CostEntry[] = [];
  const loadLedger = async () => {
    if (!ledger && state.ledgerId) ledger = (await store.readArtifact("cost-ledger", state.ledgerId)).meta;
  };
  const saveLedger = async () => {
    if (!ledger) return;
    const m = { ...ledger };
    await store.writeArtifact({ meta: m, body: renderLedgerBody(m) });
  };
  const estimateCall = (role: Role, tier: ModelTier) => {
    const p = ROLE_PRIORS[role];
    const model = tier === "mock" ? "mock" : opts.adapter.modelFor(tier);
    return costOf({ inputTokens: p.inputTokens, outputTokens: p.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 }, model);
  };
  const budgetFor = (phase: string, role: Role, itemId?: string): WorkerBudget => ({
    allow: (tier) => {
      if (!ledger) return { ok: true, reason: "no ledger yet" };
      const r = check({ ledger, phase, estimatedCost: estimateCall(role, opts.adapter.name === "mock" ? "mock" : tier), tier, downgraded: state.downgradedPhases.includes(phase), parkableItems: itemId ? parkableItems() : 0 });
      return r.ok ? { ok: true, reason: r.reason } : { ok: false, action: r.action!, reason: r.reason };
    },
    record: (e) => {
      const entry: CostEntry = {
        at: clock().toISOString(),
        role: e.role,
        tier: e.tier,
        model: e.model,
        inputTokens: e.usage.inputTokens,
        outputTokens: e.usage.outputTokens,
        cacheReadTokens: e.usage.cacheReadTokens,
        cacheWriteTokens: e.usage.cacheWriteTokens,
        cost: costOf(e.usage, e.model),
        idempotencyKey: e.key,
        phase,
        ...(e.costUsd !== undefined && isFlatRate(e.model) ? { apiEquivalentCost: e.costUsd } : {}),
      };
      if (ledger) ledger = record(ledger, entry);
      else pending.push(entry);
    },
  });
  const roleContext = (phase: string, extra: Partial<RoleContext> = {}): RoleContext => ({ state, store, phase, backlog, templates, clock, makeId: newId, ...extra });

  /**
   * On a retry, what the role must know: every gate that failed since its last run, and what it
   * produced then. Phase roles match `<phase>#<n>:<role>`; item roles match `<scope>:<role>:<item>@<round>`.
   */
  const feedbackFor = async (role: Role, phase: string, itemId?: string): Promise<RoleContext["feedback"]> => {
    let prev: { key: string; seq: number; artifactIds: string[] } | undefined;
    for (const [key, w] of Object.entries(state.workers)) {
      if (w.role !== role || w.finishedSeq === undefined) continue;
      const m = /^([^#]+)#\d+:([^:]+)(?::([^@]+)@\d+)?$/.exec(key);
      if (!m || m[1] !== phase || m[2] !== role || (m[3] ?? undefined) !== itemId) continue;
      if (!prev || w.finishedSeq > prev.seq) prev = { key, seq: w.finishedSeq, artifactIds: w.artifactIds };
    }
    if (!prev) return undefined;
    const reasons: string[] = [];
    for (const [key, g] of Object.entries(state.gates)) {
      if (g.verdict !== "fail" || g.seq <= prev.seq) continue;
      if (itemId ? !key.includes(`:${itemId}@`) : key.slice(key.indexOf(":") + 1).includes(":")) continue;
      try {
        const r = await store.readArtifact("gate-result", g.resultId);
        reasons.push(...(r.meta.reasons.length ? r.meta.reasons.map((x) => `${r.meta.gate}: ${x}`) : [`${r.meta.gate} failed`]));
      } catch {
        reasons.push(`${key} failed`);
      }
    }
    if (reasons.length === 0) return undefined;
    const previous: Artifact[] = [];
    for (const id of prev.artifactIds) {
      const kind = kindOf(id);
      if (kind && kind !== "ledger") previous.push(await store.readArtifact(kind, id));
    }
    return { reasons, previous };
  };
  /** Write files only. Registration happens atomically through the finishing event. */
  const writeArtifacts = async (artifacts: Artifact[]): Promise<ArtifactRef[]> => {
    const refs: ArtifactRef[] = [];
    for (const a of artifacts) {
      await store.writeArtifact(a);
      refs.push({ kind: a.meta.kind, id: a.meta.id });
    }
    return refs;
  };

  // ---- one worker invocation ---------------------------------------------
  const invoke = async (role: ProducingRole, key: string, phase: string, extra: Partial<RoleContext> & { itemId?: string } = {}) => {
    const feedback = extra.purpose === "shrink" ? undefined : await feedbackFor(role, phase, extra.itemId);
    const ctx = roleContext(phase, { ...extra, ...(feedback ? { feedback } : {}) });
    const result = await runWorker({
      role,
      key,
      ctx,
      adapter: opts.adapter,
      budget: budgetFor(phase, role, extra.itemId),
      onAttempt: async (attempt, tier) => {
        const e: NewEvent = { type: "worker-started", by: "system", role, key, attempt, tier };
        if (extra.itemId !== undefined) e.itemId = extra.itemId;
        await append(e);
      },
    });
    await saveLedger();
    if (result.downgraded && !state.downgradedPhases.includes(phase)) await append({ type: "budget-downgraded", by: "system", phase, from: "judgment", to: "routine" });
    const artifacts = result.outcome === "ok" ? await writeArtifacts(result.artifacts) : [];
    const outcome: Outcome = { type: "worker", outcome: result.outcome, attempt: Math.max(1, result.attempt), artifacts, ...(result.error !== undefined ? { error: result.error } : {}) };
    return { result, outcome };
  };

  // ---- main loop -----------------------------------------------------------
  const maxSteps = opts.maxSteps ?? 2000;
  let template: Template | undefined = state.template ? templates.find((t) => t.name === state.template) : undefined;
  await refreshBacklog();
  await loadLedger();

  for (let step = 0; step < maxSteps; step++) {
    if (state.status === "finished" || state.status === "stopped") break;

    // Before a template exists the machine cannot be consulted; the selector runs first.
    if (!template) {
      const key = "select#1:selector";
      log("selecting a process and a target");
      const { result } = await invoke("selector", key, "select");
      let chosen = "iterative";
      let profile = "web-app";
      if (result.outcome === "ok") {
        const out = SelectorOutput.safeParse(result.output);
        if (out.success && templates.some((t) => t.name === out.data.template && t.name !== "maintenance")) {
          chosen = out.data.template;
          profile = out.data.targetProfile;
        }
      }
      await appendAll([
        { type: "worker-finished", by: "system", role: "selector", key, attempt: Math.max(1, result.attempt), outcome: result.outcome, artifacts: result.outcome === "ok" ? result.artifacts.map((a) => ({ kind: a.meta.kind, id: a.meta.id })) : [], ...(result.error ? { error: result.error } : {}) },
        { type: "template-selected", by: "selector", template: chosen, targetProfile: profile },
      ]);
      template = templates.find((t) => t.name === chosen)!;
      await store.commit(`karigor: process ${chosen}, target ${profile}`);
      continue;
    }

    const action = next({ template, state, backlog });
    opts.onAction?.(action, state);
    log(describeAction(action));

    switch (action.type) {
      case "idle":
        break;
      case "selectTemplate":
        throw new RunError("machine asked for a template after one was selected");
      case "chooseBudget": {
        const tiers = estimate(template, { judgmentModel: opts.adapter.modelFor("judgment"), routineModel: opts.adapter.modelFor("routine"), freeModel: opts.adapter.name === "mock" ? "mock" : "ollama/local" });
        const flat = isFlatRate(opts.adapter.modelFor("judgment"));
        // Flat-rate providers (a subscription, a local model) cost nothing per call, so the strongest models are the sensible default.
        const tier = opts.tier ?? (opts.adapter.name === "mock" ? "free" : flat ? "best" : "cheap");
        const t = tiers.find((x) => x.tier === tier)!;
        const id = newId("cost-ledger");
        ledger = { id, kind: "cost-ledger", createdAt: clock().toISOString(), createdBy: "system", currency: t.currency, tier, budgetTotal: t.total, phaseBudgets: t.phaseBudgets, entries: pending.splice(0) };
        await saveLedger();
        await appendAll(eventsFor(action, { type: "chooseBudget", tier, ledgerId: id }));
        log(`budget: ${tier} tier, ${t.currency} ${t.total.toFixed(2)}`);
        break;
      }
      case "invokeRole": {
        if (!isProducingRole(action.role)) throw new RunError(`template invokes "${action.role}", which is not a producing role`);
        const { result, outcome } = await invoke(action.role, action.key, action.phase, action.itemId !== undefined ? { itemId: action.itemId } : {});
        const batch = eventsFor(action, outcome);
        if (result.outcome === "over-budget") {
          if (result.budgetAction === "park" && action.itemId) batch.push({ type: "item-status", by: "system", itemId: action.itemId, status: "parked", reason: `over budget: ${result.error ?? ""}` });
          else batch.push({ type: "project-stopped", by: "system", reason: `out of budget: ${result.error ?? ""}` });
        }
        await appendAll(batch);
        await refreshBacklog();
        break;
      }
      case "shrinkItem": {
        const { result, outcome } = await invoke("planner", action.key, action.phase, { itemId: action.itemId, purpose: "shrink" });
        const batch = eventsFor(action, outcome);
        if (result.outcome === "over-budget") batch.push({ type: "project-stopped", by: "system", reason: `out of budget: ${result.error ?? ""}` });
        await appendAll(batch);
        await refreshBacklog();
        break;
      }
      case "evaluateGate": {
        const scope = state.entry ? scopeOf(state.entry.phase, state.entry.n) : "";
        const produced: ArtifactRef[] = [];
        for (const [key, w] of Object.entries(state.workers)) {
          if (!key.startsWith(`${scope}:`)) continue;
          const rest = key.slice(scope.length + 1);
          const itemScoped = rest.includes(":");
          if (action.itemId ? !rest.includes(`:${action.itemId}@`) : itemScoped) continue;
          for (const id of w.artifactIds) {
            const kind = kindOf(id);
            if (kind) produced.push({ kind, id });
          }
        }
        const judgeBudget = budgetFor(action.phase, action.gate === "skeptic-review" ? "skeptic" : "reviewer", action.itemId);
        const ctx: GateContext = {
          gate: action.gate,
          key: action.key,
          phase: action.phase,
          state,
          store,
          sandbox: opts.sandbox,
          judge: makeJudge(opts.adapter, judgeBudget),
          produced,
          clock,
          makeId: newId,
          budgetCheck: () => {
            const a = budgetFor(action.phase, "developer", action.itemId).allow("routine");
            return { ok: a.ok, reason: a.reason };
          },
          ...(action.itemId !== undefined ? { itemId: action.itemId } : {}),
          ...(action.round !== undefined ? { round: action.round } : {}),
          ...(action.transitionTo !== undefined ? { transitionTo: action.transitionTo } : {}),
          ...(action.itemId !== undefined && backlog.find((b) => b.id === action.itemId) ? { backlogItem: backlog.find((b) => b.id === action.itemId)! } : {}),
        };
        const r = await evaluate(ctx);
        await saveLedger();
        const extras: ArtifactRef[] = r.artifactIds.filter((id) => id !== r.resultId).map((id) => ({ kind: "test-report" as const, id }));
        await appendAll(eventsFor(action, { type: "gate", verdict: r.verdict, resultId: r.resultId, artifacts: extras }));
        if (r.verdict === "fail") log(`  gate ${action.gate} failed: ${r.reasons.join("; ")}`);
        break;
      }
      default:
        await appendAll(eventsFor(action, { type: "none" }));
    }
    await store.commit(`karigor: ${describeAction(action)}`);
    if (action.type === "idle") break;
  }
  if (state.status !== "finished" && state.status !== "stopped") throw new RunError(`run did not settle within ${maxSteps} steps`);
  return state;
}

export function describeAction(a: Action): string {
  switch (a.type) {
    case "invokeRole":
      return `${a.phase}: ${a.role}${a.itemId ? ` on ${a.itemId}` : ""}${a.round ? ` (round ${a.round})` : ""}`;
    case "evaluateGate":
      return `${a.phase}: gate ${a.gate}${a.itemId ? ` on ${a.itemId}` : ""}`;
    case "startSprint":
      return `${a.phase}: sprint ${a.sprint} with ${a.itemIds.join(", ")}`;
    case "transition":
      return `${a.from} -> ${a.to}`;
    case "sendBack":
      return `${a.from} -> back to ${a.to}: ${a.reason}`;
    case "retryPhase":
      return `${a.phase}: retrying (${a.reason})`;
    case "parkItem":
      return `parked ${a.itemId}: ${a.reason}`;
    case "itemDone":
      return `done ${a.itemId}`;
    case "shrinkItem":
      return `${a.phase}: shrinking ${a.itemId}`;
    case "stop":
      return `stopped: ${a.reason}`;
    case "enterPhase":
      return `entering ${a.phase}`;
    default:
      return a.type;
  }
}

function renderLedgerBody(m: MetaOf<"cost-ledger">): string {
  const total = m.entries.reduce((s, e) => s + e.cost, 0);
  return [`# Cost ledger (${m.tier} tier)`, "", `Budget ${m.currency} ${m.budgetTotal.toFixed(2)}, spent ${m.currency} ${total.toFixed(4)} over ${m.entries.length} calls.`, ""].join("\n");
}

export type { Usage };
