import { z } from "zod";

export const ARTIFACT_KINDS = [
  "idea",
  "spec",
  "ledger",
  "architecture",
  "backlog",
  "sprint",
  "test-report",
  "gate-result",
  "deploy-record",
  "cost-ledger",
  "summary",
  "work-item",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);

export const ROLES = [
  "selector",
  "estimator",
  "product-owner",
  "architect",
  "planner",
  "developer",
  "reviewer",
  "skeptic",
  "releaser",
] as const;
export type Role = (typeof ROLES)[number];
export const RoleSchema = z.enum(ROLES);

/** Who produced an artifact or event: a role, or the kernel itself. */
export const AuthorSchema = z.union([RoleSchema, z.literal("system"), z.literal("user")]);
export type Author = z.infer<typeof AuthorSchema>;

export const BUDGET_TIERS = ["free", "cheap", "best"] as const;
export const BudgetTierSchema = z.enum(BUDGET_TIERS);
export type BudgetTier = z.infer<typeof BudgetTierSchema>;

export const MODEL_TIERS = ["judgment", "routine", "mock"] as const;
export const ModelTierSchema = z.enum(MODEL_TIERS);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const PRIORITIES = ["must", "should", "could"] as const;
export const PrioritySchema = z.enum(PRIORITIES);

export const ITEM_STATUSES = ["todo", "in-progress", "done", "parked", "dropped"] as const;
export const ItemStatusSchema = z.enum(ITEM_STATUSES);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const IsoDate = z.string().datetime({ offset: true });
export const Id = z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase, digits and dashes");

/** Fields every artifact carries in its frontmatter. */
export const BaseMetaSchema = z.object({
  id: Id,
  kind: ArtifactKindSchema,
  createdAt: IsoDate,
  createdBy: AuthorSchema,
  /** Phase the artifact was produced in, when applicable. */
  phase: z.string().optional(),
  /** Worker attempt that produced it, when applicable. */
  attempt: z.number().int().nonnegative().optional(),
});
export type BaseMeta = z.infer<typeof BaseMetaSchema>;

/** A reference to another artifact, optionally to a location inside it. */
export const ArtifactRefSchema = z.object({
  kind: ArtifactKindSchema,
  id: Id,
  /** Free-form locator: a heading, a line range ("L12-L18"), an item id. */
  locator: z.string().optional(),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
