#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { FsStore } from "@karigor/store";
import { FakeSandbox } from "@karigor/gates";
import { ClaudeAdapter, ClaudeCodeAdapter, type ModelAdapter } from "@karigor/runtime";
import { demoAdapter } from "./demo.js";
import { renderCost, renderExplain, renderStatus } from "./render.js";
import { createProject, runProject } from "./run.js";

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
    case "demo":
      return demoAdapter();
    default:
      throw new Error(`unknown adapter "${name}" (use claude-code, claude or demo)`);
  }
}

const tierOpt = ["free", "cheap", "best"] as const;
type Tier = (typeof tierOpt)[number];
function tierFrom(v: string | undefined): Tier | undefined {
  if (v === undefined) return undefined;
  if ((tierOpt as readonly string[]).includes(v)) return v as Tier;
  throw new Error(`tier must be one of ${tierOpt.join(", ")}`);
}

program
  .command("new")
  .argument("<idea>", "the idea, in plain language")
  .option("--run", "start building immediately", false)
  .option("--adapter <name>", "claude-code (your Claude Code login, no key), claude (API key) or demo (offline)", "claude-code")
  .option("--tier <tier>", "free, cheap or best (asked once; default best for claude-code, free for demo, cheap for claude)")
  .description("record an idea as a new project")
  .action(async (idea: string, o: { run: boolean; adapter: string; tier?: string }) => {
    const root = program.opts<{ root: string }>().root;
    const projectId = await createProject(root, idea);
    console.log(`Created project ${projectId}`);
    if (o.run) await run(root, projectId, o.adapter, tierFrom(o.tier));
    else console.log(`Next: karigor run ${projectId}`);
  });

async function run(root: string, projectId: string, adapterName: string, tier: Tier | undefined) {
  const adapter = adapterFor(adapterName);
  const state = await runProject({ root, projectId, adapter, sandbox: new FakeSandbox(), ...(tier ? { tier } : {}), log: (l) => console.log(l) });
  const store = await FsStore.open(root, projectId);
  console.log("");
  console.log(await renderStatus(store, state));
  console.log(await renderCost(store, state));
}

for (const name of ["run", "resume"]) {
  program
    .command(name)
    .argument("<projectId>")
    .option("--adapter <name>", "claude-code, claude or demo", "claude-code")
    .option("--tier <tier>", "free, cheap or best")
    .description(name === "run" ? "build the project until it is finished or stopped" : "continue a project after an interruption")
    .action(async (projectId: string, o: { adapter: string; tier?: string }) => {
      await run(program.opts<{ root: string }>().root, projectId, o.adapter, tierFrom(o.tier));
    });
}

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
