/**
 * The demo adapter: a mock that plays every role plausibly, offline and at zero cost.
 * `karigor new "..." --adapter demo --run` exercises the whole kernel without a model.
 * Tests reuse it with `override` hooks to script failures.
 */
import type { ModelRequest } from "@karigor/runtime";
import { MockAdapter } from "@karigor/runtime";

export interface ScriptOptions {
  items?: number;
  /** Override an answer: return undefined to use the default. */
  override?: (req: ModelRequest<unknown>, attempt: number) => unknown | undefined;
  deployUrl?: string | null;
  template?: string;
}

/** First "- kind id" line from a judge prompt, as a citation. */
export function citeFirst(user: string): { ref: { kind: string; id: string }; quote: string }[] {
  const m = user.match(/^- ([a-z-]+) ([a-z0-9-]+)$/m);
  return m ? [{ ref: { kind: m[1]!, id: m[2]! }, quote: "checked" }] : [];
}

const item = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `b${i}`,
  title: `Feature ${i}`,
  description: `Implement feature ${i}`,
  acceptance: [`feature ${i} works`, `tests cover feature ${i}`],
  priority: i === 1 ? "must" : i % 2 === 0 ? "should" : "could",
  estimate: "S",
  dependsOn: [],
  featureId: "f1",
  ...extra,
});

export function answerFor(req: ModelRequest<unknown>, attempt: number, o: ScriptOptions = {}): unknown {
  const over = o.override?.(req, attempt);
  if (over !== undefined) return over;
  switch (req.role) {
    case "selector":
      return { template: o.template ?? "iterative", targetProfile: "web-app", reasons: ["several features that will evolve"], assumptions: [] };
    case "product-owner":
      return {
        title: "ToolShare",
        audience: "Neighbours on one street",
        problem: "Borrowing a tool is awkward to arrange",
        goals: ["A neighbour can list a tool in under a minute"],
        nonGoals: ["Payments"],
        features: [{ id: "f1", name: "List a tool", description: "Add a tool with a photo", priority: "must" }],
        successCriteria: ["Two neighbours complete a loan in the first week"],
        assumptions: [{ topic: "language", decision: "English only for now.", reason: "The idea was written in English." }],
        body: "# ToolShare\n\nNeighbours list and borrow tools.\n",
      };
    case "architect":
      return {
        stack: [{ layer: "web", choice: "SvelteKit on Cloudflare Pages", reason: "free tier, phone-friendly" }, { layer: "db", choice: "Neon Postgres free tier", reason: "free" }],
        components: [{ name: "listing", responsibility: "create and show tools" }],
        risks: ["photo uploads need storage"],
        assumptions: [{ topic: "hosting", decision: "Free hosting on Cloudflare.", reason: "No money is needed to start." }],
        body: "# Architecture\n",
      };
    case "planner": {
      if (req.user.includes("SHRINK this item")) {
        const id = req.user.split("SHRINK this item")[1]?.match(/"id": "([a-z0-9-]+)"/)?.[1] ?? "x";
        return { items: [item(1, { id: `${id}-a`, title: `${id} part a` }), item(1, { id: `${id}-b`, title: `${id} part b` })], notes: "dropped optional parts" };
      }
      const n = o.items ?? 3;
      return { items: Array.from({ length: n }, (_, i) => item(i + 1)), notes: "must first" };
    }
    case "developer":
      return { summary: "Implemented the item with tests.", files: [{ path: "src/a.ts", content: "export const a = 1;\n" }, { path: "src/a.test.ts", content: "test('a', () => {});\n" }], notes: [], assumptions: [] };
    case "reviewer":
    case "skeptic":
      return { verdict: "pass", citations: citeFirst(req.user), reasons: [], minor: ["checked every point"] };
    case "releaser": {
      const url = o.deployUrl === undefined ? "https://toolshare.pages.dev" : o.deployUrl;
      return {
        deploy: { target: "cloudflare-pages", environment: "preview", ...(url ? { url } : {}), version: "0.1.0", status: url ? "deployed" : "failed", rollbackVerified: !!url, notes: url ? "deployed" : "no deploy adapter ran" },
        summary: { headline: "ToolShare is live", whatItDoes: "Neighbours list and borrow tools.", howToUse: "Open the link and add a tool.", whatWasParked: [] },
      };
    }
    default:
      throw new Error(`no scripted answer for ${req.role}`);
  }
}

export function scriptedAdapter(o: ScriptOptions = {}): MockAdapter {
  return new MockAdapter((req, attempt) => answerFor(req, attempt, o));
}

export const demoAdapter = (): MockAdapter => scriptedAdapter();
