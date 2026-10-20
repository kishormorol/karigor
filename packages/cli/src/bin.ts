#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { FsStore } from "@karigor/store";
import { FakeSandbox } from "@karigor/gates";
import { ClaudeAdapter, ClaudeCodeAdapter, ClaudeCodeAgent, ModelAgent, OllamaAdapter, type AgentAdapter, type ModelAdapter } from "@karigor/runtime";
import { profileFor, type Profile } from "@karigor/profiles";
import { LocalDeploy, VercelDeploy, projectSlug, type DeployAdapter } from "@karigor/deploy";
import { demoAdapter } from "./demo.js";
import { correctAssumption, feedbackSignal, fixRoundCostNote, hostedHealthUrl, operateOnce, recordSignals, serveProject } from "./operate.js";
import { renderCost, renderExplain, renderStatus } from "./render.js";
import { createProject, runProject, type RunOptions } from "./run.js";

const program = new Command();
const defaultRoot = process.env["KARIGOR_ROOT"] ?? join(homedir(), ".karigor", "projects");

program.name("karigor").description("Software agents that take an idea to deployed, maintained software.").version("0.0.1");
program.option("--root <dir>", "where projects live", defaultRoot);

function adapterFor(name: string): ModelAdapter {
  switch (name) {
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "claude":
      return new ClaudeAdapter();
    case "ollama":
      return new OllamaAdapter();
    case "demo":
      return demoAdapter();
    default:
      throw new Error(`unknown adapter "${name}" (use claude-code, claude, ollama or demo)`);
  }
}

/** Claude Code works in the workspace with its own tools; any other model writes whole files through ModelAgent. */
function agentFor(name: string, adapter: ModelAdapter): AgentAdapter | undefined {
  if (name === "demo") return undefined;
  return name === "claude-code" ? new ClaudeCodeAgent() : new ModelAgent(adapter);
}

/** Where releases go. Without a flag, the target the project last used, else this computer. */
async function deployFor(target: string | undefined, store: FsStore, profile: Profile, port: number): Promise<DeployAdapter | undefined> {
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
      return new LocalDeploy({ projectDir: store.dir, profile, productionPort: port, log: (l) => console.log(l) });
    case "vercel": {
      const state = await store.replay();
      const idea = state.ideaId ? (await store.readArtifact("idea", state.ideaId)).meta.text : store.projectId;
      return new VercelDeploy({ project: projectSlug(idea, store.projectId), ...(profile.healthPath ? { healthPath: profile.healthPath } : {}), ...(process.env["KARIGOR_DEPLOY_ENV"] ? { envNames: process.env["KARIGOR_DEPLOY_ENV"].split(",").map((x) => x.trim()).filter(Boolean) } : {}) });
    }
    default:
      throw new Error(`unknown deploy target "${t}" (use local, vercel or none)`);
  }
}

interface RunFlags {
  adapter: string;
  tier?: string;
  profile: string;
  deploy?: string;
  port: string;
}

async function runOptions(root: string, projectId: string, o: RunFlags): Promise<RunOptions> {
  const adapter = adapterFor(o.adapter);
  const agent = agentFor(o.adapter, adapter);
  const tier = tierFrom(o.tier);
  const base = { root, projectId, adapter, ...(tier ? { tier } : {}), log: (l: string) => console.log(l) };
  // The demo adapter has no real developer, so it keeps the fake sandbox. Real adapters build for real.
  if (!agent) return { ...base, sandbox: new FakeSandbox() };
  const profile = profileFor(o.profile);
  const store = await FsStore.open(root, projectId);
  const deploy = await deployFor(o.deploy, store, profile, Number(o.port));
  return { ...base, profile, agent, ...(deploy ? { deploy } : {}) };
}

const runFlags = (c: Command) =>
  c
    .option("--adapter <name>", "claude-code (your Claude Code login, no key), claude (API key), ollama (local, free) or demo (offline)", "claude-code")
    .option("--tier <tier>", "free, cheap or best (asked once; default best for claude-code and ollama, which cost nothing per call; free for demo; cheap for claude)")
    .option("--profile <name>", "target profile for real builds", "web-app")
    .option("--deploy <target>", "where releases go: local (this computer, free), vercel (VERCEL_TOKEN) or none; default: the project's last target, else local")
    .option("--port <n>", "port for the live app on the local target", "3000");

const tierOpt = ["free", "cheap", "best"] as const;
type Tier = (typeof tierOpt)[number];
function tierFrom(v: string | undefined): Tier | undefined {
  if (v === undefined) return undefined;
  if ((tierOpt as readonly string[]).includes(v)) return v as Tier;
  throw new Error(`tier must be one of ${tierOpt.join(", ")}`);
}

runFlags(
  program
    .command("new")
    .argument("<idea>", "the idea, in plain language")
    .option("--run", "start building immediately", false),
)
  .description("record an idea as a new project")
  .action(async (idea: string, o: RunFlags & { run: boolean }) => {
    const root = program.opts<{ root: string }>().root;
    const projectId = await createProject(root, idea);
    console.log(`Created project ${projectId}`);
    if (o.run) await run(root, projectId, o);
    else console.log(`Next: karigor run ${projectId}`);
  });

async function run(root: string, projectId: string, o: RunFlags) {
  const state = await runProject(await runOptions(root, projectId, o));
  const store = await FsStore.open(root, projectId);
  console.log("");
  console.log(await renderStatus(store, state));
  console.log(await renderCost(store, state));
}

for (const name of ["run", "resume"]) {
  runFlags(program.command(name).argument("<projectId>"))
    .description(name === "run" ? "build the project until it is finished or stopped" : "continue a project after an interruption")
    .action(async (projectId: string, o: RunFlags) => {
      await run(program.opts<{ root: string }>().root, projectId, o);
    });
}

