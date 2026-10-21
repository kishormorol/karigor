/**
 * Operate and maintain: production signals become work items, and a released project with open
 * work items goes round the kernel again under the `maintenance` template.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { FsStore, makeId, type Artifact, type Committer, type MetaOf, type NewEvent, type ProjectState } from "@karigor/store";
import { loadTemplate } from "@karigor/process";
import { estimate, isFlatRate } from "@karigor/budget";
import type { SecurityFinding, UrlCheck } from "@karigor/gates";
import type { ModelAdapter } from "@karigor/runtime";
import { LocalSandbox, Workspace, checkUrl } from "@karigor/sandbox";
import { LocalDeploy, startServer, type DeployAdapter, type RunningServer } from "@karigor/deploy";
import { generateSettingValue, readSettings, type MissingSetting } from "@karigor/profiles";
import { liveRecord } from "./render.js";
import { runProject, type RunOptions } from "./run.js";

export type Severity = MetaOf<"work-item">["severity"];
export type SignalSource = MetaOf<"work-item">["source"];

/** Something seen in production, or said by the person, that may need work. */
export interface Signal {
  source: SignalSource;
  severity: Severity;
  /** One line, plain language. */
  title: string;
  description: string;
  /** Same fingerprint while open means the same problem. */
  fingerprint: string;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/** The person's own words. */
export function feedbackSignal(text: string): Signal {
  const t = text.trim();
  return { source: "feedback", severity: "medium", title: t.split("\n")[0]!.slice(0, 120), description: t, fingerprint: `feedback:${hash(t.toLowerCase().replace(/\s+/g, " "))}` };
}

/** The same error with different numbers, ids or quoted values is one problem. */
export function normaliseError(line: string): string {
  return line
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/^\s*(\[[^\]]*\]\s*)*/, "")
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, "<time>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")
    .replace(/(["'`]).*?\1/g, "<value>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

const ERROR_LINE = /(Error|Exception)\b|\b(Unhandled|uncaught|FATAL|ECONNREFUSED|ENOENT)\b|\b(GET|POST|PUT|DELETE)\b.*\b5\d\d\b/;

/** Error lines from the running app's output, one signal per distinct error. Repeats raise severity. */
export function errorSignals(lines: string[]): Signal[] {
  const seen = new Map<string, { line: string; count: number }>();
  for (const line of lines) {
    if (!ERROR_LINE.test(line)) continue;
    const key = normaliseError(line);
    const s = seen.get(key) ?? { line: line.trim(), count: 0 };
    s.count += 1;
    seen.set(key, s);
  }
  return [...seen.entries()].map(([key, s]) => ({
    source: "error",
    severity: s.count >= 5 ? "high" : "medium",
    title: `The app reported an error: ${s.line.slice(0, 100)}`,
    description: `The running app printed this error ${s.count} time${s.count === 1 ? "" : "s"}:\n\n${s.line.slice(0, 2000)}`,
    fingerprint: `error:${hash(key)}`,
  }));
}

/** Vulnerable dependencies from the audit, one signal per package. */
export function dependencySignals(findings: SecurityFinding[]): Signal[] {
  return findings
    .filter((f) => f.location === "package.json" && (f.severity === "high" || f.severity === "critical"))
    .map((f) => ({ source: "dependency" as const, severity: f.severity, title: `A library the app uses has a known security problem (${f.title.split(":")[0]})`, description: `${f.severity}: ${f.title}. Upgrade or replace it.`, fingerprint: `dependency:${f.title.split(":")[0]}` }));
}

/** One failure can be a blip; `tries` failures in a row is downtime. */
export async function healthSignal(url: string, o: { tries?: number; gapMs?: number; check?: (url: string) => Promise<UrlCheck> } = {}): Promise<Signal | undefined> {
  const check = o.check ?? ((u: string) => checkUrl(u));
  let last: UrlCheck | undefined;
  for (let i = 0; i < (o.tries ?? 2); i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, o.gapMs ?? 5_000));
    last = await check(url);
    if (last.ok) return undefined;
  }
  return { source: "downtime", severity: "critical", title: "The live app is not answering", description: `${url} failed ${o.tries ?? 2} checks in a row. Last answer: ${last?.status ?? 0} ${last?.output.slice(0, 1000) ?? ""}`, fingerprint: "downtime" };
}

/** Write a work item per new fingerprint. A fingerprint that is already open is not filed again. */
export async function recordSignals(store: FsStore, signals: Signal[], clock: () => Date = () => new Date()): Promise<string[]> {
  const state = await store.replay();
  const open = new Set(Object.values(state.workItems).filter((w) => w.status !== "done").map((w) => w.fingerprint));
  const events: NewEvent[] = [];
  const ids: string[] = [];
  for (const s of signals) {
    if (open.has(s.fingerprint)) continue;
    open.add(s.fingerprint);
    const id = makeId("work-item", clock());
    const a: Artifact = {
      meta: { id, kind: "work-item", createdAt: clock().toISOString(), createdBy: s.source === "feedback" ? "user" : "system", source: s.source, severity: s.severity, title: s.title, description: s.description, status: "todo", fingerprint: s.fingerprint },
      body: s.description + "\n",
    };
    await store.writeArtifact(a);
    events.push({ type: "signal-received", by: s.source === "feedback" ? "user" : "system", workItemId: id, source: s.source, severity: s.severity, fingerprint: s.fingerprint });
    ids.push(id);
  }
  if (events.length) {
    await store.appendEvents(events);
    await store.commit(`karigor: ${events.length} new work item(s)`);
  }
  return ids;
}

/** Is there anything to fix, and is the project in a state where a fix round can start? */
export function canStartMaintenance(state: ProjectState): boolean {
  if (state.status !== "finished" && state.status !== "stopped") return false;
  if (!state.budgetTier || !(state.artifacts.backlog?.length)) return false;
  return Object.values(state.workItems).some((w) => w.status !== "done");
}

/**
 * Begin a maintenance cycle: give it its own slice of budget at the project's tier and switch the
 * project to the `maintenance` template. Returns the cycle number, or undefined when there is nothing to do.
 */
export async function startMaintenance(store: FsStore, o: { adapter: ModelAdapter; templatesDir?: string; clock?: () => Date }): Promise<number | undefined> {
  const state = await store.replay();
  if (!canStartMaintenance(state)) return undefined;
  const open = Object.entries(state.workItems).filter(([, w]) => w.status !== "done").map(([id]) => id);
  const template = await loadTemplate("maintenance", o.templatesDir);
  const cycle = state.cycle + 1;
  if (state.ledgerId) {
    const ledger = await store.readArtifact("cost-ledger", state.ledgerId);
    const tiers = estimate(template, { expectedItems: Math.max(2, open.length * 2), judgmentModel: o.adapter.modelFor("judgment"), routineModel: o.adapter.modelFor("routine"), freeModel: o.adapter.name === "mock" ? "mock" : "ollama/local" });
    const t = tiers.find((x) => x.tier === state.budgetTier)!;
    const phaseBudgets = { ...ledger.meta.phaseBudgets };
    for (const [phase, amount] of Object.entries(t.phaseBudgets)) phaseBudgets[`m${cycle}:${phase}`] = amount;
    const meta = { ...ledger.meta, phaseBudgets, budgetTotal: ledger.meta.budgetTotal + t.total };
    await store.writeArtifact({ meta, body: ledger.body.replace(/\n*$/, `\nFix round ${cycle}: ${t.currency} ${t.total.toFixed(2)} added.\n`) });
  }
  await store.appendEvent({ type: "maintenance-started", by: "system", cycle, template: "maintenance", workItemIds: open });
  await store.commit(`karigor: fix round ${cycle} for ${open.length} work item(s)`);
  return cycle;
}

export interface OperateOptions extends Omit<RunOptions, "root" | "projectId"> {
  root: string;
  projectId: string;
  /** Check this URL's health (the live app's health endpoint). */
  healthUrl?: string;
  healthCheck?: { tries?: number; gapMs?: number; check?: (url: string) => Promise<UrlCheck> };
  /** Run the dependency audit in the workspace. */
  audit?: boolean;
  /** Signals gathered elsewhere (feedback, app error lines). */
  signals?: Signal[];
  /** Record signals but do not start a fix round. */
  recordOnly?: boolean;
}

export interface OperateResult {
  recorded: string[];
  cycle?: number;
  state: ProjectState;
}

/** One pass of operating a project: gather signals, file work items, and run a fix round when needed. */
export async function operateOnce(o: OperateOptions): Promise<OperateResult> {
  const clock = o.clock ?? (() => new Date());
  const log = o.log ?? (() => {});
  const storeOpts = { clock, ...(o.committer ? { committer: o.committer as Committer } : {}) };
  const store = await FsStore.open(o.root, o.projectId, storeOpts);
  const signals: Signal[] = [...(o.signals ?? [])];
  if (o.healthUrl) {
    const s = await healthSignal(o.healthUrl, o.healthCheck ?? {});
    if (s) signals.push(s);
  }
  if (o.audit && o.profile) {
    const dir = join(store.dir, "workspace");
    if (await stat(join(dir, ".git")).then(() => true, () => false)) {
      const scan = await new LocalSandbox(await Workspace.open(dir), o.profile).securityScan();
      signals.push(...dependencySignals(scan.findings));
    }
  }
  const recorded = await recordSignals(store, signals, clock);
  for (const id of recorded) log(`new work item ${id}`);
  let state = await store.replay();
  // A project paused for the provider's allowance carries on at the next pass.
  if (!o.recordOnly && state.status === "waiting" && state.pausedReason) {
    const { healthUrl: _h, healthCheck: _c, audit: _a, signals: _s, recordOnly: _r, ...run } = o;
    log("carrying on after the pause");
    state = await runProject(run);
    return { recorded, state };
  }
  if (o.recordOnly || !canStartMaintenance(state)) return { recorded, state };
  const cycle = await startMaintenance(store, { adapter: o.adapter, ...(o.templatesDir ? { templatesDir: o.templatesDir } : {}), clock });
  if (cycle === undefined) return { recorded, state };
  log(`fix round ${cycle}: starting`);
  const { healthUrl: _h, healthCheck: _c, audit: _a, signals: _s, recordOnly: _r, ...run } = o;
  state = await runProject(run);
  return { recorded, cycle, state };
}

/** The production URL to watch for a hosted target (a local target is watched by `serve`). */
export async function hostedHealthUrl(store: FsStore, state: ProjectState, healthPath = "/"): Promise<string | undefined> {
  const live = await liveRecord(store, state);
  if (!live?.url || /^http:\/\/(localhost|127\.0\.0\.1)/.test(live.url)) return undefined;
  return `${live.url.replace(/\/$/, "")}${healthPath}`;
}

/** Plain words for whether money is involved in a fix round. */
export function fixRoundCostNote(adapter: ModelAdapter): string {
  return isFlatRate(adapter.modelFor("judgment")) ? "Fix rounds cost nothing extra on this setup." : "Fix rounds use the same budget tier you chose; each round gets its own slice.";
}

/**
 * The person says a decision made on their behalf is wrong. The ledger records the correction
 * (roles read it from then on), and a released project gets a work item so a fix round applies it.
 */
export async function correctAssumption(store: FsStore, assumptionId: string, correctedTo: string, clock: () => Date = () => new Date()): Promise<{ ledgerId: string; workItemId?: string }> {
  const state = await store.replay();
  const prevId = state.artifacts.ledger?.at(-1);
  if (!prevId) throw new Error("no decisions have been recorded yet");
  const prev = await store.readArtifact("ledger", prevId);
  const a = prev.meta.assumptions.find((x) => x.id === assumptionId);
  if (!a) throw new Error(`no decision ${assumptionId} (have: ${prev.meta.assumptions.map((x) => x.id).join(", ")})`);
  const text = correctedTo.trim();
  const assumptions = prev.meta.assumptions.map((x) => (x.id === assumptionId ? { ...x, correctedTo: text } : x));
  const meta = { ...prev.meta, id: makeId("ledger", clock()), createdAt: clock().toISOString(), createdBy: "user" as const, assumptions };
  const body = ["# Assumptions", "", ...assumptions.map((x) => `- **${x.topic}**: ${x.correctedTo ? `${x.correctedTo} _(corrected by the person; was: ${x.decision})_` : `${x.decision} _(${x.reason}; decided by ${x.madeBy} during ${x.phase})_`}`)].join("\n") + "\n";
  await store.writeArtifact({ meta, body });
  await store.appendEvent({ type: "assumption-corrected", by: "user", assumptionId, correctedTo: text, ledgerId: meta.id });
  await store.commit(`karigor: the person corrected ${assumptionId}`);
  let workItemId: string | undefined;
  if (state.status === "finished" || state.status === "stopped") {
    const s = feedbackSignal(`Change a decision about ${a.topic}: it was "${a.decision}", and it should be: ${text}`);
    [workItemId] = await recordSignals(store, [{ ...s, title: `Change: ${a.topic} should be "${text.slice(0, 80)}"` }], clock);
  }
  return { ledgerId: meta.id, ...(workItemId ? { workItemId } : {}) };
}

export interface ServeOptions extends Omit<OperateOptions, "deploy" | "healthUrl" | "signals" | "audit" | "profile"> {
  profile: NonNullable<RunOptions["profile"]>;
  port: number;
  /** How often to look for problems. */
  everyMs: number;
  /** How often to run the dependency audit (it needs the network). */
  auditEveryMs?: number;
  signal?: AbortSignal;
}

/**
 * Production for the local target: serve the live release on `port`, read its output for errors,
 * check its health on an interval, run fix rounds when needed, and switch to each new release.
 */
export async function serveProject(o: ServeOptions): Promise<void> {
  const log = o.log ?? (() => {});
  const store = await FsStore.open(o.root, o.projectId);
  const deploy = new LocalDeploy({ projectDir: store.dir, profile: o.profile, productionPort: o.port, log });
  const healthPath = o.profile.healthPath ?? "/";
  let server: RunningServer | undefined;
  const lines: string[] = [];
  const start = async () => {
    await server?.stop();
    server = undefined;
    const cur = await deploy.current();
    if (!cur) {
      log("nothing is live yet; waiting for a release");
      return;
    }
    const s = startServer(o.profile.commands.start!, deploy.releaseDir(cur.version), o.port, await deploy.settingsEnv());
    s.onLine((l) => lines.push(l));
    const h = await s.waitHealthy(healthPath, 120_000);
    server = s;
    log(h.ok ? `serving ${cur.version} at http://localhost:${o.port}` : `${cur.version} started but is not healthy: ${h.output.split("\n")[0]}`);
  };
  deploy.onChange(() => {
    void start();
  });
  await start();
  let lastAudit = 0;
  try {
    while (!o.signal?.aborted) {
      const audit = Date.now() - lastAudit >= (o.auditEveryMs ?? 24 * 60 * 60 * 1000);
      if (audit) lastAudit = Date.now();
      const signals = errorSignals(lines.splice(0));
      const { log: _l, port: _p, everyMs: _e, auditEveryMs: _a, signal: _s, ...rest } = o;
      const r = await operateOnce({ ...rest, log, deploy, signals, audit, ...(server ? { healthUrl: `http://127.0.0.1:${o.port}${healthPath}` } : {}) });
      if (r.cycle) log(`fix round ${r.cycle} ended: ${r.state.status}${r.state.stopReason ? ` (${r.state.stopReason})` : ""}`);
      await new Promise<void>((res) => {
        const t = setTimeout(res, o.everyMs);
        o.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          res();
        });
      });
    }
  } finally {
    await server?.stop();
    await deploy.stop();
  }
}

