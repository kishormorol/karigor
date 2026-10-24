import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod/v4";
import type { Artifact, ArtifactKind, ArtifactOf, BacklogItem, MetaOf, ProjectState, Role, Stage, TargetProfile } from "@karigor/store";
import { TARGET_PROFILES } from "@karigor/store";
import type { Template } from "@karigor/process";
import { ArchitectOutput, DeveloperOutput, PlannerOutput, ProductOwnerOutput, ReleaserOutput, SelectorOutput, type AssumptionInput } from "./schemas.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ROLES_DIR = join(here, "..", "..", "src", "roles");

export async function readPrompt(name: Role | "preamble" | "developer-agent"): Promise<string> {
  return readFile(join(ROLES_DIR, `${name}.md`), "utf8");
}

/** What a worker can read and write while producing its artifacts. */
export interface RoleContext {
  state: ProjectState;
  store: {
    readArtifact<K extends ArtifactKind>(kind: K, id: string): Promise<ArtifactOf<K>>;
  };
  phase: string;
  itemId?: string;
  purpose?: "shrink";
  /** Set on a retry: why the previous attempt was rejected, and what it produced. */
  feedback?: { reasons: string[]; previous: Artifact[] };
  /** The build crew's conventions for the target profile, when a real workspace exists. */
  stackGuide?: string;
  /** The preview a deploy target really made in this phase. The releaser describes it instead of inventing one. */
  deploy?: ArtifactOf<"deploy-record">;
  /** Plain words from the deploy target: where the product lives and how to open it. */
  deployTarget?: string;
  /** What the kind of software being built can and cannot do yet, rendered; specs and plans stay within it. */
  capabilities?: string;
  /** Kinds of software this run can really build (target profile names). Unset: every kind is offered. */
  buildable?: string[];
  backlog: BacklogItem[];
  templates: Template[];
  clock: () => Date;
  makeId: (kind: ArtifactKind) => string;
}

export interface RoleDefinition<T> {
  role: Role;
  schema: z.ZodType<T>;
  /** Default tier when money allows. */
  tier: "judgment" | "routine";
  /** Render the task text (volatile part of the prompt). */
  inputs(ctx: RoleContext): Promise<string>;
  /** Turn validated output into artifacts. Must not perform IO beyond reading. */
  write(output: T, ctx: RoleContext): Promise<Artifact[]>;
}

async function latest<K extends ArtifactKind>(ctx: RoleContext, kind: K): Promise<ArtifactOf<K> | undefined> {
  const ids = ctx.state.artifacts[kind];
  const id = ids?.[ids.length - 1];
  return id ? ctx.store.readArtifact(kind, id) : undefined;
}

/**
 * The spec stage being built now: the one a `stage` cycle names, or the first stage during the first build.
 * Undefined in a fix round, and for specs written before stages existed (they are one stage: everything).
 */
export function currentStage(state: ProjectState, spec: ArtifactOf<"spec"> | undefined): Stage | undefined {
  const stages = spec?.meta.stages ?? [];
  if (state.stage) return stages.find((s) => s.id === state.stage);
  return state.cycle === 0 ? stages[0] : undefined;
}

