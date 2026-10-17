import { z } from "zod/v4";
import { GateNameSchema, RoleSchema } from "@karigor/store";

/** One rung of a failure ladder. The machine walks rungs by the item's or phase's fail count. */
export const FailActionSchema = z.discriminatedUnion("action", [
  /** Run the same work again, up to `times` times. */
  z.object({ action: z.literal("retry"), times: z.number().int().positive() }),
  /** Go back to an earlier phase, up to `times` times. */
  z.object({ action: z.literal("sendBack"), phase: z.string().min(1), times: z.number().int().positive() }),
  /** Re-plan the failing item into smaller items or drop its optional parts. Items only. */
  z.object({ action: z.literal("shrink"), times: z.number().int().positive() }),
  /** Remove the item from the active backlog with a plain-language reason. Items only. Terminal rung. */
  z.object({ action: z.literal("park") }),
  /** Stop the project with a plain-language reason. Phases only. Terminal rung. */
  z.object({ action: z.literal("stop") }),
]);
export type FailAction = z.infer<typeof FailActionSchema>;

const ladder = z.array(FailActionSchema).min(1);

export const TransitionSchema = z.object({
  to: z.string().min(1),
  gates: z.array(GateNameSchema).default([]),
  /** Walked by the phase's fail count. The last rung must be terminal (`stop` or `sendBack`). */
  onFail: ladder.default([{ action: "retry", times: 1 }, { action: "stop" }]),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const LoopSchema = z.object({
  /** Roles run once per backlog item, in order. */
  itemRoles: z.array(RoleSchema).min(1),
  /** Gates evaluated after each item's roles. */
  itemGates: z.array(GateNameSchema).default([]),
  /** Walked by the item's fail count. The last rung must be `park`. */
  onItemFail: ladder.default([{ action: "retry", times: 2 }, { action: "shrink", times: 1 }, { action: "park" }]),
  /** 0 means all ready items in one sprint. */
  itemsPerSprint: z.number().int().nonnegative().default(3),
});
export type Loop = z.infer<typeof LoopSchema>;

export const PhaseSchema = z.object({
  description: z.string().default(""),
  /** Roles run once on entering the phase (or once per sprint when `loop` is set), in order. */
  roles: z.array(RoleSchema).default([]),
  loop: LoopSchema.optional(),
  transitions: z.array(TransitionSchema).default([]),
  /** Relative share of the project budget. */
  budgetWeight: z.number().nonnegative().default(1),
  terminal: z.boolean().default(false),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const TemplateSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1),
  /** Plain-language criteria the selector agent uses. */
  fitsWhen: z.string().min(1),
  initialPhase: z.string().min(1),
  phases: z.record(z.string().min(1), PhaseSchema),
  limits: z
    .object({
      /** Total non-ok outcomes (worker or gate) before the project stops. */
      projectFailures: z.number().int().positive().default(25),
    })
    .prefault({}),
});
export type Template = z.infer<typeof TemplateSchema>;
