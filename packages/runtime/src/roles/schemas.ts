import { z } from "zod/v4";
import { PrioritySchema, TargetProfileSchema } from "@karigor/store";

export const AssumptionInput = z.object({
  topic: z.string().min(1),
  decision: z.string().min(1),
  reason: z.string().min(1),
});

export const SelectorOutput = z.object({
  template: z.string().min(1),
  targetProfile: TargetProfileSchema,
  reasons: z.array(z.string().min(1)).min(1),
  assumptions: z.array(AssumptionInput),
});

export const StageInput = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  goal: z.string().min(1),
  featureIds: z.array(z.string().min(1)).min(1),
});

export const ProductOwnerOutput = z
  .object({
    title: z.string().min(1),
    audience: z.string().min(1),
    problem: z.string().min(1),
    goals: z.array(z.string().min(1)).min(1),
    nonGoals: z.array(z.string()),
    features: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().min(1), priority: PrioritySchema })).min(1),
    successCriteria: z.array(z.string().min(1)).min(1),
    stages: z.array(StageInput).min(1),
    assumptions: z.array(AssumptionInput),
    body: z.string().min(1),
  })
  .superRefine((o, ctx) => {
    // Every must and should feature is built in exactly one stage; stages name only real features.
    const ids = new Set(o.features.map((f) => f.id));
    const seen = new Map<string, string>();
    const stageIds = new Set<string>();
    for (const s of o.stages) {
      if (stageIds.has(s.id)) ctx.addIssue({ code: "custom", message: `stage id "${s.id}" is used twice`, path: ["stages"] });
      stageIds.add(s.id);
      for (const f of s.featureIds) {
        if (!ids.has(f)) ctx.addIssue({ code: "custom", message: `stage "${s.id}" names feature "${f}", which is not in features`, path: ["stages"] });
        else if (seen.has(f)) ctx.addIssue({ code: "custom", message: `feature "${f}" is in both stage "${seen.get(f)}" and stage "${s.id}"; put it in one`, path: ["stages"] });
        seen.set(f, s.id);
      }
    }
    for (const f of o.features) {
      if (f.priority !== "could" && !seen.has(f.id)) ctx.addIssue({ code: "custom", message: `${f.priority} feature "${f.id}" is in no stage; every must and should feature belongs to one stage`, path: ["stages"] });
    }
  });

export const ArchitectOutput = z.object({
  stack: z.array(z.object({ layer: z.string().min(1), choice: z.string().min(1), reason: z.string().min(1) })).min(1),
  components: z.array(z.object({ name: z.string().min(1), responsibility: z.string().min(1) })).min(1),
  risks: z.array(z.string()),
  /** Kinds of people who use the system; `can` lists permissions in the app's own words (e.g. "take payments"). */
  roles: z.array(z.object({ name: z.string().min(1), does: z.string().min(1), can: z.array(z.string().min(1)) })),
  /** The system's parts; each with the roles that use it, the data it keeps, its pages, and the stage that adds it. */
  modules: z.array(
    z.object({
      id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
      name: z.string().min(1),
      purpose: z.string().min(1),
      roles: z.array(z.string()),
      data: z.array(z.string()),
      pages: z.array(z.string()),
      stage: z.string().optional(),
    }),
  ),
  assumptions: z.array(AssumptionInput),
  body: z.string().min(1),
});

export const PlannerItem = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  acceptance: z.array(z.string().min(1)).min(1),
  priority: PrioritySchema,
  estimate: z.enum(["S", "M", "L"]),
  dependsOn: z.array(z.string()),
  featureId: z.string().optional(),
  /** The architecture module the item belongs to. */
  moduleId: z.string().optional(),
});
export const PlannerOutput = z.object({
  items: z.array(PlannerItem).min(1),
  notes: z.string(),
});

export const DeveloperOutput = z.object({
  summary: z.string().min(1),
  files: z.array(z.object({ path: z.string().min(1), content: z.string() })).min(1),
  notes: z.array(z.string()),
  assumptions: z.array(AssumptionInput),
});

export const ReleaserOutput = z.object({
  /** Omitted when a deploy target really ran; the kernel already recorded what happened. */
  deploy: z.object({
    target: z.string().min(1),
    environment: z.enum(["preview", "production"]),
    url: z.string().optional(),
    version: z.string().min(1),
    status: z.enum(["deployed", "failed"]),
    rollbackVerified: z.boolean(),
    notes: z.string(),
  }).optional(),
  summary: z.object({
    headline: z.string().min(1),
    whatItDoes: z.string().min(1),
    howToUse: z.string().min(1),
    whatWasParked: z.array(z.string()),
  }),
});

export type SelectorOutput = z.infer<typeof SelectorOutput>;
export type ProductOwnerOutput = z.infer<typeof ProductOwnerOutput>;
export type ArchitectOutput = z.infer<typeof ArchitectOutput>;
export type PlannerOutput = z.infer<typeof PlannerOutput>;
export type DeveloperOutput = z.infer<typeof DeveloperOutput>;
export type ReleaserOutput = z.infer<typeof ReleaserOutput>;