export interface ProvideSettingsResult {
  stored: string[];
  /** The project was waiting for these settings and can go on now (run it again). */
  resumed?: boolean;
  /** What the live app still lacks afterwards. */
  stillMissing: MissingSetting[];
  /** The live address after the settings were applied, when something is live. */
  url?: string;
  output: string;
}

/**
 * Store settings for the live app and make it use them. Only settings the app documents can be
 * set. Values go to the deploy target's secret store and nowhere else; the log records names.
 * Missing `generate` settings are filled in at the same time.
 */
export async function provideSettings(o: { store: FsStore; deploy: DeployAdapter; values: Record<string, string>; by?: "user" | "system"; clock?: () => Date; log?: (line: string) => void }): Promise<ProvideSettingsResult> {
  const clock = o.clock ?? (() => new Date());
  const dir = join(o.store.dir, "workspace");
  if (!o.deploy.setSettings || !o.deploy.missingSettings) throw new Error(`the ${o.deploy.name} target cannot store settings`);
  const known = new Set((await readSettings(dir)).map((s) => s.name));
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.values)) {
    if (!known.has(k)) throw new Error(`the app has no setting called ${k} (it has: ${[...known].join(", ") || "none"})`);
    if (typeof v !== "string" || !v.trim()) continue;
    values[k] = v.trim();
  }
  for (const m of await o.deploy.missingSettings(dir)) if (m.kind === "generate" && !values[m.name]) values[m.name] = generateSettingValue();
  const names = Object.keys(values);
  if (!names.length) return { stored: [], stillMissing: await o.deploy.missingSettings(dir), output: "nothing to store" };
  const saved = await o.deploy.setSettings(dir, values);
  if (!saved.ok) throw new Error(saved.output);
  await o.store.appendEvent({ type: "settings-provided", by: o.by ?? "user", names });
  let state = await o.store.replay();
  if (state.status === "waiting") {
    const still = (await o.deploy.missingSettings(dir)).filter((m) => m.kind !== "generate");
    if (still.length) {
      await o.store.commit(`karigor: settings stored (${names.join(", ")})`);
      return { stored: names, stillMissing: still, output: saved.output };
    }
    await o.store.appendEvent({ type: "project-resumed", by: "user" });
    await o.store.commit(`karigor: settings stored (${names.join(", ")}); the release can go on`);
    return { stored: names, resumed: true, stillMissing: [], output: saved.output };
  }
  state = await o.store.replay();
  const live = await liveRecord(o.store, state);
  const stillMissing = await o.deploy.missingSettings(dir);
  if (!live || !o.deploy.applySettings) {
    await o.store.commit(`karigor: settings stored (${names.join(", ")})`);
    return { stored: names, stillMissing, output: saved.output };
  }
  o.log?.(`applying the settings to the live version ${live.version}`);
  const res = await o.deploy.applySettings({ dir, live: { url: live.url ?? "", id: live.releaseId ?? live.url ?? "", version: live.version } });
  if (!res.ok) {
    await o.store.commit(`karigor: settings stored (${names.join(", ")}); not applied yet`);
    return { stored: names, stillMissing, output: `${saved.output}\nthe live version did not pick them up yet: ${res.output.split("\n").at(-1)}` };
  }
  const record: Artifact = {
    meta: {
      id: makeId("deploy-record", clock()),
      kind: "deploy-record",
      createdAt: clock().toISOString(),
      createdBy: "system",
      target: live.target,
      environment: "production",
      version: live.version,
      status: "deployed",
      rollbackVerified: true,
      key: `settings:${state.lastSeq}`,
      ...(res.url ? { url: res.url } : live.url ? { url: live.url } : {}),
      ...(res.id ? { releaseId: res.id } : {}),
      ...(stillMissing.length ? { missingSettings: stillMissing } : {}),
    },
    body: `${saved.output}\n\n${res.output}`,
  };
  await o.store.writeArtifact(record);
  await o.store.appendEvent({ type: "artifact-written", by: "system", kind: "deploy-record", id: record.meta.id });
  await o.store.commit(`karigor: settings applied to ${live.version}`);
  return { stored: names, stillMissing, ...(res.url ?? live.url ? { url: (res.url ?? live.url)! } : {}), output: `${saved.output}\n${res.output.split("\n").at(-1) ?? ""}` };
}

