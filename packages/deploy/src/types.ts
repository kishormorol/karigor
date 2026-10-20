import type { CommandResult, UrlCheck } from "@karigor/gates";

export interface DeployRequest {
  /** The workspace: a git repository holding the code to release. */
  dir: string;
  /** Release name, `r<n>-<sha7>`. */
  version: string;
  /** Workspace commit to release. */
  commit: string;
  /** Idempotency key from the orchestrator. */
  key: string;
}

export interface DeployResult {
  ok: boolean;
  url?: string;
  /** The target's own id for the deployment. */
  id?: string;
  /** What happened, for the deploy record's body. */
  output: string;
}

/** The release that is live now, when there is one. Rollback returns to it. */
export interface LiveRelease {
  url: string;
  id: string;
  version: string;
}

/** A place a release can be put online: preview first, then production, with a way back. */
export interface DeployAdapter {
  readonly name: string;
  /** Plain words for the person: where it lives and how to open it. */
  describe(): string;
  preview(r: DeployRequest): Promise<DeployResult>;
  /** Make a healthy preview the production release, then confirm production answers. */
  promote(r: DeployRequest & { preview: DeployResult }): Promise<DeployResult>;
  /** Return production to `live` (or take it offline when there was none). */
  rollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult>;
  /** Prove a rollback to `live` would work, without changing production. */
  verifyRollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult>;
  /** For targets whose previews need more than a plain GET (access protection). */
  checkUrl?(url: string): Promise<UrlCheck>;
  /** Bring a preview back if a crash took it down. */
  ensure?(r: { url: string; id: string }): Promise<void>;
  /** Stop everything this adapter started. */
  stop(): Promise<void>;
}

export class DeployError extends Error {
  override name = "DeployError";
}