/** What the person will have once each stage is built, with where the build is now. */
function renderStages(state: ProjectState, spec: ArtifactOf<"spec">, now: Stage | undefined): string {
  const built = new Set(state.stagesBuilt);
  if (state.firstBuilt && spec.meta.stages[0]) built.add(spec.meta.stages[0].id);
  const features = new Map(spec.meta.features.map((f) => [f.id, f]));
  return spec.meta.stages
    .map((s, i) => {
      const mark = s.id === now?.id ? "BUILDING NOW" : built.has(s.id) ? "built and live" : "later";
      const fs = s.featureIds.map((f) => `  - ${f}: ${features.get(f)?.name ?? f}${features.get(f) ? ` (${features.get(f)!.priority}) - ${features.get(f)!.description}` : ""}`).join("\n");
      return `${i + 1}. **${s.name}** (\`${s.id}\`, ${mark}): ${s.goal}\n${fs}`;
    })
    .join("\n");
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`;
}

export function renderArtifact(a: Artifact): string {
  const { body, ...rest } = { ...a.meta, body: a.body };
  return section(`${a.meta.kind} ${a.meta.id}`, "```json\n" + JSON.stringify(rest, null, 2) + "\n```\n\n" + (body || "(no body)"));
}

/** The "your last attempt was rejected" section every producing role sees on a retry. */
export function renderFeedback(ctx: RoleContext): string {
  if (!ctx.feedback) return "";
  const { reasons, previous } = ctx.feedback;
  const parts = [
    section(
      "Your previous attempt was rejected",
      ["The checks below failed. Revise your previous work: keep what passed, fix exactly what failed, and do not introduce new scope.", "", ...reasons.map((r) => `- ${r}`)].join("\n"),
    ),
  ];
  for (const a of previous) parts.push(section(`Your previous ${a.meta.kind} (revise this)`, "```json\n" + JSON.stringify({ ...a.meta }, null, 2) + "\n```\n\n" + (a.body || "(no body)")));
  return parts.join("\n");
}

async function ledgerWith(ctx: RoleContext, role: Role, inputs: z.infer<typeof AssumptionInput>[]): Promise<Artifact | undefined> {
  if (inputs.length === 0) return undefined;
  const prev = await latest(ctx, "ledger");
  // A retry replaces this role's earlier entries for the same phase (and item), so the ledger never repeats itself.
  const kept = (prev?.meta.assumptions ?? []).filter((a) => !(a.madeBy === role && a.phase === ctx.phase && a.itemId === ctx.itemId));
  const assumptions = [
    ...kept,
    ...inputs.map((a, i) => ({ id: `a${kept.length + i + 1}`, topic: a.topic, decision: a.decision, reason: a.reason, madeBy: role, phase: ctx.phase, ...(ctx.itemId !== undefined ? { itemId: ctx.itemId } : {}) })),
  ].map((a, i) => ({ ...a, id: `a${i + 1}` }));
  const meta: MetaOf<"ledger"> = { id: ctx.makeId("ledger"), kind: "ledger", createdAt: ctx.clock().toISOString(), createdBy: role, phase: ctx.phase, assumptions };
  const body = ["# Assumptions", "", ...assumptions.map((a) => `- **${a.topic}**: ${a.decision} _(${a.reason}; decided by ${a.madeBy} during ${a.phase})_`)].join("\n") + "\n";
  return { meta, body };
}

const base = (ctx: RoleContext, role: Role, kind: ArtifactKind) => ({
  id: ctx.makeId(kind),
  createdAt: ctx.clock().toISOString(),
  createdBy: role,
  phase: ctx.phase,
});

export const selector: RoleDefinition<SelectorOutput> = {
  role: "selector",
  schema: SelectorOutput,
  tier: "judgment",
  async inputs(ctx) {
    const idea = await latest(ctx, "idea");
    const templates = ctx.templates.map((t) => `- **${t.name}**: ${t.description}\n  Fits when: ${t.fitsWhen.trim().replace(/\n/g, " ")}`).join("\n");
    const profiles = Object.entries(TARGET_PROFILES).filter(([k]) => !ctx.buildable || ctx.buildable.includes(k)).map(([k, v]) => `- **${k}**: ${v}`).join("\n");
    return [section("Idea", idea?.meta.text ?? "(missing)"), section("Templates", templates), section("Target profiles", profiles)].join("\n");
  },
  async write(out, ctx) {
    const { target, fellBack } = buildableTarget(out.targetProfile, ctx.buildable);
    const l = await ledgerWith(ctx, "selector", [
      { topic: "process", decision: `Work will follow the "${out.template}" process.`, reason: out.reasons.join(" ") },
      {
        topic: "kind of software",
        decision: `This will be built as: ${TARGET_PROFILES[target]}`,
        reason: fellBack ? `The best fit would be ${TARGET_PROFILES[out.targetProfile].charAt(0).toLowerCase()}${TARGET_PROFILES[out.targetProfile].slice(1, -1)}, which Karigor cannot build yet, so this is the closest kind it can. ${out.reasons.join(" ")}` : out.reasons.join(" "),
      },
      ...out.assumptions,
    ]);
    return l ? [l] : [];
  },
};

/** The kind the selector chose, or the first buildable kind when the chosen one cannot be built in this run. */
export function buildableTarget(chosen: TargetProfile, buildable?: string[]): { target: TargetProfile; fellBack: boolean } {
  if (!buildable || buildable.includes(chosen)) return { target: chosen, fellBack: false };
  const target = (buildable.find((k) => k in TARGET_PROFILES) ?? "web-app") as TargetProfile;
  return { target, fellBack: true };
}

/** What can be built at all, so a spec never depends on something the build crew cannot make. */
const whatItCanDo = (ctx: RoleContext) =>
  ctx.capabilities ? section("What this kind of software can do (plan within it)", ctx.capabilities) : "";

/** Where releases really go, so a spec never promises hosting the run will not use. */
const whereItLives = (ctx: RoleContext) =>
  ctx.deployTarget ? section("Where it will go live (plan for this; do not promise other hosting)", ctx.deployTarget) : "";

export const productOwner: RoleDefinition<ProductOwnerOutput> = {
  role: "product-owner",
  schema: ProductOwnerOutput,
  tier: "judgment",
  async inputs(ctx) {
    const idea = await latest(ctx, "idea");
    const ledger = await latest(ctx, "ledger");
    return [section("Idea", idea?.meta.text ?? "(missing)"), whatItCanDo(ctx), whereItLives(ctx), ledger ? renderArtifact(ledger) : "", renderFeedback(ctx)].join("\n");
  },
  async write(out, ctx) {
    const { assumptions, body, ...fields } = out;
    const spec: Artifact = { meta: { ...base(ctx, "product-owner", "spec"), kind: "spec", ...fields }, body };
    const l = await ledgerWith(ctx, "product-owner", assumptions);
    return l ? [spec, l] : [spec];
  },
};

export const architect: RoleDefinition<ArchitectOutput> = {
  role: "architect",
  schema: ArchitectOutput,
  tier: "judgment",
  async inputs(ctx) {
    const spec = await latest(ctx, "spec");
    const ledger = await latest(ctx, "ledger");
    const previous = await latest(ctx, "architecture");
    const stage = currentStage(ctx.state, spec);
    const profile = ctx.state.targetProfile ?? "web-app";
    return [
      section("Target profile", `${profile}: ${TARGET_PROFILES[profile as keyof typeof TARGET_PROFILES] ?? ""}`),
      ctx.stackGuide ? section("The build crew's stack (design within it)", ctx.stackGuide) : "",
      whatItCanDo(ctx),
      whereItLives(ctx),
      spec ? renderArtifact(spec) : "",
      spec?.meta.stages.length ? section("Stages", renderStages(ctx.state, spec, stage)) : "",
      previous && ctx.state.stage
        ? section(
            "The architecture so far (revise it for the stage being built now)",
            "What is built and live follows this design. Return the whole architecture again: keep earlier modules, roles and stack as they are unless this stage must change them (say why in `risks` or the body), and add what this stage needs.\n\n" + renderArtifact(previous),
          )
        : "",
      ledger ? renderArtifact(ledger) : "",
      renderFeedback(ctx),
    ].join("\n");
  },
  async write(out, ctx) {
    const { assumptions, body, ...fields } = out;
    const arch: Artifact = { meta: { ...base(ctx, "architect", "architecture"), kind: "architecture", targetProfile: ctx.state.targetProfile ?? "web-app", ...fields }, body };
    const l = await ledgerWith(ctx, "architect", assumptions);
    return l ? [arch, l] : [arch];
  },
};

export const planner: RoleDefinition<PlannerOutput> = {
  role: "planner",
  schema: PlannerOutput,
  tier: "judgment",
  async inputs(ctx) {
    const spec = await latest(ctx, "spec");
    const arch = await latest(ctx, "architecture");
    const parts = [spec ? renderArtifact(spec) : "", arch ? renderArtifact(arch) : "", ctx.stackGuide ? section("The build crew's stack (items must fit it)", ctx.stackGuide) : "", whatItCanDo(ctx)];
    const stage = currentStage(ctx.state, spec);
    if (spec && stage && ctx.purpose !== "shrink") {
      parts.push(
        section(
          "Stage to build now",
          `Plan only the stage marked BUILDING NOW: **${stage.name}** (\`${stage.id}\`): ${stage.goal}\nIts features: ${stage.featureIds.join(", ")}. Stages marked "built and live" exist already; stages marked "later" are not planned now.\n\n${renderStages(ctx.state, spec, stage)}`,
        ),
      );
    }
    if (ctx.purpose === "shrink" && ctx.itemId) {
      const item = ctx.backlog.find((b) => b.id === ctx.itemId);
      parts.push(section("SHRINK this item", "```json\n" + JSON.stringify(item, null, 2) + "\n```\nIt failed repeatedly. Replace it with smaller items. Use ids prefixed with its id."));
      parts.push(section("Existing item ids (do not reuse)", ctx.backlog.map((b) => b.id).join(", ")));
    } else if (ctx.backlog.length && ctx.state.cycle > 0) {
      // A fix round or a later stage plans only its own work; what earlier releases built is context, not work.
      parts.push(section("Already built in earlier releases (context only; do not plan these again)", (await builtSoFar(ctx)).map((b) => `- ${b.title}`).join("\n")));
    } else if (ctx.backlog.length) {
      parts.push(section("Existing backlog", "```json\n" + JSON.stringify(ctx.backlog, null, 2) + "\n```"));
    }
    const open = openWorkItems(ctx);
    if (open.length) {
      const items = await Promise.all(open.map((id) => ctx.store.readArtifact("work-item", id)));
      parts.push(
        section(
          "Open work items (maintenance)",
          (stage
            ? "The product is live. Each item below is a problem seen in production or a request from the person since the last release. Plan items for them too, alongside this stage's items, most severe first.\n\n"
            : "The product is live. Each item below is a problem seen in production or a request from the person. Plan the smallest backlog that fixes them, most severe first; do not add unrelated features.\n\n") + items.map(renderArtifact).join("\n"),
        ),
      );
    }
    parts.push(renderFeedback(ctx));
    return parts.join("\n");
  },
  async write(out, ctx) {
    const items: BacklogItem[] = out.items.map((i) => ({ ...i, status: "todo" as const, ...(i.featureId !== undefined ? { featureId: i.featureId } : {}), ...(i.moduleId !== undefined ? { moduleId: i.moduleId } : {}) }));
    let all: BacklogItem[];
    if (ctx.purpose === "shrink" && ctx.itemId) {
      const ids = new Set(ctx.backlog.map((b) => b.id));
      const fresh = items.filter((i) => !ids.has(i.id));
      if (fresh.length === 0) throw new Error("shrink produced no new items");
      const replacementIds = fresh.map((i) => i.id);
      // Whatever depended on the shrunk item now depends on its replacements, so nothing deadlocks.
      all = [
        ...ctx.backlog.map((b) =>
          b.id === ctx.itemId
            ? { ...b, status: "dropped" as const }
            : b.dependsOn.includes(ctx.itemId!)
              ? { ...b, dependsOn: [...new Set([...b.dependsOn.filter((d) => d !== ctx.itemId), ...replacementIds])] }
              : b,
        ),
        ...fresh,
      ];
    } else {
      all = uniqueIds(items, ctx);
    }
    const body = ["# Backlog", "", ...all.map((i) => `- [${i.status}] **${i.id}** ${i.title} (${i.priority}, ${i.estimate})${i.dependsOn.length ? ` after ${i.dependsOn.join(", ")}` : ""}`), "", out.notes].join("\n") + "\n";
    return [{ meta: { ...base(ctx, "planner", "backlog"), kind: "backlog", items: all }, body }];
  },
};