/** sha256 (first 16 hex) of every UI kit the template has shipped, so an untouched copy can be upgraded. */
export const UI_KIT_HISTORY = ["7e71e280ccaa32d8", "3efd564f773868ca", "c1ae248dbf5f92f9"];

/**
 * Bring an app built from an older template up to the current UI kit: copy `src/components/ui.tsx`
 * (or upgrade it, when it is an earlier template version nobody has edited) and add the theme to
 * `app/globals.css` when it has none. No page changes; a fix round restyles the screens.
 * Returns what changed (empty when nothing needed to); an edited kit is reported, never overwritten.
 */
export async function installUiKit(store: FsStore, profileName = "web-app"): Promise<string[]> {
  const { SCAFFOLDS_DIR } = await import("@karigor/profiles");
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const from = join(SCAFFOLDS_DIR, profileName);
  const dir = join(store.dir, "workspace");
  const ws = await Workspace.open(dir);
  const added: string[] = [];
  const kitTarget = join(dir, "src", "components", "ui.tsx");
  const kit = await readFile(join(from, "src", "components", "ui.tsx"), "utf8");
  const current = await readFile(kitTarget, "utf8").catch(() => undefined);
  const hash = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 16);
  if (current === undefined) {
    await mkdir(join(dir, "src", "components"), { recursive: true });
    await writeFile(kitTarget, kit, "utf8");
    added.push("src/components/ui.tsx");
  } else if (current !== kit) {
    if (UI_KIT_HISTORY.includes(hash(current))) {
      await writeFile(kitTarget, kit, "utf8");
      added.push("src/components/ui.tsx (upgraded)");
    } else {
      added.push("src/components/ui.tsx was changed in this app, so it was left as it is");
    }
  }
  const globalsPath = join(dir, "app", "globals.css");
  const globals = await readFile(globalsPath, "utf8").catch(() => "");
  if (!globals.includes("@theme")) {
    const theme = (await readFile(join(from, "app", "globals.css"), "utf8")).replace(/^@import "tailwindcss";\n*/, "");
    const rest = globals.replace(/^@import "tailwindcss";\n*/, "");
    await writeFile(globalsPath, `@import "tailwindcss";\n\n${theme.trimEnd()}\n${rest ? `\n${rest}` : ""}`, "utf8");
    added.push("app/globals.css (theme)");
  }
  // The first template wrapped every page in a narrow box; the kit's frames bring their own width.
  const layoutPath = join(dir, "app", "layout.tsx");
  const layout = await readFile(layoutPath, "utf8").catch(() => "");
  const oldWrapper = '<main className="mx-auto max-w-2xl px-4 py-8">{children}</main>';
  if (layout.includes(oldWrapper)) {
    await writeFile(layoutPath, layout.replace(oldWrapper, "{children}").replace('className="min-h-screen bg-white text-gray-900 antialiased"', 'className="min-h-screen bg-ground font-sans text-ink antialiased"'), "utf8");
    added.push("app/layout.tsx (the old narrow page box removed)");
  }
  if (added.some((a) => !a.includes("left as it is"))) await ws.commitAll(`karigor: the Ledger UI kit from the template (${added.join(", ")})`);
  return added;
}

