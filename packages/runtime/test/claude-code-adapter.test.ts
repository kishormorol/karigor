import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { ClaudeCodeAdapter, type Exec } from "../src/index.js";

const Out = z.object({ title: z.string(), goals: z.array(z.string()) });
const req = { tier: "routine" as const, system: "sys", user: "idea", schema: Out, key: "k", role: "product-owner" as const };

const cli = (body: Record<string, unknown>): Exec => async () => ({ stdout: JSON.stringify({ type: "result", ...body }), stderr: "", code: 0 });

describe("ClaudeCodeAdapter (offline, scripted CLI)", () => {
  it("passes the schema, model, effort and system prompt, feeds the user prompt on stdin, and strips nesting markers", async () => {
    let seen: { args: string[]; input: string; env: NodeJS.ProcessEnv } | undefined;
    const exec: Exec = async (_file, args, input, { env }) => {
      seen = { args, input, env };
      return { stdout: JSON.stringify({ is_error: false, structured_output: { title: "T", goals: ["a"] }, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, modelUsage: { "claude-haiku-5-5": {} }, total_cost_usd: 0.002 }), stderr: "", code: 0 };
    };
    process.env["CLAUDECODE"] = "1";
    const a = new ClaudeCodeAdapter({ exec });
    const r = await a.complete(req);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toEqual({ title: "T", goals: ["a"] });
      expect(r.model).toBe("claude-code/claude-haiku-5-5");
      expect(r.usage).toEqual({ inputTokens: 110, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0 });
      expect(r.costUsd).toBe(0.002);
    }
    expect(seen!.input).toBe("idea");
    expect(seen!.args).toContain("--json-schema");
    expect(seen!.args[seen!.args.indexOf("--model") + 1]).toBe("haiku");
    expect(seen!.args[seen!.args.indexOf("--effort") + 1]).toBe("low");
    expect(seen!.args[seen!.args.indexOf("--system-prompt") + 1]).toBe("sys");
    expect(seen!.args).not.toContain("--bare");
    expect(seen!.env["CLAUDECODE"]).toBeUndefined();
    const schema = JSON.parse(seen!.args[seen!.args.indexOf("--json-schema") + 1]!);
    expect(schema.required).toEqual(["title", "goals"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$schema).toBeUndefined(); // the CLI rejects the draft marker
  });

  it("maps tiers to claude-code/ model ids, which the budget treats as flat-rate", () => {
    const a = new ClaudeCodeAdapter({ exec: cli({}) });
    expect(a.modelFor("judgment")).toBe("claude-code/opus");
    expect(a.modelFor("routine")).toBe("claude-code/haiku");
    expect(new ClaudeCodeAdapter({ exec: cli({}), judgmentModel: "fable" }).modelFor("judgment")).toBe("claude-code/fable");
  });

  it("explains a missing login without retrying, and marks limits as retryable", async () => {
    const r1 = await new ClaudeCodeAdapter({ exec: cli({ is_error: true, result: "Not logged in · Please run /login" }) }).complete(req);
    expect(r1.ok === false && r1.error).toBe("api");
    expect(r1.ok === false && r1.retryable).toBe(false);
    expect(r1.ok === false && r1.message).toMatch(/not logged in/i);
    const r2 = await new ClaudeCodeAdapter({ exec: cli({ is_error: true, result: "You've hit your usage limit, try again at 9pm" }) }).complete(req);
    expect(r2.ok === false && r2.retryable).toBe(true);
  });

  it("treats a schema miss or missing structured output as invalid with the raw text", async () => {
    const r1 = await new ClaudeCodeAdapter({ exec: cli({ structured_output: { title: 3 } }) }).complete(req);
    expect(r1.ok === false && r1.error).toBe("invalid");
    expect(r1.ok === false && r1.raw).toBe('{"title":3}');
    const r2 = await new ClaudeCodeAdapter({ exec: cli({ result: "plain prose" }) }).complete(req);
    expect(r2.ok === false && r2.error).toBe("invalid");
    expect(r2.ok === false && r2.raw).toBe("plain prose");
  });

  it("treats a timeout (no output, killed) as retryable", async () => {
    const exec: Exec = async () => ({ stdout: "", stderr: "timed out after 40 minutes", code: null });
    const r = await new ClaudeCodeAdapter({ exec }).complete(req);
    expect(r.ok === false && r.error).toBe("api");
    expect(r.ok === false && r.retryable).toBe(true);
    expect(r.ok === false && r.message).toMatch(/timed out after 40 minutes/);
  });

  it("reports a non-JSON crash as an api error", async () => {
    const exec: Exec = async () => ({ stdout: "", stderr: "command not found", code: 127 });
    const r = await new ClaudeCodeAdapter({ exec }).complete(req);
    expect(r.ok === false && r.error).toBe("api");
    expect(r.ok === false && r.message).toMatch(/command not found/);
  });
});

/** Uses your Claude Code login. Run with KARIGOR_REAL_MODEL=1. One small Haiku call. */
describe.runIf(process.env["KARIGOR_REAL_MODEL"] === "1")("ClaudeCodeAdapter (live)", () => {
  it("returns schema-valid structured output through the claude CLI", async () => {
    const a = new ClaudeCodeAdapter();
    const r = await a.complete({
      tier: "routine",
      system: "You turn a one-line idea into a title and exactly three goals. Answer only in the requested JSON.",
      user: "Idea: a site where neighbours lend tools to each other.",
      schema: z.object({ title: z.string().min(1), goals: z.array(z.string().min(1)).length(3) }),
      key: "live",
      role: "product-owner",
    });
    expect(r.ok, r.ok ? "" : r.message).toBe(true);
    if (r.ok) {
      expect(r.output.goals).toHaveLength(3);
      expect(r.model).toMatch(/^claude-code\/claude-haiku/);
      expect(r.usage.outputTokens).toBeGreaterThan(0);
    }
  }, 180_000);
});
