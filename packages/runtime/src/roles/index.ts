import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod/v4";
import type { Artifact, ArtifactKind, ArtifactOf, BacklogItem, MetaOf, ProjectState, Role } from "@karigor/store";
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
    const profiles = Object.entries(TARGET_PROFILES).map(([k, v]) => `- **${k}**: ${v}`).join("\n");
    return [section("Idea", idea?.meta.text ?? "(missing)"), section("Templates", templates), section("Target profiles", profiles)].join("\n");
  },
  async write(out, ctx) {
    const l = await ledgerWith(ctx, "selector", [
      { topic: "process", decision: `Work will follow the "${out.template}" process.`, reason: out.reasons.join(" ") },
      { topic: "kind of software", decision: `This will be built as: ${TARGET_PROFILES[out.targetProfile]}`, reason: out.reasons.join(" ") },
      ...out.assumptions,
    ]);
    return l ? [l] : [];
  },
};

export const productOwner: RoleDefinition<ProductOwnerOutput> = {
  role: "product-owner",
  schema: ProductOwnerOutput,
  tier: "judgment",
  async inputs(ctx) {
    const idea = await latest(ctx, "idea");
    const ledger = await latest(ctx, "ledger");
    return [section("Idea", idea?.meta.text ?? "(missing)"), ledger ? renderArtifact(ledger) : "", renderFeedback(ctx)].join("\n");
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
    const profile = ctx.state.targetProfile ?? "web-app";
    return [
      section("Target profile", `${profile}: ${TARGET_PROFILES[profile as keyof typeof TARGET_PROFILES] ?? ""}`),
      ctx.stackGuide ? section("The build crew's stack (design within it)", ctx.stackGuide) : "",
      spec ? renderArtifact(spec) : "",
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
    const parts = [spec ? renderArtifact(spec) : "", arch ? renderArtifact(arch) : "", ctx.stackGuide ? section("The build crew's stack (items must fit it)", ctx.stackGuide) : ""];
    if (ctx.purpose === "shrink" && ctx.itemId) {
      const item = ctx.backlog.find((b) => b.id === ctx.itemId);
      parts.push(section("SHRINK this item", "```json\n" + JSON.stringify(item, null, 2) + "\n```\nIt failed repeatedly. Replace it with smaller items. Use ids prefixed with its id."));
      parts.push(section("Existing item ids (do not reuse)", ctx.backlog.map((b) => b.id).join(", ")));
    } else if (ctx.backlog.length) {
      parts.push(section("Existing backlog", "```json\n" + JSON.stringify(ctx.backlog, null, 2) + "\n```"));
    }
    const work = ctx.state.artifacts["work-item"] ?? [];
    if (work.length) {
      const items = await Promise.all(work.map((id) => ctx.store.readArtifact("work-item", id)));
      parts.push(section("Open work items (maintenance)", items.filter((w) => w.meta.status !== "done").map(renderArtifact).join("\n")));
    }
    parts.push(renderFeedback(ctx));
    return parts.join("\n");
  },
  async write(out, ctx) {
    const items: BacklogItem[] = out.items.map((i) => ({ ...i, status: "todo" as const, ...(i.featureId !== undefined ? { featureId: i.featureId } : {}) }));
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
      all = items;
    }
    const body = ["# Backlog", "", ...all.map((i) => `- [${i.status}] **${i.id}** ${i.title} (${i.priority}, ${i.estimate})${i.dependsOn.length ? ` after ${i.dependsOn.join(", ")}` : ""}`), "", out.notes].join("\n") + "\n";
    return [{ meta: { ...base(ctx, "planner", "backlog"), kind: "backlog", items: all }, body }];
  },
};

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
      arch ? renderArtifact(arch) : "",
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
      section("Deploy adapter result", latestDeploy ? renderArtifact(latestDeploy) : "No deploy adapter has run. Nothing is deployed."),
      renderFeedback(ctx),
    ].join("\n");
  },
  async write(out, ctx) {
    const d = out.deploy;
    const deploy: Artifact = {
      meta: { ...base(ctx, "releaser", "deploy-record"), kind: "deploy-record", target: d.target, environment: d.environment, version: d.version, status: d.status, rollbackVerified: d.rollbackVerified, ...(d.url ? { url: d.url } : {}) },
      body: d.notes,
    };
    const s = out.summary;
    const summary: Artifact = {
      meta: { ...base(ctx, "releaser", "summary"), kind: "summary", headline: s.headline, whatItDoes: s.whatItDoes, howToUse: s.howToUse, whatWasParked: s.whatWasParked, ...(d.url ? { url: d.url } : {}) },
      body: [`# ${s.headline}`, "", s.whatItDoes, "", "## How to use it", "", s.howToUse, "", ...(s.whatWasParked.length ? ["## Left out for now", "", ...s.whatWasParked.map((p) => `- ${p}`)] : [])].join("\n") + "\n",
    };
    return [deploy, summary];
  },
};

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