/**
 * Put a stopped project back to work: every parked item returns with a fresh retry count and the
 * project goes back to building them, then on to release. For a project that stopped because of
 * something outside the work (an allowance that ran out before pausing existed, a broken machine).
 * Returns the items put back.
 */
export async function reopenProject(store: FsStore, o: { templatesDir?: string } = {}): Promise<string[]> {
  const state = await store.replay();
  if (state.status !== "stopped") throw new Error(`only a stopped project can be reopened (this one is ${state.status})`);
  if (!state.template) throw new Error("the project never chose a process, so there is nothing to reopen");
  const template = await loadTemplate(state.template, o.templatesDir);
  const loopPhase = Object.entries(template.phases).find(([, p]) => p.loop)?.[0];
  const backlogId = state.artifacts.backlog?.at(-1);
  const items = backlogId ? (await store.readArtifact("backlog", backlogId)).meta.items : [];
  const parked = items.filter((b) => (state.items[b.id]?.status ?? b.status) === "parked").map((b) => b.id);
  const events: NewEvent[] = [{ type: "project-reopened", by: "user", itemIds: parked }];
  if (parked.length && loopPhase && state.phase && state.phase !== loopPhase) {
    events.push({ type: "transition", by: "user", from: state.phase, to: loopPhase }, { type: "phase-entered", by: "user", phase: loopPhase });
  }
  await store.appendEvents(events);
  await store.commit(`karigor: reopened with ${parked.length} item(s) back on the list`);
  return parked;
}
