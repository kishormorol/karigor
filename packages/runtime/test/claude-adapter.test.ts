import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { ClaudeAdapter, CLAUDE_DEFAULTS } from "../src/index.js";

describe("ClaudeAdapter (offline)", () => {
  it("maps tiers to the configured models", () => {
    const a = new ClaudeAdapter({ client: {} as never });
    expect(a.modelFor("judgment")).toBe(CLAUDE_DEFAULTS.judgmentModel);
    expect(a.modelFor("routine")).toBe(CLAUDE_DEFAULTS.routineModel);
    expect(a.modelFor("mock")).toBe(CLAUDE_DEFAULTS.judgmentModel);
    const b = new ClaudeAdapter({ client: {} as never, judgmentModel: "claude-fable-5-1" });
    expect(b.modelFor("judgment")).toBe("claude-fable-5-1");
  });
});

/** Costs real money. Run with KARIGOR_REAL_MODEL=1 and a configured Anthropic credential. */
describe.runIf(process.env["KARIGOR_REAL_MODEL"] === "1")("ClaudeAdapter (live contract)", () => {
  it("returns schema-valid structured output with usage", async () => {
    const a = new ClaudeAdapter();
    const r = await a.complete({
      tier: "routine",
      system: "You turn a one-line idea into a title and three goals. Answer in the requested JSON only.",
      user: "Idea: a site where neighbours lend tools to each other.",
      schema: z.object({ title: z.string().min(1), goals: z.array(z.string().min(1)).length(3) }),
      key: "contract-test",
      role: "product-owner",
      maxTokens: 2000,
    });
    expect(r.ok, r.ok ? "" : r.message).toBe(true);
    if (r.ok) {
      expect(r.output.goals).toHaveLength(3);
      expect(r.usage.inputTokens).toBeGreaterThan(0);
      expect(r.model).toContain("claude");
    }
  }, 120_000);
});