/** Every item finished in any earlier round, oldest first: what a later stage builds on. */
async function builtSoFar(ctx: RoleContext): Promise<BacklogItem[]> {
  const seen = new Map<string, BacklogItem>();
  for (const id of ctx.state.artifacts.backlog ?? []) {
    for (const b of (await ctx.store.readArtifact("backlog", id)).meta.items) {
      if ((ctx.state.items[b.id]?.status ?? b.status) === "done") seen.set(b.id, b);
    }
  }
  return seen.size ? [...seen.values()] : ctx.backlog;
}

/** Work items taken on by the current maintenance cycle, or every open one outside a cycle. */
export function openWorkItems(ctx: Pick<RoleContext, "state">): string[] {
  return Object.entries(ctx.state.workItems ?? {})
    .filter(([, w]) => w.status !== "done" && (ctx.state.cycle === 0 || w.cycle === ctx.state.cycle || w.cycle === undefined))
    .map(([id]) => id);
}

/**
 * A new backlog in a later cycle must not reuse ids the kernel has already settled, or a fresh
 * "b1" would look finished. Colliding ids get the cycle as a prefix; dependencies follow.
 */
function uniqueIds(items: BacklogItem[], ctx: RoleContext): BacklogItem[] {
  // In the first build, a re-plan that keeps an item's id means the same item (finished work stays finished).
  // In a maintenance cycle, a reused id would be mistaken for an item from an earlier release.
  if (ctx.state.cycle === 0) return items;
  const taken = new Set(Object.keys(ctx.state.items));
  if (!items.some((i) => taken.has(i.id))) return items;
  const prefix = `m${ctx.state.cycle || 1}-`;
  const rename = new Map<string, string>();
  for (const i of items) {
    if (!taken.has(i.id)) continue;
    let id = `${prefix}${i.id}`;
    for (let n = 2; taken.has(id) || items.some((x) => x.id === id); n++) id = `${prefix}${i.id}-${n}`;
    rename.set(i.id, id);
  }
  return items.map((i) => ({ ...i, id: rename.get(i.id) ?? i.id, dependsOn: i.dependsOn.map((d) => rename.get(d) ?? d) }));
}

