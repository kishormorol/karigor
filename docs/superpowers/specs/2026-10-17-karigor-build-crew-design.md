# Karigor — Build Crew Design (sub-project 3 of 6)

Date: 2026-10-17
Status: approved in conversation
Depends on: kernel (sub-project 1). Sub-project 2 (intake) is covered by the kernel's product-owner role and assumption ledger; the live runs on 16–17 Oct 2026 showed it converging under real reviewers, so it needs no separate build.

## 1. Goal

The developer role stops describing code and starts writing it: real files in a real workspace, real tests run by real gates. Claude Code, headless with tools, is the developer. No API key is needed.

Done when: `karigor new "<idea>" --run` on the `claude-code` adapter produces a git-versioned workspace with a web app whose tests, lint and build pass, every backlog item landing as a commit reviewed by the existing gates, and the project stops honestly at the release gate (deploy is sub-project 4).

## 2. Principles carried over

Zero-dollar path (local workspace, free stack, Claude Code login); cost is a gate (agent calls are budgeted and recorded like any other); no technical questions to the user; mistakes caught by gates (the gates do not change, their evidence becomes real); everything replayable (the workspace is git; the change artifact records the commit).

## 3. Components

### 3.1 `@karigor/sandbox` — workspace and real sandbox

- A **workspace** is `<project>/workspace/`, its own git repository, created from the target profile's scaffold on first use and committed as the baseline.
- `LocalSandbox implements Sandbox` from `@karigor/gates`, over the workspace, using the profile's commands:
  - `runTests()` runs the profile's test command and parses counts (Vitest JSON reporter).
  - `lint()` and `build()` run the profile's commands; a profile without a lint command passes lint with a note.
  - `securityScan()` runs the dependency audit (`pnpm audit --json`, high and critical only) and a secrets scan over the working tree (API-key shapes, private-key headers, `.env` files tracked by git).
  - `checkUrl()` does a real HTTP GET with a timeout.
  - `verifyRollback()` returns a failure naming the missing deploy adapter until sub-project 4 provides one.
  - `diff(itemId)` is the git diff from the item's first commit's parent to HEAD; without an item, the diff since the baseline.
- Workspace commits are named `karigor(<itemId>): <summary>` so items can be found by message.
- Docker is not required. It becomes an optional isolation layer later behind the same interface.

### 3.2 `@karigor/profiles` — target profiles

- A profile is code plus a scaffold directory: `name`, `description`, `scaffold(dir)`, `commands` (install, test, lint, build), `parseTests(output)`, and a **stack guide** (Markdown) the architect and developer read, so they design and build inside the profile's conventions.
- v1 ships `web-app`: Next.js (App Router) + TypeScript + Tailwind + Drizzle ORM with SQLite (libsql file) locally and Postgres-ready for production + Vitest + ESLint. The scaffold builds, lints and has one passing test before any item runs.
- A second profile, `fixture`, exists for the kernel's own tests: no install step, a test script that reads a marker file, so the whole crew is tested offline in milliseconds.

### 3.3 Agentic workers in `@karigor/runtime`

- A new `AgentAdapter` interface beside `ModelAdapter`: `act({ system, user, cwd, tier }) -> { ok, summary, usage, costUsd }`. It runs an agent that may read and edit files and run commands inside `cwd`, and returns when the agent says it is done.
- `ClaudeCodeAgent` implements it with `claude -p` in the workspace, `--permission-mode acceptEdits`, and an allow-list of Bash commands limited to development tooling (package manager, node, git, test and lint runners). Model and effort per tier as in the model adapter.
- `MockAgent` applies scripted file changes to the workspace for tests.
- The developer role becomes **agentic** when the orchestrator has a workspace and an agent adapter; otherwise the kernel's structured-output developer still runs (the demo path). The agentic developer's contract: input is the item, the spec summary, the architecture, the stack guide, and feedback from failed gates; it must implement, add tests, run tests and lint until green, and finish with a two-sentence summary. Output is the git diff: the orchestrator commits the workspace and writes the `change` artifact from `git diff --stat` with the commit hash in its metadata.

### 3.4 Orchestrator changes in `@karigor/cli`

- `runProject` gains `agent?: AgentAdapter` and `profile?: Profile`. With both, it creates the workspace on first entry to `build` (or `spike`), builds `LocalSandbox` over it, and routes the developer through the agent.
- Budget: an agent call records one cost entry with the agent's reported usage and API-equivalent cost, keyed like any worker attempt.
- `karigor new` and `run` default to the `web-app` profile and the `claude-code` agent when the adapter is `claude-code`; the demo adapter keeps the fake sandbox.

## 4. Data flow for one item

1. Machine: `invokeRole developer on b3`.
2. Orchestrator ensures the workspace exists (scaffold, install, baseline commit on first use), records the baseline HEAD.
3. Agent runs in the workspace with the item prompt. It edits files and runs `pnpm test` itself.
4. Orchestrator stages everything, commits `karigor(b3): <summary>`, writes the `change` artifact (files from `git diff --name-status`, commit hash, summary, body is the diff truncated to a size limit), and appends `worker-finished` with it.
5. Gates: `tests-pass` runs the real suite; `lint-clean`; `diff-matches-spec` and `skeptic-review` read the real diff. A failure sends the item round again with the reasons as feedback (already in the kernel); the next round's agent sees the failed gate output and its own diff.
6. On `itemDone` nothing more is needed; the commit already exists. On `parkItem` the orchestrator reverts the item's commits so parked work does not leak into the release (`git revert` of the item's commits, committed as `karigor(b3): parked`).

## 5. Error handling

- Agent timeout or crash: retryable at the worker level, same as the model adapter; the workspace is reset to the last commit before a retry (`git checkout -- . && git clean -fd`).
- Agent that leaves the tree without changes: the worker result is `invalid` with the reason "no files changed", which walks the item ladder.
- Install failure on scaffold: the build phase fails with the installer's output as evidence; the phase ladder applies.
- Secrets in the tree: the security gate fails and names the file; the developer's next round is told to remove it and move it to an environment variable.
- The Bash allow-list is the safety boundary on the user's machine; the developer prompt says what is allowed. Docker isolation is a later, optional hardening.

## 6. Testing

- `fixture` profile tests: workspace creation, baseline commit, `LocalSandbox` methods against scripted test outputs, diff by item, revert on park, secrets scan positives and negatives.
- Orchestrator golden path with `MockAgent` and the fixture profile: items land as commits, change artifacts carry hashes, a failing test triggers a feedback round, a parked item is reverted.
- Opt-in live test (`KARIGOR_REAL_MODEL=1`): scaffold the real `web-app` profile, build one real item through Claude Code, gates pass.

## 7. Out of scope

Deploy and rollback (sub-project 4), production signals (5), any UI (6), target profiles other than `web-app`, Docker isolation, Playwright end-to-end tests in the scaffold (planned for the profile's second version).
