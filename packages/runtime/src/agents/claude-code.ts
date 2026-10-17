import type { ModelTier } from "@karigor/store";
import { CLAUDE_CODE_DEFAULTS, type Exec } from "../adapters/claude-code.js";
import { execFile } from "node:child_process";
import type { Usage } from "../adapters/types.js";
import type { AgentAdapter, AgentRequest, AgentResponse } from "./types.js";

/** Bash commands the developer may never run on the user's machine. Everything else in the workspace is allowed. */
export const DENIED_COMMANDS = [
  "Bash(sudo:*)",
  "Bash(su:*)",
  "Bash(curl:*)",
  "Bash(wget:*)",
  "Bash(ssh:*)",
  "Bash(scp:*)",
  "Bash(rsync:*)",
  "Bash(chmod:*)",
  "Bash(chown:*)",
  "Bash(dd:*)",
  "Bash(mkfs:*)",
  "Bash(shutdown:*)",
  "Bash(reboot:*)",
  "Bash(kill:*)",
  "Bash(pkill:*)",
  "Bash(killall:*)",
  "Bash(rm -rf /*)",
  "Bash(rm -rf ~*)",
  "Bash(rm -rf ..*)",
  "Bash(rm -r /*)",
  "Bash(git push:*)",
  "Bash(git remote:*)",
  "Bash(npm publish:*)",
  "Bash(pnpm publish:*)",
  "Bash(npx vercel:*)",
  "Bash(open:*)",
];

const TOOLS = "Read,Edit,Write,Bash,Glob,Grep";

export interface ClaudeCodeAgentOptions {
  judgmentModel?: string;
  routineModel?: string;
  effort?: { judgment: "low" | "medium" | "high" | "xhigh" | "max"; routine: "low" | "medium" | "high" | "xhigh" | "max" };
  binary?: string;
  timeoutMs?: number;
  maxTurns?: number;
  exec?: Exec;
}

const defaultExec: Exec = (file, args, input, { timeoutMs, env, cwd }) =>
  new Promise((resolve) => {
    const child = execFile(file, args, { env, cwd, timeout: timeoutMs, killSignal: "SIGTERM", maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: unknown; killed?: boolean; signal?: string }) | null;
      if (e?.killed || e?.signal) {
        resolve({ stdout: "", stderr: `timed out after ${Math.round(timeoutMs / 60000)} minutes`, code: null });
        return;
      }
      const code = e && typeof e.code === "number" ? e.code : e ? null : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
    child.stdin?.end(input);
  });

interface CliResult {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
  permission_denials?: { tool_name?: string; tool_input?: { command?: string } }[];
}

/**
 * Claude Code, headless, with tools, inside the workspace. File edits inside the workspace are
 * accepted automatically; a deny-list blocks network, privilege and publishing commands.
 * Runs under the user's own Claude Code login, so no API key is needed.
 */
export class ClaudeCodeAgent implements AgentAdapter {
  readonly name = "claude-code";
  private readonly judgmentModel: string;
  private readonly routineModel: string;
  private readonly effort: NonNullable<ClaudeCodeAgentOptions["effort"]>;
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly maxTurns: number;
  private readonly exec: Exec;

  constructor(opts: ClaudeCodeAgentOptions = {}) {
    this.judgmentModel = opts.judgmentModel ?? "opus";
    this.routineModel = opts.routineModel ?? "sonnet";
    this.effort = opts.effort ?? { judgment: "high", routine: "medium" };
    this.binary = opts.binary ?? CLAUDE_CODE_DEFAULTS.binary;
    this.timeoutMs = opts.timeoutMs ?? 60 * 60 * 1000;
    this.maxTurns = opts.maxTurns ?? 80;
    this.exec = opts.exec ?? defaultExec;
  }

  modelFor(tier: ModelTier): string {
    return `claude-code/${tier === "routine" ? this.routineModel : this.judgmentModel}`;
  }

  async act(req: AgentRequest): Promise<AgentResponse> {
    const tier = req.tier === "routine" ? "routine" : "judgment";
    const alias = tier === "routine" ? this.routineModel : this.judgmentModel;
    const settings = JSON.stringify({ permissions: { deny: DENIED_COMMANDS, defaultMode: "acceptEdits" } });
    const args = [
      "-p",
      "--output-format", "json",
      "--model", alias,
      "--effort", this.effort[tier],
      "--system-prompt", req.system,
      "--permission-mode", "acceptEdits",
      "--tools", TOOLS,
      "--disallowedTools", ...DENIED_COMMANDS,
      "--settings", settings,
      "--max-turns", String(req.maxTurns ?? this.maxTurns),
      "--no-session-persistence",
    ];
    const env = { ...process.env };
    delete env["CLAUDECODE"];
    delete env["CLAUDE_CODE_ENTRYPOINT"];
    const zero: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const model = this.modelFor(tier);
    let out: { stdout: string; stderr: string; code: number | null };
    try {
      out = await this.exec(this.binary, args, req.user, { timeoutMs: this.timeoutMs, env, cwd: req.cwd });
    } catch (e) {
      return { ok: false, error: "api", message: `could not run ${this.binary}: ${(e as Error).message}`, retryable: false, usage: zero, model };
    }
    let parsed: CliResult;
    try {
      parsed = JSON.parse(out.stdout.trim().split("\n").filter((l) => l.startsWith("{")).at(-1) ?? "") as CliResult;
    } catch {
      const msg = (out.stderr || out.stdout).trim().slice(0, 500) || `exit code ${out.code}`;
      return { ok: false, error: "api", message: `claude did not return JSON: ${msg}`, retryable: out.code === null, usage: zero, model };
    }
    const modelId = Object.keys(parsed.modelUsage ?? {})[0] ?? alias;
    const u = parsed.usage ?? {};
    const usage: Usage = {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    };
    const costUsd = parsed.total_cost_usd ?? 0;
    const text = parsed.result ?? "";
    if (parsed.is_error) {
      if (/not logged in/i.test(text)) return { ok: false, error: "api", message: "Claude Code is not logged in: run `claude` once and sign in", retryable: false, usage, model: `claude-code/${modelId}`, costUsd };
      if (/rate limit|usage limit|overloaded|429|try again/i.test(text)) return { ok: false, error: "api", message: `claude: ${text}`, retryable: true, usage, model: `claude-code/${modelId}`, costUsd };
      if (/refus|declin|safety|policy/i.test(text)) return { ok: false, error: "refusal", message: text, retryable: false, usage, model: `claude-code/${modelId}`, costUsd };
      return { ok: false, error: "api", message: `claude: ${text}`, retryable: false, usage, model: `claude-code/${modelId}`, costUsd };
    }
    const denied = (parsed.permission_denials ?? []).map((d) => d.tool_input?.command ?? d.tool_name ?? "?");
    const summary = denied.length ? `${text}\n\n(blocked commands: ${denied.join("; ")})` : text;
    return { ok: true, summary, usage, model: `claude-code/${modelId}`, costUsd, ...(parsed.num_turns !== undefined ? { turns: parsed.num_turns } : {}) };
  }
}
