import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture } from "@karigor/profiles";
import { Workspace } from "@karigor/sandbox";
import { ClaudeCodeAgent, DENIED_COMMANDS, type Exec } from "../src/index.js";

const req = { tier: "routine" as const, system: "sys", user: "do the thing", cwd: "/tmp/ws", key: "k", role: "developer" as const };

describe("ClaudeCodeAgent (offline)", () => {
  it("runs claude headless in the workspace with tools, acceptEdits, the deny list and a turn cap", async () => {
    let seen: { args: string[]; input: string; cwd?: string; env: NodeJS.ProcessEnv } | undefined;
    const exec: Exec = async (_f, args, input, { cwd, env }) => {
      seen = { args, input, env, ...(cwd !== undefined ? { cwd } : {}) };
      return { stdout: JSON.stringify({ is_error: false, result: "Added greet.\nIt has a test.", usage: { input_tokens: 5, output_tokens: 9 }, modelUsage: { "claude-sonnet-5-5": {} }, total_cost_usd: 0.03, num_turns: 7, permission_denials: [{ tool_name: "Bash", tool_input: { command: "curl x" } }] }), stderr: "", code: 0 };
    };
    const a = new ClaudeCodeAgent({ exec });
    const r = await a.act(req);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary).toMatch(/Added greet/);
      expect(r.summary).toMatch(/blocked commands: curl x/);
      expect(r.model).toBe("claude-code/claude-sonnet-5-5");
      expect(r.turns).toBe(7);
      expect(r.costUsd).toBe(0.03);
    }
    expect(seen!.cwd).toBe("/tmp/ws");
    expect(seen!.input).toBe("do the thing");
    const a2 = seen!.args;
    expect(a2[a2.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(a2[a2.indexOf("--tools") + 1]).toBe("Read,Edit,Write,Bash,Glob,Grep");
    expect(a2[a2.indexOf("--model") + 1]).toBe("sonnet");
    expect(a2[a2.indexOf("--max-turns") + 1]).toBe("80");
    expect(a2).toContain("Bash(sudo:*)");
    expect(JSON.parse(a2[a2.indexOf("--settings") + 1]!).permissions.deny).toEqual(DENIED_COMMANDS);
    expect(a2).not.toContain("--bare");
    expect(a2).not.toContain("--json-schema");
    expect(seen!.env["CLAUDECODE"]).toBeUndefined();
  });

  it("maps errors like the model adapter", async () => {
    const mk = (body: Record<string, unknown>): Exec => async () => ({ stdout: JSON.stringify(body), stderr: "", code: 0 });
    const r1 = await new ClaudeCodeAgent({ exec: mk({ is_error: true, result: "Not logged in" }) }).act(req);
    expect(r1.ok === false && r1.retryable).toBe(false);
    const r2 = await new ClaudeCodeAgent({ exec: mk({ is_error: true, result: "usage limit reached" }) }).act(req);
    expect(r2.ok === false && r2.retryable).toBe(true);
    const r3 = await new ClaudeCodeAgent({ exec: async () => ({ stdout: "", stderr: "timed out after 60 minutes", code: null }) }).act(req);
    expect(r3.ok === false && r3.retryable).toBe(true);
  });
});

/** Uses your Claude Code login and edits a scratch workspace. Run with KARIGOR_REAL_MODEL=1. */
describe.runIf(process.env["KARIGOR_REAL_MODEL"] === "1")("ClaudeCodeAgent (live)", () => {
  it("creates a file in the workspace when asked", async () => {
    const ws = await Workspace.create(join(await mkdtemp(join(tmpdir(), "karigor-agent-live-")), "ws"), fixture);
    const a = new ClaudeCodeAgent({ routineModel: "haiku", effort: { judgment: "low", routine: "low" } });
    const r = await a.act({ ...req, cwd: ws.dir, user: "Create the file src/greet.js exporting a function greet(name) that returns 'hello ' + name. Do not do anything else. Reply with one sentence." });
    expect(r.ok, r.ok ? "" : r.message).toBe(true);
    expect(await readFile(join(ws.dir, "src/greet.js"), "utf8")).toMatch(/greet/);
  }, 300_000);
});
