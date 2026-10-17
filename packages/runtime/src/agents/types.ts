import type { ModelTier, Role } from "@karigor/store";
import type { Usage } from "../adapters/types.js";

export interface AgentRequest {
  tier: ModelTier;
  /** Stable instructions: role prompt plus stack guide. */
  system: string;
  /** The task. */
  user: string;
  /** Directory the agent may read, edit and run commands in. */
  cwd: string;
  key: string;
  role: Role;
  maxTurns?: number;
}

export type AgentResponse =
  | { ok: true; summary: string; usage: Usage; model: string; costUsd?: number; turns?: number }
  | { ok: false; error: "api" | "refusal"; message: string; retryable: boolean; usage: Usage; model: string; costUsd?: number };

/** Something that can act inside a directory: read and edit files, run commands, and report when done. */
export interface AgentAdapter {
  readonly name: string;
  modelFor(tier: ModelTier): string;
  act(req: AgentRequest): Promise<AgentResponse>;
}
