import { z } from "zod/v4";
import {
  ArtifactRefSchema,
  BaseMetaSchema,
  BudgetTierSchema,
  ItemStatusSchema,
  ModelTierSchema,
  PrioritySchema,
  RoleSchema,
} from "./common.js";

const meta = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  BaseMetaSchema.extend({ kind: z.literal(kind) }).extend(shape);

// ---- idea --------------------------------------------------------------
export const IdeaMeta = meta("idea", {
  text: z.string().min(1),
  locale: z.string().default("en"),
});

// ---- spec --------------------------------------------------------------
export const FeatureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  priority: PrioritySchema,
});
export const SpecMeta = meta("spec", {
  title: z.string().min(1),
  audience: z.string().min(1),
  problem: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  nonGoals: z.array(z.string()).default([]),
  features: z.array(FeatureSchema).min(1),
  successCriteria: z.array(z.string().min(1)).min(1),
});

// ---- assumption ledger --------------------------------------------------
export const AssumptionSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  /** Plain language, no jargon: what was decided. */
  decision: z.string().min(1),
  reason: z.string().min(1),
  madeBy: RoleSchema,
  phase: z.string().min(1),
  /** Set when the user overrides it. */
  correctedTo: z.string().optional(),
});
export const LedgerMeta = meta("ledger", {
  assumptions: z.array(AssumptionSchema).default([]),
});

// ---- architecture -------------------------------------------------------
export const ArchitectureMeta = meta("architecture", {
  targetProfile: z.string().min(1),
  stack: z.array(z.object({ layer: z.string(), choice: z.string(), reason: z.string() })).min(1),
  components: z.array(z.object({ name: z.string(), responsibility: z.string() })).min(1),
  risks: z.array(z.string()).default([]),
});

// ---- backlog ------------------------------------------------------------
export const BacklogItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  acceptance: z.array(z.string().min(1)).min(1),
  priority: PrioritySchema,
  estimate: z.enum(["S", "M", "L"]),
  status: ItemStatusSchema.default("todo"),
  dependsOn: z.array(z.string()).default([]),
  featureId: z.string().optional(),
});
export type BacklogItem = z.infer<typeof BacklogItemSchema>;
export const BacklogMeta = meta("backlog", {
  items: z.array(BacklogItemSchema).min(1),
});

// ---- sprint -------------------------------------------------------------
export const SprintMeta = meta("sprint", {
  number: z.number().int().positive(),
  itemIds: z.array(z.string()).min(1),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).optional(),
  outcome: z.enum(["completed", "partial", "abandoned"]).optional(),
});

// ---- test report --------------------------------------------------------
export const TestReportMeta = meta("test-report", {
  itemId: z.string().optional(),
  suite: z.string().min(1),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative().default(0),
  durationMs: z.number().nonnegative(),
});

// ---- gate result --------------------------------------------------------
export const CitationSchema = z.object({
  ref: ArtifactRefSchema,
  quote: z.string().min(1),
});
export const GateEvidenceSchema = z.union([
  z.object({ type: z.literal("artifact"), ref: ArtifactRefSchema }),
  z.object({ type: z.literal("text"), text: z.string().min(1) }),
]);
export const GateResultMeta = meta("gate-result", {
  gate: z.string().min(1),
  gateKind: z.enum(["mechanical", "judged"]),
  verdict: z.enum(["pass", "fail"]),
  /** A gate cannot pass without evidence. Enforced in the gate engine, declared here. */
  evidence: z.array(GateEvidenceSchema).min(1),
  /** Judged gates must cite. */
  citations: z.array(CitationSchema).default([]),
  /** Objections or reasons, plain language. */
  reasons: z.array(z.string()).default([]),
  transitionTo: z.string().optional(),
  itemId: z.string().optional(),
});

// ---- deploy record ------------------------------------------------------
export const DeployRecordMeta = meta("deploy-record", {
  target: z.string().min(1),
  environment: z.enum(["preview", "production"]),
  url: z.string().url().optional(),
  version: z.string().min(1),
  status: z.enum(["deployed", "failed", "rolled-back"]),
  rollbackVerified: z.boolean(),
});

// ---- cost ledger --------------------------------------------------------
export const CostEntrySchema = z.object({
  at: z.string().datetime({ offset: true }),
  role: RoleSchema,
  tier: ModelTierSchema,
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  /** In `currency` units. */
  cost: z.number().nonnegative(),
  idempotencyKey: z.string().min(1),
  phase: z.string().min(1),
});
export type CostEntry = z.infer<typeof CostEntrySchema>;
export const CostLedgerMeta = meta("cost-ledger", {
  currency: z.string().length(3).default("USD"),
  tier: BudgetTierSchema,
  budgetTotal: z.number().nonnegative(),
  phaseBudgets: z.record(z.string(), z.number().nonnegative()),
  entries: z.array(CostEntrySchema).default([]),
});

// ---- summary ------------------------------------------------------------
export const SummaryMeta = meta("summary", {
  headline: z.string().min(1),
  whatItDoes: z.string().min(1),
  howToUse: z.string().min(1),
  whatWasParked: z.array(z.string()).default([]),
  url: z.string().url().optional(),
});

// ---- work item (maintenance) -------------------------------------------
export const WorkItemMeta = meta("work-item", {
  source: z.enum(["error", "downtime", "dependency", "feedback", "manual"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().min(1),
  status: ItemStatusSchema.default("todo"),
});

// ---- union --------------------------------------------------------------
export const ArtifactMetaSchema = z.discriminatedUnion("kind", [
  IdeaMeta,
  SpecMeta,
  LedgerMeta,
  ArchitectureMeta,
  BacklogMeta,
  SprintMeta,
  TestReportMeta,
  GateResultMeta,
  DeployRecordMeta,
  CostLedgerMeta,
  SummaryMeta,
  WorkItemMeta,
]);
export type ArtifactMeta = z.infer<typeof ArtifactMetaSchema>;
export type MetaOf<K extends ArtifactMeta["kind"]> = Extract<ArtifactMeta, { kind: K }>;

/** An artifact is typed frontmatter plus a Markdown body. */
export const ArtifactSchema = z.object({
  meta: ArtifactMetaSchema,
  body: z.string(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactOf<K extends ArtifactMeta["kind"]> = { meta: MetaOf<K>; body: string };

export const META_BY_KIND = {
  idea: IdeaMeta,
  spec: SpecMeta,
  ledger: LedgerMeta,
  architecture: ArchitectureMeta,
  backlog: BacklogMeta,
  sprint: SprintMeta,
  "test-report": TestReportMeta,
  "gate-result": GateResultMeta,
  "deploy-record": DeployRecordMeta,
  "cost-ledger": CostLedgerMeta,
  summary: SummaryMeta,
  "work-item": WorkItemMeta,
} as const;
