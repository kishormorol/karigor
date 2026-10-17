import { z } from "zod/v4";
import { CitationSchema, type Artifact, type GateName, type Role } from "@karigor/store";

/** What a judged gate's worker must return. The engine turns "no citations" into a fail. */
export const JudgedVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  /** Specific places in the inputs that support the verdict. Required for either verdict. */
  citations: z.array(CitationSchema),
  /** Plain-language reasons or objections. */
  reasons: z.array(z.string().min(1)),
});
export type JudgedVerdict = z.infer<typeof JudgedVerdictSchema>;

export interface JudgeRequest {
  gate: GateName;
  role: Role;
  /** Markdown rubric text. */
  rubric: string;
  /** Artifacts the judge may cite. */
  inputs: Artifact[];
  /** Extra text inputs (a diff, a test log) keyed by a short name. */
  extras: Record<string, string>;
  /** Scope key, for idempotency and cost attribution. */
  key: string;
  phase: string;
  itemId?: string;
}

/** Provided by the runtime: runs the role's prompt with the rubric and returns a validated verdict. */
export type Judge = (req: JudgeRequest) => Promise<JudgedVerdict>;

/** A judge that returns scripted verdicts; for tests. */
export function scriptedJudge(script: (req: JudgeRequest) => Partial<JudgedVerdict> | "pass" | "fail"): Judge {
  return async (req) => {
    const r = script(req);
    const cite = req.inputs[0]
      ? [{ ref: { kind: req.inputs[0].meta.kind, id: req.inputs[0].meta.id }, quote: req.inputs[0].body.slice(0, 40) || req.inputs[0].meta.id }]
      : [];
    if (r === "pass") return { verdict: "pass", citations: cite, reasons: ["scripted pass"] };
    if (r === "fail") return { verdict: "fail", citations: cite, reasons: ["scripted fail"] };
    return { verdict: r.verdict ?? "pass", citations: r.citations ?? cite, reasons: r.reasons ?? [] };
  };
}
