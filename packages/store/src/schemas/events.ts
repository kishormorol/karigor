import { z } from "zod";
import {
  ArtifactKindSchema,
  AuthorSchema,
  BudgetTierSchema,
  Id,
  IsoDate,
  ItemStatusSchema,
  ModelTierSchema,
  RoleSchema,
} from "./common.js";

const ev = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({
    /** Monotonic within a project, assigned by the store on append. */
    seq: z.number().int().nonnegative(),
    at: IsoDate,
    type: z.literal(type),
    by: AuthorSchema.default("system"),
    ...shape,
  });

export const EventSchema = z.discriminatedUnion("type", [
  ev("project-created", { projectId: Id, ideaId: Id }),
  ev("template-selected", { template: z.string().min(1), targetProfile: z.string().min(1) }),
  ev("budget-chosen", { tier: BudgetTierSchema, ledgerId: Id }),
  ev("phase-entered", { phase: z.string().min(1), sprint: z.number().int().positive().optional() }),
  ev("worker-started", {
    role: RoleSchema,
    key: z.string().min(1),
    attempt: z.number().int().positive(),
    tier: ModelTierSchema,
    itemId: z.string().optional(),
  }),
  ev("worker-finished", {
    role: RoleSchema,
    key: z.string().min(1),
    attempt: z.number().int().positive(),
    outcome: z.enum(["ok", "invalid", "failed", "over-budget"]),
    artifactIds: z.array(Id).default([]),
    error: z.string().optional(),
    itemId: z.string().optional(),
  }),
  ev("artifact-written", { kind: ArtifactKindSchema, id: Id }),
  ev("gate-evaluated", {
    gate: z.string().min(1),
    verdict: z.enum(["pass", "fail"]),
    resultId: Id,
    itemId: z.string().optional(),
  }),
  ev("transition", { from: z.string().min(1), to: z.string().min(1) }),
  ev("item-status", { itemId: z.string().min(1), status: ItemStatusSchema, reason: z.string().optional() }),
  ev("budget-downgraded", { phase: z.string().min(1), from: ModelTierSchema, to: ModelTierSchema }),
  ev("project-stopped", { reason: z.string().min(1) }),
  ev("project-finished", {}),
]);
export type Event = z.infer<typeof EventSchema>;
export type EventType = Event["type"];
export type EventOf<T extends EventType> = Extract<Event, { type: T }>;
/** What callers pass to `appendEvent`; the store fills `seq` and `at`. */
export type NewEvent = Event extends infer E
  ? E extends { seq: number; at: string }
    ? Omit<E, "seq" | "at"> & { at?: string }
    : never
  : never;