export const developer: RoleDefinition<DeveloperOutput> = {
  role: "developer",
  schema: DeveloperOutput,
  tier: "routine",
  async inputs(ctx) {
    const spec = await latest(ctx, "spec");
    const arch = await latest(ctx, "architecture");
    const item = ctx.backlog.find((b) => b.id === ctx.itemId);
    const parts = [
      section("Backlog item to implement", item ? "```json\n" + JSON.stringify(item, null, 2) + "\n```" : `(phase-level work for ${ctx.phase})`),
      arch ? renderArchitectureFor(arch, item?.moduleId) : "",
      spec ? section("Spec summary", `${spec.meta.title}: ${spec.meta.problem}`) : "",
    ];
    const changes = ctx.state.artifacts["change"] ?? [];
    if (changes.length) {
      const prev = await Promise.all(changes.slice(-5).map((id) => ctx.store.readArtifact("change", id)));
      parts.push(section("Recent changes (for context)", prev.map((c) => `- ${c.meta.itemId}: ${c.meta.summary} (${c.meta.files.map((f) => f.path).join(", ")})`).join("\n")));
    }
    parts.push(renderFeedback(ctx));
    return parts.join("\n");
  },
  async write(out, ctx) {
    const itemId = ctx.itemId ?? ctx.phase;
    const files = out.files.map((f) => ({ path: f.path, action: "write" as const, bytes: Buffer.byteLength(f.content, "utf8") }));
    const body = [`# ${out.summary}`, "", ...out.notes.map((n) => `- ${n}`), "", ...out.files.flatMap((f) => [`## ${f.path}`, "", "```", f.content, "```", ""])].join("\n");
    const change: Artifact = { meta: { ...base(ctx, "developer", "change"), kind: "change", itemId, summary: out.summary, files }, body };
    const l = await ledgerWith(ctx, "developer", out.assumptions);
    return l ? [change, l] : [change];
  },
};

