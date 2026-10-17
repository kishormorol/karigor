import { execFile } from "node:child_process";
import type { ModelAdapter, ModelRequest, ModelResponse, Usage } from "./types.js";

/** Runs a command and resolves with stdout even on a non-zero exit (the CLI reports errors in its JSON). */
export type Exec = (file: string, args: string[], input: string, opts: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const defaultExec: Exec = (file, args, input, { timeoutMs, env }) =>
  new Promise((resolve) => {
    const child = execFile(file, args, { env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : err ? null : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
    child.stdin?.end(input);
  });

export interface ClaudeCodeAdapterOptions {
  /** Model alias or id for decisions and reviews. */
  judgmentModel?: string;
  /** Model alias or id for routine work. */
  routineModel?: string;
  effort?: { judgment: "low" | "medium" | "high" | "xhigh" | "max"; routine: "low" | "medium" | "high" | "xhigh" | "max" };
  /** Path to the claude binary. */
  binary?: string;
  timeoutMs?: number;
  exec?: Exec;
}

export const CLAUDE_CODE_DEFAULTS = {
  judgmentModel: "opus",
  routineModel: "haiku",
  effort: { judgment: "high", routine: "low" },
  binary: "claude",
  timeoutMs: 15 * 60 * 1000,
} as const;

/** Shape of `claude -p --output-format json` that we rely on. */
interface CliResult {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  terminal_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

/**
 * Claude through the Claude Code CLI in headless mode. Uses whatever Claude Code is logged in
 * as (a claude.ai subscription or a key), so no API key is needed. Model ids are reported as
 * `claude-code/<model>`, which the budget treats as flat-rate: zero per call, with the
 * API-equivalent cost recorded alongside.
 */
export class ClaudeCodeAdapter implements ModelAdapter {
  readonly name = "claude-code";
  private readonly judgmentModel: string;
  private readonly routineModel: string;
  private readonly effort: NonNullable<ClaudeCodeAdapterOptions["effort"]>;
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly exec: Exec;

  constructor(opts: ClaudeCodeAdapterOptions = {}) {
    this.judgmentModel = opts.judgmentModel ?? CLAUDE_CODE_DEFAULTS.judgmentModel;
    this.routineModel = opts.routineModel ?? CLAUDE_CODE_DEFAULTS.routineModel;
    this.effort = opts.effort ?? CLAUDE_CODE_DEFAULTS.effort;
    this.binary = opts.binary ?? CLAUDE_CODE_DEFAULTS.binary;
    this.timeoutMs = opts.timeoutMs ?? CLAUDE_CODE_DEFAULTS.timeoutMs;
    this.exec = opts.exec ?? defaultExec;
  }

  modelFor(tier: ModelRequest<unknown>["tier"]): string {
    return `claude-code/${tier === "routine" ? this.routineModel : this.judgmentModel}`;
  }

  async complete<T>(req: ModelRequest<T>): Promise<ModelResponse<T>> {
    const tier = req.tier === "routine" ? "routine" : "judgment";
    const alias = tier === "routine" ? this.routineModel : this.judgmentModel;
    const schema = toJsonSchema(req.schema);
    const args = [
      "-p",
      "--output-format", "json",
      "--json-schema", JSON.stringify(schema),
      "--model", alias,
      "--effort", this.effort[tier],
      "--system-prompt", req.system,
      "--no-session-persistence",
      "--tools", "",
    ];
    // A nested Claude Code session must not be mistaken for the parent; strip the markers.
    const env = { ...process.env };
    delete env["CLAUDECODE"];
    delete env["CLAUDE_CODE_ENTRYPOINT"];
    const zero: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let out: { stdout: string; stderr: string; code: number | null };
    try {
      out = await this.exec(this.binary, args, req.user, { timeoutMs: this.timeoutMs, env });
    } catch (e) {
      return { ok: false, error: "api", message: `could not run ${this.binary}: ${(e as Error).message}`, retryable: false, usage: zero, model: this.modelFor(tier) };
    }
    let parsed: CliResult;
    try {
      parsed = JSON.parse(out.stdout.trim().split("\n").filter((l) => l.startsWith("{")).at(-1) ?? "") as CliResult;
    } catch {
      const msg = (out.stderr || out.stdout).trim().slice(0, 500) || `exit code ${out.code}`;
      return { ok: false, error: "api", message: `claude did not return JSON: ${msg}`, retryable: out.code === null, usage: zero, model: this.modelFor(tier) };
    }
    const modelId = Object.keys(parsed.modelUsage ?? {})[0] ?? alias;
    const model = `claude-code/${modelId}`;
    const u = parsed.usage ?? {};
    const usage: Usage = {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    };
    const costUsd = parsed.total_cost_usd ?? 0;
    if (parsed.is_error) {
      const text = parsed.result ?? "unknown error";
      if (/not logged in/i.test(text)) return { ok: false, error: "api", message: "Claude Code is not logged in: run `claude` once and sign in", retryable: false, usage, model, costUsd };
      if (/rate limit|usage limit|overloaded|429|try again/i.test(text)) return { ok: false, error: "api", message: `claude: ${text}`, retryable: true, usage, model, costUsd };
      if (/refus|declin|safety|policy/i.test(text)) return { ok: false, error: "refusal", message: text, retryable: false, usage, model, costUsd };
      return { ok: false, error: "api", message: `claude: ${text}`, retryable: false, usage, model, costUsd };
    }
    if (parsed.structured_output === undefined) {
      return { ok: false, error: "invalid", message: "no structured output was returned", retryable: true, usage, model, raw: (parsed.result ?? "").slice(0, 4000), costUsd };
    }
    const r = req.schema.safeParse(parsed.structured_output);
    if (!r.success) {
      return { ok: false, error: "invalid", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), retryable: true, usage, model, raw: JSON.stringify(parsed.structured_output).slice(0, 4000), costUsd };
    }
    return { ok: true, output: r.data, usage, model, costUsd };
  }
}

import { z } from "zod/v4";

/** JSON Schema the CLI accepts: every property required, no extras. */
export function toJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  return z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
}
