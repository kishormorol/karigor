import { z } from "zod/v4";
import {
  ArtifactKindSchema,
  ArtifactRefSchema,
  AuthorSchema,
  BudgetTierSchema,
  Id,
  IsoDate,
  ItemStatusSchema,
  ModelTierSchema,
  RoleSchema,
} from "./common.js";
import { SeveritySchema, WorkItemSourceSchema } from "./artifacts.js";

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
  ev("phase-entered", {
    phase: z.string().min(1),
    sprint: z.number().int().positive().optional(),
    /** Items chosen for this sprint, in order. Loop phases only. */
    itemIds: z.array(z.string()).optional(),
  }),
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
    /** Everything the worker produced. Registered atomically with this event on replay. */
    artifacts: z.array(ArtifactRefSchema).default([]),
    error: z.string().optional(),
    itemId: z.string().optional(),
  }),
  ev("artifact-written", { kind: ArtifactKindSchema, id: Id }),
  ev("gate-evaluated", {
    gate: z.string().min(1),
    /** Scope key from the machine; unique per phase entry, item and round. */
    key: z.string().min(1),
    verdict: z.enum(["pass", "fail"]),
    resultId: Id,
    /** Extra artifacts the gate wrote (a test report). The gate-result itself is `resultId`. */
    artifacts: z.array(ArtifactRefSchema).default([]),
    itemId: z.string().optional(),
  }),
  ev("transition", { from: z.string().min(1), to: z.string().min(1) }),
  ev("item-status", { itemId: z.string().min(1), status: ItemStatusSchema, reason: z.string().optional() }),
  ev("budget-downgraded", { phase: z.string().min(1), from: ModelTierSchema, to: ModelTierSchema }),
  ev("project-stopped", { reason: z.string().min(1) }),
  /** A production signal or the person's feedback became an open work item. */
  ev("signal-received", {
    workItemId: Id,
    source: WorkItemSourceSchema,
    severity: SeveritySchema,
    fingerprint: z.string().min(1),
  }),
  /** A released project re-enters the kernel to fix open work items. */
  ev("maintenance-started", {
    cycle: z.number().int().positive(),
    template: z.string().min(1),
    workItemIds: z.array(Id).min(1),
  }),
  /** The release cannot go on without something only the person can give (a passcode, a service account). */
  ev("project-waiting", { needs: z.array(z.string().min(1)).min(1) }),
  /** What the project was waiting for has been given. */
  ev("project-resumed", {}),
  /** Settings the live app reads were stored where it reads them. Names only; values never enter the log. */
  ev("settings-provided", { names: z.array(z.string().min(1)).min(1) }),
  /** The person corrected a decision made on their behalf. */
  ev("assumption-corrected", { assumptionId: z.string().min(1), correctedTo: z.string().min(1), ledgerId: Id }),
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