/**
 * A system's architecture grows with every stage. The developer sees its item's module in full, every
 * other module as one line, and the roles: enough to fit in without reading a long body each time.
 */
export function renderArchitectureFor(arch: ArtifactOf<"architecture">, moduleId: string | undefined): string {
  const m = arch.meta;
  if (!m.modules.length) return renderArtifact(arch);
  const mine = m.modules.find((x) => x.id === moduleId);
  const lines = [
    "### Stack",
    ...m.stack.map((s) => `- ${s.layer}: ${s.choice}`),
    "",
    "### Roles",
    ...(m.roles.length ? m.roles.map((r) => `- **${r.name}**: ${r.does}${r.can.length ? ` (can: ${r.can.join("; ")})` : ""}`) : ["- (one kind of user)"]),
    "",
    ...(mine
      ? ["### This item's module", "```json", JSON.stringify(mine, null, 2), "```", ""]
      : []),
    "### Modules",
    ...m.modules.map((x) => `- **${x.id}** ${x.name}: ${x.purpose}${x.id === mine?.id ? " (this item)" : ""}`),
    "",
    ...(m.risks.length ? ["### Risks", ...m.risks.map((r) => `- ${r}`)] : []),
  ];
  return section(`architecture ${m.id}`, lines.join("\n"));
}

