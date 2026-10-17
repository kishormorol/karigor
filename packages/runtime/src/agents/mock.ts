import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentAdapter, AgentRequest, AgentResponse } from "./types.js";

export interface MockAgentStep {
  /** Files to write (string) or delete (null), relative to cwd. */
  files?: Record<string, string | null>;
  summary?: string;
  /** Simulate a failure instead of acting. */
  fail?: { error: "api" | "refusal"; message: string; retryable?: boolean };
  /** Simulate a crash mid-way: write files, then report failure. */
  crashAfterWriting?: boolean;
}

export type MockAgentScript = (req: AgentRequest, attempt: number) => MockAgentStep;

/** Applies scripted edits to the workspace; for tests. */
export class MockAgent implements AgentAdapter {
  readonly name = "mock";
  readonly calls: { key: string; attempt: number; user: string }[] = [];
  private readonly attempts = new Map<string, number>();
  constructor(private readonly script: MockAgentScript) {}

  modelFor(): string {
    return "mock";
  }

  async act(req: AgentRequest): Promise<AgentResponse> {
    const attempt = (this.attempts.get(req.key) ?? 0) + 1;
    this.attempts.set(req.key, attempt);
    this.calls.push({ key: req.key, attempt, user: req.user });
    const step = this.script(req, attempt);
    const usage = { inputTokens: Math.ceil((req.system.length + req.user.length) / 4), outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 };
    if (step.fail && !step.crashAfterWriting) return { ok: false, error: step.fail.error, message: step.fail.message, retryable: step.fail.retryable ?? false, usage, model: "mock" };
    for (const [path, content] of Object.entries(step.files ?? {})) {
      const p = join(req.cwd, path);
      if (content === null) await rm(p, { force: true });
      else {
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, content, "utf8");
      }
    }
    if (step.fail) return { ok: false, error: step.fail.error, message: step.fail.message, retryable: step.fail.retryable ?? false, usage, model: "mock" };
    return { ok: true, summary: step.summary ?? "Done.", usage, model: "mock", turns: 1 };
  }
}