program
  .command("feedback")
  .argument("<projectId>")
  .argument("<text>", "what is wrong or what you would like, in your own words")
  .description("tell Karigor about a problem or a wish; it becomes work for the next fix round")
  .action(async (projectId: string, text: string) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    const [id] = await recordSignals(store, [feedbackSignal(text)]);
    console.log(id ? `Thanks. Noted as ${id}. Run karigor fix ${projectId} to handle it now, or leave karigor serve / watch running and it will be picked up.` : "That is already on the list.");
  });

program
  .command("correct")
  .argument("<projectId>")
  .argument("<decisionId>", "the decision's id from karigor status, like a3")
  .argument("<text>", "what it should be instead")
  .description("correct a decision Karigor made on your behalf")
  .action(async (projectId: string, decisionId: string, text: string) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    const r = await correctAssumption(store, decisionId, text);
    console.log(r.workItemId ? `Noted. The change is queued as ${r.workItemId}; run karigor fix ${projectId} to apply it now.` : "Noted. Every step from now on will follow it.");
  });

runFlags(program.command("fix").argument("<projectId>"))
  .description("start a fix round now for every open problem and request")
  .action(async (projectId: string, o: RunFlags) => {
    const root = program.opts<{ root: string }>().root;
    const opts = await runOptions(root, projectId, o);
    const r = await operateOnce(opts);
    const store = await FsStore.open(root, projectId);
    if (!r.cycle) console.log("Nothing to fix right now.");
    else console.log(`\n${await renderStatus(store, r.state)}\n${fixRoundCostNote(opts.adapter)}`);
  });

runFlags(program.command("watch").argument("<projectId>"))
  .option("--every <minutes>", "keep watching, checking this often")
  .option("--url <url>", "the address to check (default: the live app, for hosted targets)")
  .description("check the live app and its libraries; run a fix round when something is wrong")
  .action(async (projectId: string, o: RunFlags & { every?: string; url?: string }) => {
    const root = program.opts<{ root: string }>().root;
    const opts = await runOptions(root, projectId, o);
    const store = await FsStore.open(root, projectId);
    for (;;) {
      const state = await store.replay();
      const url = o.url ?? (await hostedHealthUrl(store, state, opts.profile?.healthPath));
      const r = await operateOnce({ ...opts, audit: true, ...(url ? { healthUrl: url } : {}) });
      console.log(r.cycle ? `Fix round ${r.cycle}: ${r.state.status}.` : r.recorded.length ? `${r.recorded.length} new problem(s) noted.` : `All quiet${url ? ` (${url} is healthy)` : ""}.`);
      if (!o.every) break;
      await new Promise((res) => setTimeout(res, Number(o.every) * 60_000));
    }
  });

runFlags(program.command("serve").argument("<projectId>"))
  .option("--every <minutes>", "how often to look for problems", "10")
  .description("run the live app on this computer, watch it, and fix what breaks")
  .action(async (projectId: string, o: RunFlags & { every: string }) => {
    const root = program.opts<{ root: string }>().root;
    const opts = await runOptions(root, projectId, { ...o, deploy: "local" });
    if (!opts.profile) throw new Error("serve needs a real adapter (not demo)");
    const ac = new AbortController();
    process.once("SIGINT", () => ac.abort());
    process.once("SIGTERM", () => ac.abort());
    const { deploy: _d, ...rest } = opts;
    await serveProject({ ...rest, profile: opts.profile, port: Number(o.port), everyMs: Number(o.every) * 60_000, signal: ac.signal });
  });

program
  .command("status")
  .argument("<projectId>")
  .description("where the project stands, in plain language")
  .action(async (projectId: string) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    console.log(await renderStatus(store, await store.replay()));
  });

program
  .command("cost")
  .argument("<projectId>")
  .description("what has been spent so far")
  .action(async (projectId: string) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    console.log(await renderCost(store, await store.replay()));
  });

program
  .command("explain")
  .argument("<projectId>")
  .argument("[artifactId]", "show one artifact instead of the story")
  .description("the story of what happened, or one artifact")
  .action(async (projectId: string, artifactId?: string) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    if (!artifactId) {
      console.log(await renderExplain(store, await store.readEvents()));
      return;
    }
    const state = await store.replay();
    for (const [kind, ids] of Object.entries(state.artifacts)) {
      if (ids?.includes(artifactId)) {
        const a = await store.readArtifact(kind as never, artifactId);
        console.log(JSON.stringify(a.meta, null, 2));
        console.log("");
        console.log(a.body);
        return;
      }
    }
    throw new Error(`no artifact ${artifactId}`);
  });

program
  .command("park")
  .argument("<projectId>")
  .argument("<itemId>")
  .option("--reason <text>", "why", "parked by the user")
  .description("set a piece of work aside")
  .action(async (projectId: string, itemId: string, o: { reason: string }) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    await store.appendEvent({ type: "item-status", by: "user", itemId, status: "parked", reason: o.reason });
    await store.commit(`karigor: user parked ${itemId}`);
    console.log(`Parked ${itemId}.`);
  });

program
  .command("unpark")
  .argument("<projectId>")
  .argument("<itemId>")
  .description("put a parked piece of work back")
  .action(async (projectId: string, itemId: string) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    await store.appendEvent({ type: "item-status", by: "user", itemId, status: "todo", reason: "unparked by the user" });
    await store.commit(`karigor: user unparked ${itemId}`);
    console.log(`${itemId} is back in the backlog. Run karigor resume ${projectId} to continue.`);
  });

program.parseAsync(process.argv).catch((e: Error) => {
  console.error(`karigor: ${e.message}`);
  process.exitCode = 1;
});
