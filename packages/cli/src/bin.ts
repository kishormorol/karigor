#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { FsStore, ideaLanguage, languageOf, queueInbox, runningPid, type ProjectState } from "@karigor/store";
import { correctAssumption, feedbackSignal, fixRoundCostNote, adminLink, growOnce, hostedHealthUrl, dismissWorkItem, installUiKit, operateOnce, provideSettings, recordSignals, reopenProject, serveProject, stagePlan } from "./operate.js";
import { readSettings } from "@karigor/profiles";
import { renderCost, renderExplain, renderStatus } from "./render.js";
import { createProject, runProject, runWaiting } from "./run.js";
import { projectPort, runOptions as setupRun, type RunFlags } from "./setup.js";
import { findStarter, ideaFor, renderStarter, renderStarters } from "./starters.js";
import { isLang, type Lang } from "./words.js";

const runOptions = (root: string, projectId: string, o: RunFlags) => setupRun(root, projectId, o, { log: (l) => console.log(l) });

const program = new Command();
const defaultRoot = process.env["KARIGOR_ROOT"] ?? join(homedir(), ".karigor", "projects");

program.name("karigor").description("Software agents that take an idea to deployed, maintained software.").version("0.0.1");
program.option("--root <dir>", "where projects live", defaultRoot);
program.option("--lang <lang>", "en or bn: the language Karigor writes to you in (default: the project's own language; KARIGOR_LANG)", process.env["KARIGOR_LANG"]);

/** The language asked for with --lang or KARIGOR_LANG, if any. */
const askedLang = (): Lang | undefined => {
  const l = program.opts<{ lang?: string }>().lang;
  if (l === undefined) return undefined;
  if (!isLang(l)) throw new Error(`--lang is en or bn, not "${l}"`);
  return l;
};
/** The language to write to the person in about one project: what they asked for, else the language of their idea. */
const langFor = async (store: FsStore, state?: ProjectState): Promise<Lang> =>
  askedLang() ?? ((await ideaLanguage(state ?? (await store.replay()), store)) === "Bangla" ? "bn" : "en");

const runFlags = (c: Command) =>
  c
    .option("--adapter <name>", "claude-code (your Claude Code login, no key), claude (API key), ollama (local, free) or demo (offline)", "claude-code")
    .option("--tier <tier>", "free, cheap or best (asked once; default best for claude-code and ollama, which cost nothing per call; free for demo; cheap for claude)")
    .option("--profile <name>", "target profile for real builds", "web-app")
    .option("--deploy <target>", "where releases go: local (this computer, free), vercel (VERCEL_TOKEN) or none; default: the project's last target, else local")
    .option("--port <n>", "port for the live app on the local target (default: the port it last went live on, else 3000)");

runFlags(
  program
    .command("new")
    .argument("[idea]", "the idea, in plain language; with --starter, your changes to the ready-made idea")
    .option("--starter <id>", "start from a ready-made idea (see karigor starters)")
    .option("--run", "start building immediately", false),
)
  .description("record an idea as a new project")
  .action(async (idea: string | undefined, o: RunFlags & { run: boolean; starter?: string }) => {
    const root = program.opts<{ root: string }>().root;
    // Changes written in Bangla start from the Bangla idea.
    const lang = askedLang() ?? (idea && languageOf(idea) === "Bangla" ? "bn" : "en");
    const projectId = await createProject(root, ideaFor(idea, o.starter, lang));
    console.log(lang === "bn" ? `প্রকল্প তৈরি হলো: ${projectId}` : `Created project ${projectId}`);
    if (o.run) await run(root, projectId, o);
    else console.log(lang === "bn" ? `এরপর: karigor run ${projectId}` : `Next: karigor run ${projectId}`);
  });

program
  .command("starters")
  .argument("[id]", "a ready-made idea to show in full")
  .description("list ready-made ideas for common needs, or show one in full")
  .action((id?: string) => {
    const lang = askedLang() ?? "en";
    if (id === undefined) return console.log(renderStarters(lang));
    const starter = findStarter(id);
    if (!starter) throw new Error(`there is no ready-made idea called "${id}"; karigor starters lists them`);
    console.log(renderStarter(starter, lang));
  });

