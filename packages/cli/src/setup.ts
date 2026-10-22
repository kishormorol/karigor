/** Turning plain choices (which model, where to deploy) into run options. Shared by the CLI and the server. */
import { FsStore } from "@karigor/store";
import { FakeSandbox } from "@karigor/gates";
import { ClaudeAdapter, ClaudeCodeAdapter, ClaudeCodeAgent, ModelAgent, OllamaAdapter, type AgentAdapter, type ModelAdapter } from "@karigor/runtime";
import { profileFor, type Profile } from "@karigor/profiles";
import { LocalDeploy, VercelDeploy, projectSlug, type DeployAdapter } from "@karigor/deploy";
import { demoAdapter } from "./demo.js";
import type { RunOptions } from "./run.js";

export const ADAPTERS = ["claude-code", "claude", "ollama", "demo"] as const;

/** `apiKey` is used for this adapter only and never written anywhere. */
export function adapterFor(name: string, o: { apiKey?: string } = {}): ModelAdapter {
  switch (name) {
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "claude":
      return new ClaudeAdapter(o.apiKey ? { apiKey: o.apiKey } : {});
    case "ollama":
      return new OllamaAdapter();
    case "demo":
      return demoAdapter();
    default:
      throw new Error(`unknown adapter "${name}" (use ${ADAPTERS.join(", ")})`);
  }
}

/** Claude Code works in the workspace with its own tools; any other model writes whole files through ModelAgent. */
export function agentFor(name: string, adapter: ModelAdapter): AgentAdapter | undefined {
  if (name === "demo") return undefined;
  return name === "claude-code" ? new ClaudeCodeAgent() : new ModelAgent(adapter);
}

/** Where releases go. Without a choice, the target the project last used, else this computer. */
export async function deployFor(target: string | undefined, store: FsStore, profile: Profile, port: number, log?: (line: string) => void): Promise<DeployAdapter | undefined> {
  let t = target;
  if (!t) {
    const state = await store.replay();
    const last = state.artifacts["deploy-record"]?.at(-1);
    t = last ? (await store.readArtifact("deploy-record", last)).meta.target : "local";
  }
  switch (t) {
    case "none":
      return undefined;
    case "local":
      return new LocalDeploy({ projectDir: store.dir, profile, productionPort: port, ...(log ? { log } : {}) });
    case "vercel": {
      const state = await store.replay();
      const idea = state.ideaId ? (await store.readArtifact("idea", state.ideaId)).meta.text : store.projectId;
      return new VercelDeploy({ project: projectSlug(idea, store.projectId), ...(profile.healthPath ? { healthPath: profile.healthPath } : {}), ...(process.env["KARIGOR_DEPLOY_ENV"] ? { envNames: process.env["KARIGOR_DEPLOY_ENV"].split(",").map((x) => x.trim()).filter(Boolean) } : {}) });
    }
    default:
      throw new Error(`unknown deploy target "${t}" (use local, vercel or none)`);
  }
}

const tierOpt = ["free", "cheap", "best"] as const;
export type Tier = (typeof tierOpt)[number];
export function tierFrom(v: string | undefined): Tier | undefined {
  if (v === undefined) return undefined;
  if ((tierOpt as readonly string[]).includes(v)) return v as Tier;
  throw new Error(`tier must be one of ${tierOpt.join(", ")}`);
}

export interface RunFlags {
  adapter: string;
  tier?: string;
  profile: string;
  deploy?: string;
  /** Unset: the port the project last went live on (local target), else 3000. */
  port?: string;
}

/** The port given, else the one the project's local release last went live on, else 3000. */
export async function projectPort(root: string, projectId: string, given?: string): Promise<number> {
  if (given) return Number(given);
  const store = await FsStore.open(root, projectId);
  const state = await store.replay();
  for (const id of [...(state.artifacts["deploy-record"] ?? [])].reverse()) {
    const r = (await store.readArtifact("deploy-record", id)).meta;
    if (r.target !== "local" || r.environment !== "production" || !r.url) continue;
    const port = Number(new URL(r.url).port);
    if (port) return port;
  }
  return 3000;
}

export async function runOptions(root: string, projectId: string, o: RunFlags, extra: { apiKey?: string; log?: (line: string) => void } = {}): Promise<RunOptions> {
  const adapter = adapterFor(o.adapter, extra.apiKey ? { apiKey: extra.apiKey } : {});
  const agent = agentFor(o.adapter, adapter);
  const tier = tierFrom(o.tier);
  const base = { root, projectId, adapter, ...(tier ? { tier } : {}), ...(extra.log ? { log: extra.log } : {}) };
  // The demo adapter has no real developer, so it keeps the fake sandbox. Real adapters build for real.
  if (!agent) return { ...base, sandbox: new FakeSandbox() };
  const profile = profileFor(o.profile);
  const store = await FsStore.open(root, projectId);
  const deploy = await deployFor(o.deploy, store, profile, await projectPort(root, projectId, o.port), extra.log);
  return { ...base, profile, agent, ...(deploy ? { deploy } : {}) };
}