export const releaser: RoleDefinition<ReleaserOutput> = {
  role: "releaser",
  schema: ReleaserOutput,
  tier: "routine",
  async inputs(ctx) {
    const arch = await latest(ctx, "architecture");
    const spec = await latest(ctx, "spec");
    const done = ctx.backlog.filter((b) => (ctx.state.items[b.id]?.status ?? b.status) === "done");
    const parked = ctx.backlog.filter((b) => ["parked", "dropped"].includes(ctx.state.items[b.id]?.status ?? b.status));
    const deploys = ctx.state.artifacts["deploy-record"] ?? [];
    const latestDeploy = deploys.length ? await ctx.store.readArtifact("deploy-record", deploys[deploys.length - 1]!) : undefined;
    return [
      spec ? renderArtifact(spec) : "",
      arch ? section("Deploy target", arch.meta.stack.map((s) => `${s.layer}: ${s.choice}`).join("\n")) : "",
      section("Done items", done.map((d) => `- ${d.id} ${d.title}`).join("\n") || "(none)"),
      section("Parked or dropped items", parked.map((d) => `- ${d.id} ${d.title}: ${ctx.state.items[d.id]?.reason ?? ""}`).join("\n") || "(none)"),
      ctx.deploy
        ? section("The deploy target already ran (describe this; do not return a deploy object)", `${renderArtifact(ctx.deploy)}\n\nWhere it will live once it passes its checks: ${ctx.deployTarget ?? "the deploy target"}.`)
        : section("Deploy adapter result", latestDeploy ? renderArtifact(latestDeploy) : "No deploy adapter has run. Nothing is deployed."),
      ...(ctx.state.stage
        ? [section("This release adds a stage", `It adds the stage "${currentStage(ctx.state, spec)?.name ?? ctx.state.stage}": ${currentStage(ctx.state, spec)?.goal ?? ""}. Say in the headline what the person can now do that they could not before.`)]
        : ctx.state.cycle > 0
          ? [section("This is a maintenance release", `Cycle ${ctx.state.cycle}: say in the headline what was fixed or changed for the person, not what the product is.`)]
          : []),
      renderFeedback(ctx),
    ].join("\n");
  },
  async write(out, ctx) {
    const artifacts: Artifact[] = [];
    let url: string | undefined;
    if (ctx.deploy) {
      url = ctx.deploy.meta.status === "deployed" ? ctx.deploy.meta.url : undefined;
    } else {
      const d = out.deploy ?? { target: "none", environment: "preview" as const, version: "0.0.0", status: "failed" as const, rollbackVerified: false, notes: "No deploy target ran, and the releaser described none." };
      url = d.url;
      artifacts.push({
        meta: { ...base(ctx, "releaser", "deploy-record"), kind: "deploy-record", target: d.target, environment: d.environment, version: d.version, status: d.status, rollbackVerified: d.rollbackVerified, ...(d.url ? { url: d.url } : {}) },
        body: d.notes,
      });
    }
    artifacts.push(summaryArtifact(out.summary, { ...base(ctx, "releaser", "summary") }, url));
    return artifacts;
  },
};

/** The person's summary. Also rewritten by the kernel with the production link after promotion. */
export function summaryArtifact(s: ReleaserOutput["summary"], baseMeta: { id: string; createdAt: string; createdBy: Role | "system"; phase?: string }, url?: string): Artifact {
  return {
    meta: { ...baseMeta, kind: "summary", headline: s.headline, whatItDoes: s.whatItDoes, howToUse: s.howToUse, whatWasParked: s.whatWasParked, ...(url ? { url } : {}) },
    body: [`# ${s.headline}`, "", s.whatItDoes, "", "## How to use it", "", s.howToUse, "", ...(url ? [`Open it: ${url}`, ""] : []), ...(s.whatWasParked.length ? ["## Left out for now", "", ...s.whatWasParked.map((p) => `- ${p}`)] : [])].join("\n") + "\n",
  };
}

export const ROLE_DEFINITIONS = {
  selector,
  "product-owner": productOwner,
  architect,
  planner,
  developer,
  releaser,
} as const;
export type ProducingRole = keyof typeof ROLE_DEFINITIONS;
export const isProducingRole = (r: Role): r is ProducingRole => r in ROLE_DEFINITIONS;