async function run(root: string, projectId: string, o: RunFlags & { wait?: string | boolean }) {
  const everyMs = o.wait === undefined ? 0 : (o.wait === true ? 30 : Math.max(1, Number(o.wait) || 30)) * 60_000;
  const make = () => runOptions(root, projectId, o);
  const state = everyMs ? await runWaiting(make, { everyMs, log: (l) => console.log(l) }) : await runProject(await make());
  const store = await FsStore.open(root, projectId);
  console.log("");
  console.log(await renderStatus(store, state, await langFor(store, state)));
  console.log(await renderCost(store, state));
}

for (const name of ["run", "resume"]) {
  runFlags(program.command(name).argument("<projectId>"))
    .description(name === "run" ? "build the project until it is finished or stopped" : "continue a project after an interruption")
    .option("--wait [minutes]", "when the usage allowance runs out, wait and try again every this many minutes (default 30) instead of stopping")
    .action(async (projectId: string, o: RunFlags & { wait?: string | boolean }) => {
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
    const bn = (await langFor(store)) === "bn";
    if (await runningPid(store.dir)) {
      await queueInbox(store.dir, { kind: "feedback", text });
      console.log(bn ? "ধন্যবাদ। Karigor এখন এই প্রকল্পে কাজ করছে, তাই আপনার বার্তাটি রাখা হলো; এই রাউন্ড শেষ হলেই পড়া হবে।" : "Thanks. Karigor is working on this project right now, so your message is saved and will be read as soon as this round finishes.");
      return;
    }
    const [id] = await recordSignals(store, [feedbackSignal(text)]);
    console.log(
      id
        ? bn
          ? `ধন্যবাদ। ${id} হিসেবে রাখা হলো। এখনই ঠিক করাতে karigor fix ${projectId} চালান, অথবা karigor serve / watch চালু রাখলে নিজে থেকেই ধরা হবে।`
          : `Thanks. Noted as ${id}. Run karigor fix ${projectId} to handle it now, or leave karigor serve / watch running and it will be picked up.`
        : bn ? "এটি আগেই তালিকায় আছে।" : "That is already on the list.",
    );
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

/** Read a line without echoing it (for passcodes and service keys). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    // Ask the terminal to mark pastes, so a pasted value arrives whole and can be cleaned.
    process.stdout.write("\u001b[?2004h");
    let value = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\u001b[?2004l");
          // Terminals wrap pastes in markers (ESC[200~ ... ESC[201~); keep only what was pasted.
          value = value.replace(/\u001b\[20[01]~/g, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
          process.stdout.write(value ? `  (${value.length} characters received)\n` : "  (nothing entered)\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

runFlags(program.command("setup").argument("<projectId>"))
  .option("--set <name=value...>", "give a setting's value without being asked (repeatable)")
  .description("give the live app the settings it still needs (a passcode, a database), in plain words")
  .action(async (projectId: string, o: RunFlags & { set?: string[] }) => {
    const root = program.opts<{ root: string }>().root;
    const opts = await runOptions(root, projectId, o);
    if (!opts.deploy || !opts.profile) throw new Error("setup needs a real adapter and a deploy target");
    const store = await FsStore.open(root, projectId);
    const dir = join(store.dir, "workspace");
    const values: Record<string, string> = {};
    for (const kv of o.set ?? []) {
      const i = kv.indexOf("=");
      if (i < 1) throw new Error(`--set needs NAME=value, got "${kv}"`);
      values[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const missing = (opts.deploy.missingSettings ? await opts.deploy.missingSettings(dir) : []).filter((m) => m.kind !== "generate" && !values[m.name]);
    if (missing.length && process.stdin.isTTY) {
      const all = await readSettings(dir);
      const asked = new Set<string>();
      for (const m of missing) {
        if (asked.has(m.name)) continue;
        if (m.kind === "service") {
          const group = all.filter((s) => s.kind === "service" && s.service && s.service === m.service);
          console.log(`\nThe app needs ${m.service ? `a ${m.service} account (free)` : "an outside service"} for this. Create one, then paste what it gives you.`);
          for (const s of group.length ? group : [{ name: m.name, note: m.note, optional: false }]) {
            asked.add(s.name);
            const v = await askHidden(`  ${s.note || s.name}${s.optional ? " (leave empty to skip)" : ""}\n  ${s.name}: `);
            if (v.trim()) values[s.name] = v;
          }
        } else {
          asked.add(m.name);
          const v = await askHidden(`\n${m.note || m.name}\n  ${m.name}: `);
          if (v.trim()) values[m.name] = v;
        }
      }
    } else if (missing.length) {
      console.log(`Still needed: ${missing.map((m) => m.name).join(", ")}. This window cannot ask questions; run the same command in your own terminal to be asked privately, or pass --set NAME=value.`);
    }
    const r = await provideSettings({ store, deploy: opts.deploy, values, log: (l) => console.log(l) });
    if (r.resumed) {
      console.log(`Stored ${r.stored.join(", ")}. Carrying on with the release.`);
      const state = await runProject(opts);
      console.log(`\n${await renderStatus(store, state)}`);
      return;
    }
    console.log(r.stored.length ? `Stored ${r.stored.join(", ")}. ${r.output.split("\n").at(-1) ?? ""}` : "Nothing new to store.");
    console.log(r.stillMissing.length ? `Still needed before it can be used: ${r.stillMissing.map((m) => m.name).join(", ")}.` : `Everything it needs is in place${r.url ? `: ${r.url}` : ""}.`);
  });

program
  .command("dismiss")
  .argument("<projectId>")
  .argument("<workItemId>", "from karigor status")
  .option("--reason <text>", "why it no longer needs doing", "no longer needed")
  .description("close a reported problem or request that no longer needs doing")
  .action(async (projectId: string, workItemId: string, o: { reason: string }) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    await dismissWorkItem(store, workItemId, o.reason);
    console.log(`Closed ${workItemId}.`);
  });

program
  .command("reopen")
  .argument("<projectId>")
  .description("put a stopped project back to work: parked items return, then karigor resume carries on")
  .action(async (projectId: string) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    const items = await reopenProject(store);
    console.log(`Reopened${items.length ? `; back on the list: ${items.join(", ")}` : ""}. Run karigor resume ${projectId} to carry on.`);
  });

program
  .command("kit")
  .argument("<projectId>")
  .description("add the current UI kit and theme to an app built from an older template (pages are restyled by a fix round)")
  .action(async (projectId: string) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    const changes = await installUiKit(store);
    const done = changes.filter((c) => !c.includes("left as it is"));
    for (const c of changes.filter((c) => c.includes("left as it is"))) console.log(`Note: ${c}.`);
    if (done.length) console.log(`Done: ${done.join(", ")}. To restyle the screens: karigor feedback ${projectId} "..." then karigor fix ${projectId}.`);
    else if (!changes.length) console.log("It already has the current UI kit.");
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

runFlags(program.command("grow").argument("<projectId>"))
  .option("--all", "keep going until every stage is built", false)
  .description("build the next stage of the plan on top of the live app (karigor status lists the stages)")
  .action(async (projectId: string, o: RunFlags & { all?: boolean }) => {
    const root = program.opts<{ root: string }>().root;
    const opts = await runOptions(root, projectId, o);
    const store = await FsStore.open(root, projectId);
    for (;;) {
      const r = await growOnce(opts);
      if (!r.stage) {
        console.log(r.why);
        break;
      }
      console.log(`\n${await renderStatus(store, r.state)}`);
      const plan = await stagePlan(store, r.state);
      if (r.state.status !== "finished") break;
      if (!plan.next) {
        console.log("\nEvery stage of the plan is built.");
        break;
      }
      if (!o.all) {
        console.log(`\nNext stage: ${plan.next.name}: ${plan.next.goal}. Try the app first, then run karigor grow ${projectId} again.`);
        break;
      }
    }
  });

runFlags(program.command("admin-link").argument("<projectId>").argument("<email>").argument("[name]"))
  .description("make the first admin (or a new link for an existing one): prints a one-time link to choose a password")
  .action(async (projectId: string, email: string, name: string | undefined, o: RunFlags) => {
    const root = program.opts<{ root: string }>().root;
    const opts = await runOptions(root, projectId, o);
    const r = await adminLink(opts.deploy, email, name);
    console.log(r.output);
    if (!r.ok) process.exitCode = 1;
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
    await serveProject({ ...rest, profile: opts.profile, port: await projectPort(root, projectId, o.port), everyMs: Number(o.every) * 60_000, signal: ac.signal });
  });

program
  .command("status")
  .argument("<projectId>")
  .description("where the project stands, in plain language")
  .action(async (projectId: string) => {
    const store = await FsStore.open(program.opts<{ root: string }>().root, projectId);
    const state = await store.replay();
    console.log(await renderStatus(store, state, await langFor(store, state)));
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
      console.log(await renderExplain(store, await store.readEvents(), await langFor(store)));
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
