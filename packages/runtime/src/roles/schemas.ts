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

export const ProductOwnerOutput = z.object({
  title: z.string().min(1),
  audience: z.string().min(1),
  problem: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  nonGoals: z.array(z.string()),
  features: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().min(1), priority: PrioritySchema })).min(1),
  successCriteria: z.array(z.string().min(1)).min(1),
  assumptions: z.array(AssumptionInput),
  body: z.string().min(1),
});

export const ArchitectOutput = z.object({
  stack: z.array(z.object({ layer: z.string().min(1), choice: z.string().min(1), reason: z.string().min(1) })).min(1),
  components: z.array(z.object({ name: z.string().min(1), responsibility: z.string().min(1) })).min(1),
  risks: z.array(z.string()),
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
