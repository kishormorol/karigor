import {
  FsStore,
  acquireRunLock,
  applyEvent,
  drainInbox,
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
import { generateSettingValue, type Profile } from "@karigor/profiles";
import { LocalSandbox, Workspace, clip } from "@karigor/sandbox";
import { releaseVersion, type DeployAdapter, type LiveRelease } from "@karigor/deploy";
import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { ROLE_PRIORS, check, costOf, estimate, isFlatRate, record, type CostLedgerMeta } from "@karigor/budget";
import type { CostEntry } from "@karigor/store";
import { QuotaError, buildableTarget, isProducingRole, makeJudge, runAgentWorker, runWorker, summaryArtifact, type AgentAdapter, type ModelAdapter, type ProducingRole, type RoleContext, type Usage, type WorkerBudget, SelectorOutput } from "@karigor/runtime";

export interface RunOptions {
  root: string;
  projectId: string;
  adapter: ModelAdapter;
  /** Used when no profile is given (the demo path). */
  sandbox?: Sandbox;
  /** With `agent`, a real workspace is created from this profile and the developer works in it. */
  profile?: Profile;
  agent?: AgentAdapter;
  /** Where releases go. Needs a workspace (`profile` and `agent`). Without one, the release gate fails honestly. */
  deploy?: DeployAdapter;
  /** Skip the profile's install step (tests). */
  skipInstall?: boolean;
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

/** Templates a released project re-enters with; never chosen for a new idea. */
const CONTINUATION_TEMPLATES = new Set(["maintenance", "stage"]);

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

/**
 * Drive a project until the machine goes idle (finished, stopped, waiting or paused). Safe to call
 * again after a crash. Holds the project's run lock, so no other process changes its log meanwhile;
 * feedback left during the run is read when it ends.
 */
export async function runProject(opts: RunOptions): Promise<ProjectState> {
  const dir = join(opts.root, opts.projectId);
  const release = await acquireRunLock(dir);
  try {
    return await runProjectLocked(opts);
  } finally {
    try {
      const queued = await drainInbox<{ kind: string; text: string }>(dir);
      if (queued.length) {
        const { feedbackSignal, recordSignals } = await import("./operate.js");
        const store = await FsStore.open(opts.root, opts.projectId, { ...(opts.clock ? { clock: opts.clock } : {}), ...(opts.committer ? { committer: opts.committer } : {}) });
        await recordSignals(store, queued.filter((q) => q.kind === "feedback").map((q) => feedbackSignal(q.text)), opts.clock);
      }
    } finally {
      await release();
    }
  }
}

async function runProjectLocked(opts: RunOptions): Promise<ProjectState> {
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
  /** Maintenance cycles spend from their own slice (`m<cycle>:<phase>`), never from the first build's. */
  const budgetPhase = (phase: string) => (state.cycle > 0 ? `m${state.cycle}:${phase}` : phase);
  const budgetFor = (phaseName: string, role: Role, itemId?: string): WorkerBudget => ({
    allow: (tier) => {
      const phase = budgetPhase(phaseName);
      if (!ledger) return { ok: true, reason: "no ledger yet" };
      const r = check({ ledger, phase, estimatedCost: estimateCall(role, opts.adapter.name === "mock" ? "mock" : tier), tier, downgraded: state.downgradedPhases.includes(phaseName), parkableItems: itemId ? parkableItems() : 0 });
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
        phase: budgetPhase(phaseName),
        ...(e.costUsd !== undefined && isFlatRate(e.model) ? { apiEquivalentCost: e.costUsd } : {}),
      };
      if (ledger) ledger = record(ledger, entry);
      else pending.push(entry);
    },
  });
  // A real build can only make the kind of software its profile scaffolds; the selector is offered just that.
  const buildable = opts.profile && opts.profile.name !== "fixture" ? [opts.profile.name] : undefined;
  const roleContext = (phase: string, extra: Partial<RoleContext> = {}): RoleContext => ({
    state, store, phase, backlog, templates, clock, makeId: newId,
    ...(opts.profile ? { stackGuide: opts.profile.stackGuide } : {}),
    ...(buildable ? { buildable } : {}),
    ...(opts.deploy ? { deployTarget: opts.deploy.describe() } : {}),
    ...extra,
  });

  // ---- workspace (real build crew) -----------------------------------------
  let workspace: Workspace | undefined;
  let sandbox: Sandbox | undefined = opts.sandbox;
  const agentic = Boolean(opts.profile && opts.agent);
  const getWorkspace = async (): Promise<Workspace> => {
    if (workspace) return workspace;
    const dir = join(store.dir, "workspace");
    const exists = await stat(join(dir, ".git")).then(() => true, () => false);
    if (exists) workspace = await Workspace.open(dir);
    else {
      log(`creating the workspace from the ${opts.profile!.name} profile`);
      workspace = await Workspace.create(dir, opts.profile!, { log, ...(opts.skipInstall ? { skipInstall: true } : {}) });
    }
    return workspace;
  };
  const getSandbox = async (): Promise<Sandbox> => {
    if (sandbox) return sandbox;
    if (!opts.profile) throw new RunError("no sandbox and no profile: pass one of them");
    const ws = await getWorkspace();
    const deploy = opts.deploy;
    sandbox = new LocalSandbox(ws, opts.profile, deploy ? { deploy: { verifyRollback: async () => deploy.verifyRollback({ dir: ws.dir, ...(await liveOrNone()) }), ...(deploy.checkUrl ? { checkUrl: (u: string) => deploy.checkUrl!(u) } : {}) } } : {});
    return sandbox;
  };

  // ---- releases (deploy and operate) ----------------------------------------
  const deployRecords = async () => Promise.all((state.artifacts["deploy-record"] ?? []).map((id) => store.readArtifact("deploy-record", id)));
  /** What is live in production now: each deployed production record goes on top, each rolled-back one comes off. */
  const liveRelease = async (): Promise<LiveRelease | undefined> => {
    const stack: LiveRelease[] = [];
    for (const r of await deployRecords()) {
      if (r.meta.environment !== "production") continue;
      if (r.meta.status === "deployed" && r.meta.url) stack.push({ url: r.meta.url, id: r.meta.releaseId ?? r.meta.url, version: r.meta.version });
      else if (r.meta.status === "rolled-back") stack.pop();
    }
    return stack.at(-1);
  };
  const liveOrNone = async (): Promise<{ live?: LiveRelease }> => {
    const live = await liveRelease();
    return live ? { live } : {};
  };
  /** Releases, not records: applying settings rewrites the live record for the same version. */
  const productionCount = async () => new Set((await deployRecords()).filter((r) => r.meta.environment === "production" && r.meta.status === "deployed").map((r) => r.meta.version)).size;
  /** Secrets nobody needs to know (signing keys) are made and stored before the preview, so it can run. */
  const generateSettings = async () => {
    const d = opts.deploy!;
    if (!d.missingSettings || !d.setSettings) return;
    const ws = await getWorkspace();
    const gen = (await d.missingSettings(ws.dir).catch(() => [])).filter((m) => m.kind === "generate");
    if (!gen.length) return;
    const r = await d.setSettings(ws.dir, Object.fromEntries(gen.map((g) => [g.name, generateSettingValue()])));
    if (!r.ok) {
      log(`  could not store generated settings: ${r.output.split("\n")[0]}`);
      return;
    }
    log(`  made and stored ${gen.map((g) => g.name).join(", ")}`);
    await append({ type: "settings-provided", by: "system", names: gen.map((g) => g.name) });
  };
  /** Deploy the workspace to a preview before the releaser describes it. Reused on resume by its key. */
  const ensurePreview = async (key: string, phase: string) => {
    const existing = (await deployRecords()).find((r) => r.meta.key === key);
    if (existing) return existing;
    const ws = await getWorkspace();
    const commit = await ws.head();
    const version = releaseVersion((await productionCount()) + 1, commit);
    log(`  putting ${version} on a preview (${opts.deploy!.name})`);
    const res = await opts.deploy!.preview({ dir: ws.dir, version, commit, key });
    const record: Artifact = {
      meta: { id: newId("deploy-record"), kind: "deploy-record", createdAt: clock().toISOString(), createdBy: "system", phase, target: opts.deploy!.name, environment: "preview", version, status: res.ok ? "deployed" : "failed", rollbackVerified: false, commit, key, ...(res.url ? { url: res.url } : {}), ...(res.id ? { releaseId: res.id } : {}) },
      body: clip(res.output, 20_000),
    };
    await store.writeArtifact(record);
    await append({ type: "artifact-written", by: "system", kind: "deploy-record", id: record.meta.id });
    if (!res.ok) log(`  the preview failed: ${res.output.split("\n").at(-1) ?? ""}`);
    return record as Awaited<ReturnType<typeof deployRecords>>[number];
  };
  /**
   * After the release gates pass: make the preview the production release. A failed promotion
   * goes back to what was live, files a critical work item, and stops with a plain reason.
   */
  const promote = async (): Promise<NewEvent[]> => {
    const records = await deployRecords();
    const preview = records.filter((r) => r.meta.environment === "preview" && r.meta.status === "deployed").at(-1);
    if (!preview) return [{ type: "project-stopped", by: "system", reason: "there is no healthy preview to put live" }];
    const key = `promote:${preview.meta.id}`;
    if (records.some((r) => r.meta.key === key && r.meta.status === "deployed")) return [];
    const ws = await getWorkspace();
    const live = await liveRelease();
    const version = preview.meta.version;
    log(`  putting ${version} live`);
    const res = await opts.deploy!.promote({ dir: ws.dir, version, commit: preview.meta.commit ?? (await ws.head()), key, preview: { ok: true, output: "", ...(preview.meta.url ? { url: preview.meta.url } : {}), ...(preview.meta.releaseId ? { id: preview.meta.releaseId } : {}) } });
    const base = { createdAt: clock().toISOString(), createdBy: "system" as const, phase: "release", target: opts.deploy!.name, environment: "production" as const, version, key, ...(preview.meta.commit ? { commit: preview.meta.commit } : {}) };
    if (res.ok) {
      // A live app that cannot start its real work (no passcode, no database) is not done; say what it needs.
      const missing = (await opts.deploy!.missingSettings?.(ws.dir).catch(() => undefined)) ?? [];
      const record: Artifact = { meta: { id: newId("deploy-record"), kind: "deploy-record", ...base, status: "deployed", rollbackVerified: true, ...(res.url ? { url: res.url } : {}), ...(res.id ? { releaseId: res.id } : {}), ...(missing.length ? { missingSettings: missing } : {}) }, body: clip(res.output, 20_000) };
      await store.writeArtifact(record);
      const events: NewEvent[] = [{ type: "artifact-written", by: "system", kind: "deploy-record", id: record.meta.id }];
      await ws.tag(`karigor-release-${version}`, preview.meta.commit ?? "HEAD").catch(() => undefined);
      const lastSummary = latestId("summary");
      if (lastSummary && res.url) {
        const s = (await store.readArtifact("summary", lastSummary)).meta;
        const fresh = summaryArtifact(s, { id: newId("summary"), createdAt: clock().toISOString(), createdBy: "system", phase: "release" }, res.url);
        fresh.body += `\nIt lives on ${opts.deploy!.describe()}.\n`;
        // The first release of an app with people and roles: the person's own way in.
        const firstRelease = (await productionCount()) === 0;
        const pkg = JSON.parse(await readFile(join(ws.dir, "package.json"), "utf8").catch(() => "{}")) as { scripts?: Record<string, string> };
        if (firstRelease && pkg.scripts?.["admin:link"]) {
          fresh.body += `\n## Signing in the first time\n\nRun \`karigor admin-link ${state.projectId} you@example.com "Your name"\` and open the link it prints to choose your password. Then add the people who work with you from People; each gets their own link.\n`;
          log(`  to sign in the first time: karigor admin-link ${state.projectId} <your email> "<your name>"`);
        }
        if (missing.length) fresh.body += `\n## Before it can be used\n\nIt is online, but it needs these settings on ${opts.deploy!.describe()} before it can do its job:\n\n${missing.map((m) => `- \`${m.name}\`${m.note ? `: ${m.note}` : ""}`).join("\n")}\n`;
        await store.writeArtifact(fresh);
        events.push({ type: "artifact-written", by: "system", kind: "summary", id: fresh.meta.id });
      }
      log(`  live: ${res.url ?? version}`);
      if (missing.length) log(`  it still needs these settings before it can be used: ${missing.map((m) => m.name).join(", ")}`);
      return events;
    }
    const rb = await opts.deploy!.rollback({ dir: ws.dir, ...(live ? { live } : {}) });
    const record: Artifact = { meta: { id: newId("deploy-record"), kind: "deploy-record", ...base, status: "rolled-back", rollbackVerified: rb.ok }, body: clip(`${res.output}\n\nRollback: ${rb.output}`, 20_000) };
    await store.writeArtifact(record);
    const work: Artifact = {
      meta: { id: newId("work-item"), kind: "work-item", createdAt: clock().toISOString(), createdBy: "system", source: "downtime", severity: "critical", title: `Version ${version} failed after going live`, description: `The new version did not work once it was live, so ${live ? `the previous version (${live.version}) was put back` : "it was taken offline"}. What went wrong:\n\n${clip(res.output, 4_000)}`, status: "todo", fingerprint: `promote:${version}` },
      body: clip(res.output, 10_000),
    };
    await store.writeArtifact(work);
    return [
      { type: "artifact-written", by: "system", kind: "deploy-record", id: record.meta.id },
      { type: "signal-received", by: "system", workItemId: work.meta.id, source: "downtime", severity: "critical", fingerprint: `promote:${version}` },
      { type: "project-stopped", by: "system", reason: `the new version failed after going live; ${live ? `the previous version (${live.version}) is back` : "it was taken offline"} and a fix is queued` },
    ];
  };
  /** Parked or dropped work must not leak into the release. */
  const revertItem = async (itemId: string, reason: string) => {
    if (!agentic) return;
    const ws = await getWorkspace();
    const sha = await ws.revertItem(itemId, reason).catch((e: Error) => {
      log(`  could not revert ${itemId}: ${e.message}`);
      return undefined;
    });
    if (sha) log(`  reverted ${itemId}'s commits (${reason})`);
  };

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
        reasons.push(...r.meta.minor.map((x) => `${r.meta.gate} (optional improvement): ${x}`));
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
    const onAttempt = async (attempt: number, tier: ModelTier) => {
      const e: NewEvent = { type: "worker-started", by: "system", role, key, attempt, tier };
      if (extra.itemId !== undefined) e.itemId = extra.itemId;
      await append(e);
    };
    const result =
      role === "developer" && agentic
        ? await runAgentWorker({ key, ctx, agent: opts.agent!, budget: budgetFor(phase, role, extra.itemId), workspace: await getWorkspace(), stackGuide: opts.profile!.stackGuide, onAttempt })
        : await runWorker({ role, key, ctx, adapter: opts.adapter, budget: budgetFor(phase, role, extra.itemId), onAttempt });
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
  // A pause for the provider's allowance ends when someone runs the project again.
  if (state.status === "waiting" && state.pausedReason) {
    log("carrying on after the pause");
    await append({ type: "project-resumed", by: "system" });
  }

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (state.status === "finished" || state.status === "stopped" || state.status === "waiting") break;

      // Before a template exists the machine cannot be consulted; the selector runs first.
      if (!template) {
        const key = "select#1:selector";
        log("selecting a process and a target");
        const { result } = await invoke("selector", key, "select");
        let chosen = "iterative";
        let profile = "web-app";
        if (result.outcome === "ok" && "output" in result) {
          const out = SelectorOutput.safeParse(result.output);
          if (out.success && templates.some((t) => t.name === out.data.template && !CONTINUATION_TEMPLATES.has(t.name))) {
            chosen = out.data.template;
            profile = buildableTarget(out.data.targetProfile, buildable).target;
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
          const extra: Partial<RoleContext> & { itemId?: string } = action.itemId !== undefined ? { itemId: action.itemId } : {};
          if (action.role === "releaser" && opts.deploy) {
            if (!agentic) throw new RunError("a deploy target needs a real workspace (a profile and a developer agent)");
            await generateSettings();
            // A preview without the person's own settings cannot work; wait for them instead of failing checks.
            const needs = ((await opts.deploy.missingSettings?.((await getWorkspace()).dir).catch(() => [])) ?? []).filter((m) => m.kind !== "generate");
            if (needs.length) {
              log(`  waiting for you: ${needs.map((m) => m.name).join(", ")} (karigor setup ${state.projectId})`);
              await append({ type: "project-waiting", by: "system", needs: needs.map((m) => m.name) });
              await store.commit("karigor: waiting for the person's settings");
              break;
            }
            extra.deploy = await ensurePreview(action.key, action.phase);
            extra.deployTarget = opts.deploy.describe();
          }
          const { result, outcome } = await invoke(action.role, action.key, action.phase, extra);
          const batch = eventsFor(action, outcome);
          if (result.outcome === "over-budget") {
            if (result.budgetAction === "park" && action.itemId) {
              await revertItem(action.itemId, "over budget");
              batch.push({ type: "item-status", by: "system", itemId: action.itemId, status: "parked", reason: `over budget: ${result.error ?? ""}` });
            } else batch.push({ type: "project-stopped", by: "system", reason: `out of budget: ${result.error ?? ""}` });
          }
          await appendAll(batch);
          await refreshBacklog();
          break;
        }
        case "shrinkItem": {
          const { result, outcome } = await invoke("planner", action.key, action.phase, { itemId: action.itemId, purpose: "shrink" });
          if (result.outcome === "ok") await revertItem(action.itemId, "replaced by smaller items");
          const batch = eventsFor(action, outcome);
          if (result.outcome === "over-budget") batch.push({ type: "project-stopped", by: "system", reason: `out of budget: ${result.error ?? ""}` });
          await appendAll(batch);
          await refreshBacklog();
          break;
        }
        case "parkItem": {
          await revertItem(action.itemId, "parked");
          await appendAll(eventsFor(action, { type: "none" }));
          break;
        }
        case "evaluateGate": {
          if (action.gate === "preview-healthy" && opts.deploy?.ensure) {
            const p = (await deployRecords()).filter((r) => r.meta.environment === "preview").at(-1);
            if (p?.meta.status === "deployed" && p.meta.url && p.meta.releaseId) await opts.deploy.ensure({ url: p.meta.url, id: p.meta.releaseId });
          }
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
          // The same gate's verdict from the previous attempt (previous phase entry, or previous item round).
          let previousReview: GateContext["previousReview"];
          {
            const entry = state.entry!;
            const prevKey = action.itemId !== undefined && action.round !== undefined && action.round > 0
              ? `${scope}:${action.gate}:${action.itemId}@${action.round - 1}`
              : action.itemId === undefined && entry.n > 1
                ? `${scopeOf(entry.phase, entry.n - 1)}:${action.gate}`
                : undefined;
            const g = prevKey ? state.gates[prevKey] : undefined;
            if (g) {
              try {
                const r = await store.readArtifact("gate-result", g.resultId);
                previousReview = { verdict: r.meta.verdict, reasons: r.meta.reasons, minor: r.meta.minor };
              } catch {
                /* missing artifact: review without history */
              }
            }
          }
          const ctx: GateContext = {
            gate: action.gate,
            key: action.key,
            phase: action.phase,
            state,
            store,
            sandbox: await getSandbox(),
            judge: makeJudge(opts.adapter, judgeBudget),
            produced,
            clock,
            makeId: newId,
            budgetCheck: () => {
              const a = budgetFor(action.phase, "developer", action.itemId).allow("routine");
              return { ok: a.ok, reason: a.reason };
            },
            ...(previousReview ? { previousReview } : {}),
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
        case "transition": {
          const batch = opts.deploy && agentic && template.phases[action.to]?.terminal ? await promote() : [];
          if (batch.some((e) => e.type === "project-stopped")) await appendAll(batch);
          else await appendAll([...batch, ...eventsFor(action, { type: "none" })]);
          break;
        }
        case "stop": {
          // A release that fails its checks becomes work for a fix round, with what the app itself printed.
          const batch = eventsFor(action, { type: "none" });
          if (opts.deploy && state.phase === "release") {
            const preview = (await deployRecords()).filter((r) => r.meta.environment === "preview").at(-1);
            if (preview) {
              const logs = preview.meta.releaseId ? (opts.deploy.logs?.(preview.meta.releaseId) ?? "") : "";
              const errors = logs.split("\n").filter((l) => /error|exception|failed/i.test(l)).slice(-20).join("\n");
              const work: Artifact = {
                meta: { id: newId("work-item"), kind: "work-item", createdAt: clock().toISOString(), createdBy: "system", source: "error", severity: "high", title: `Release ${preview.meta.version} did not pass its checks`, description: `${action.reason}.\n\nWhat the release reported:\n${clip(preview.body, 3_000)}${errors ? `\n\nWhat the app printed:\n${clip(errors, 4_000)}` : ""}`, status: "todo", fingerprint: `release:${preview.meta.version}` },
                body: clip(logs || preview.body, 20_000),
              };
              await store.writeArtifact(work);
              batch.unshift({ type: "signal-received", by: "system", workItemId: work.meta.id, source: "error", severity: "high", fingerprint: `release:${preview.meta.version}` });
            }
          }
          await appendAll(batch);
          break;
        }
        default:
          await appendAll(eventsFor(action, { type: "none" }));
      }
      await store.commit(`karigor: ${describeAction(action)}`);
      if (action.type === "idle") break;
    }
  } catch (e) {
    // The provider's allowance ran out mid-step: nothing failed, so nothing is counted against the work.
    if (!(e instanceof QuotaError)) throw e;
    const reason = `the model's usage allowance is used up${e.resets ? ` (it resets ${e.resets})` : ""}; nothing failed, and the work carries on with karigor resume after that`;
    log(`  paused: ${reason}`);
    await saveLedger();
    await append({ type: "project-paused", by: "system", reason });
    await store.commit("karigor: paused (usage allowance used up)");
  } finally {
    // Previews do not outlive the run; production is served by `karigor serve` or the hosting target.
    await opts.deploy?.stop();
  }
  if (state.status !== "finished" && state.status !== "stopped" && state.status !== "waiting") throw new RunError(`run did not settle within ${maxSteps} steps`);
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

/** The project stopped only because the model's usage allowance ran out; nothing is wrong with the work. */
export const pausedForAllowance = (s: ProjectState): boolean => s.status === "waiting" && Boolean(s.pausedReason);

/**
 * Run, and while the allowance is used up, wait and try again. The provider's stated reset time
 * is not trusted (it has been wrong), so this simply retries on a fixed interval.
 */
export async function runWaiting(
  make: () => Promise<RunOptions>,
  o: { everyMs: number; log?: (line: string) => void; sleep?: (ms: number) => Promise<void> },
): Promise<ProjectState> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (;;) {
    const state = await runProject(await make());
    if (!pausedForAllowance(state)) return state;
    o.log?.(`waiting ${Math.round(o.everyMs / 60_000)} minutes for the usage allowance, then trying again`);
    await sleep(o.everyMs);
  }
}
