# Karigor — Kernel Design (sub-project 1 of 6)

Date: 2026-10-16
Status: approved in conversation, pending written review
License: Apache-2.0

## 1. What Karigor is

Karigor (Bangla: craftsperson) is a free, open-source system in which software agents take an idea from a person with no technical knowledge all the way to a deployed, maintained piece of software, with no human involvement after the idea and a one-time budget choice.

The difference from existing tools (ChatDev, MetaGPT, OpenHands, GPT-Pilot, Lovable, Replit Agent, Bolt) is that Karigor owns the whole lifecycle, including deployment, operation and maintenance, and that its reliability comes from an enforced software process with evidence-backed gates, not from trusting agents.

### Decisions already made

| Topic | Decision |
|---|---|
| Delivery | Hosted web app (bring-your-own-key by default) plus Docker self-host of the same code |
| Output scope | Any software (web, mobile, CLI, API, ML) via pluggable target profiles; web app is the first profile implemented |
| Models | Claude first behind a model adapter; Ollama and OpenAI adapters later with no kernel change |
| Human role | Fully autonomous after the idea and a one-time budget tier; the system never asks a technical question |
| Process | A library of process templates; a selector agent picks one per idea; a fixed set of gates applies to every template |
| Language | TypeScript monorepo (shared with the web UI; Claude Agent SDK has a first-class TypeScript package) |
| Name / repo | Karigor, `~/karigor`, GitHub `kishormorol/karigor` |

### Sub-projects and build order

1. **Kernel** (this spec): state machine, process templates, artifact store, gate engine, agent runtime, budget, CLI.
2. **Intake**: idea to product spec with no questions, via an assumption ledger.
3. **Build and verify crews** on sandboxes; first target profile: full-stack web app.
4. **Deploy and operate**: containers plus managed database, preview environments, rollback.
5. **Maintenance loop**: production signals become work items that re-enter the kernel.
6. **Hosted chat-first UI**, usable from a phone, designed in Claude Design after a competitor survey; plus Docker self-host.

Additional target profiles (mobile, CLI, API, ML) follow once the web profile proves the loop end to end.

## 2. Principles that bind every sub-project

1. **A zero-dollar path exists.** Every step is runnable at no cost: local models through Ollama, free-tier deploy targets (Cloudflare Pages/Workers, Vercel hobby, GitHub Pages, Neon or Supabase free databases), GitHub as code host. Paid options are upgrades, never requirements. The hosted instance is bring-your-own-key by default. A mock model adapter exists from day one so CI costs nothing.
2. **Cost is a gate, not a report.** Before work starts the kernel produces a cost estimate in the user's currency in three tiers (free, cheap, best quality). The user picks once. Every phase has a token and money budget. Exceeding it triggers downgrade, then scope reduction, then stop; never silent overspend. The user sees a running meter.
3. **Tokens only where judgment is needed.** Deterministic work (tests, lint, build, deploy, diff, URL checks) is code. Routine agent work routes to a cheap model. Only hard steps (product spec, architecture, debugging a failed gate) use the strongest model. Prompt caching is on by default.
4. **Usefulness over demos.** Success means: a person with no technical knowledge describes an idea on their phone and, within the budget they chose, gets a working, deployed thing they can share, which keeps working next month.
5. **No question is ever technical.** The user is asked only about their product, their audience and their money. Technical decisions are made by agents and recorded in a plain-language assumption ledger the user can correct at any time.
6. **Mistakes are caught by gates, not trust.** No phase transition without mechanical evidence. Nothing goes live without passing tests, a security scan, a smoke test on a preview, and a verified rollback path.

## 3. Kernel architecture

TypeScript monorepo (pnpm workspaces). Six packages, each with one job and a public interface that consumers use without reading internals.

### 3.1 `@karigor/store` — project store

- One directory per project (`<root>/projects/<id>/`). The hosted version adds a database later behind the same interface.
- Everything is a **typed artifact**: Markdown body with a JSON frontmatter header validated against a schema. Artifact kinds in v1: `idea`, `spec`, `ledger` (assumption ledger), `architecture`, `backlog`, `sprint`, `test-report`, `gate-result`, `deploy-record`, `cost-ledger`, `summary`, `work-item`.
- An **append-only event log** (`events.jsonl`) is the source of truth. Artifacts are the materialised outputs; project state is derived by replay.
- The project directory is a git repository; every event batch that writes artifacts is committed.
- Interface: `readArtifact(kind, id)`, `writeArtifact(artifact)`, `appendEvent(event)`, `replay()`, `listArtifacts(kind)`.

### 3.2 `@karigor/process` — state machine and templates

- A **process template** is a YAML file: `name`, `description`, `fitsWhen` (plain-language criteria the selector uses), `phases[]`, each with `roles[]` (ordered worker invocations), `loop` (none | sprint with exit condition), `transitions[]` with `to`, `gates[]`, `onFail` (retry | sendBack:<phase> | shrink | park), and `budgetWeight`. `shrink` means the *planner* is re-invoked to split the failing item into smaller items or drop its optional parts, recorded in the ledger; `park` removes the item from the active backlog with a plain-language reason.
- Shipped templates: `iterative` (Scrum-like, default for most products), `linear` (waterfall for small, fully-specified ideas), `spike-then-build` (ideas with a risky unknown resolved first), `maintenance` (entered from a production signal).
- The **state machine** loads a template, replays the event log, and exposes `currentPhase`, `openGates`, `next()` which returns the next action (invoke role X, evaluate gate Y, loop, finish).
- Templates are validated at load time: every phase reachable, every gate name resolvable, every `onFail` target exists.
- Interface: `loadTemplate(name)`, `createMachine(template, store)`, `machine.next()`, `machine.apply(event)`.

### 3.3 `@karigor/gates` — gate engine

- A gate is `mechanical` (a function that runs code and returns pass/fail plus an evidence artifact) or `judged` (a reviewer worker with a rubric that must return a structured verdict citing specific artifacts or lines).
- A judged verdict with no citations is a fail.
- Mechanical gates in v1: `schema-valid`, `tests-pass`, `lint-clean`, `security-scan-clean`, `build-succeeds`, `preview-healthy`, `rollback-verified`, `budget-ok`.
- Judged gates in v1: `spec-complete`, `architecture-sound`, `diff-matches-spec`, `skeptic-review`.
- Every evaluation writes a `gate-result` artifact. "Why did this pass" is always answerable.
- Interface: `registerGate(name, impl)`, `evaluate(name, context) -> GateResult`.

### 3.4 `@karigor/runtime` — agent runtime and model adapter

- A **worker contract**: `role`, `inputs` (artifact references), `tools` (allow-list), `budget` (tokens and money), `outputSchema`, `tier` (judgment | routine). The runtime renders the prompt from the role's prompt file and the inputs, calls the adapter, validates the output against the schema, and only then writes artifacts.
- Validation failure: retry once with the validation error quoted; then escalate to the judgment tier; then park the item. Malformed work never enters the store.
- **Model adapter** interface: `complete(request) -> response` with token and cost accounting. v1 ships `claude` (Claude Agent SDK, tool loop included), and `mock` (scripted responses for tests). `ollama` and `openai` are later adapters with no kernel change.
- Roles in v1: `selector`, `estimator`, `product-owner`, `architect`, `planner`, `developer`, `reviewer`, `skeptic`, `releaser`. Each is a Markdown prompt file plus an output schema. The skeptic runs at the end of every phase in every template, can only object, and its objections become gate failures with evidence.
- Worker calls are idempotent per (item, phase, attempt) so a replay never double-spends.
- Project code runs only inside a sandbox (Docker locally; cloud sandbox later). The runtime never executes project code on the host.
- Interface: `runWorker(contract, store) -> Artifact[]`.

### 3.5 `@karigor/budget` — cost ledger and budget enforcement

- Three estimate tiers are produced before work starts; the chosen tier becomes the `cost-ledger` artifact's budget, split per phase by `budgetWeight`.
- Every adapter call appends a cost entry (role, tier, model, tokens in/out, cached tokens, money).
- A check runs before every worker call. Over the phase budget: downgrade tier, then park non-essential backlog items, then stop and write a plain-language report. Never silent overspend.
- Prices live in a versioned `prices.json`; the mock adapter costs zero.
- Interface: `estimate(project) -> Tier[]`, `check(phase) -> Allowance`, `record(entry)`, `meter() -> RunningTotal`.

### 3.6 `@karigor/cli` — command line

- `karigor new "<idea>"`, `run`, `status`, `resume`, `cost`, `explain [artifact]`, `park <item>`, `unpark <item>`.
- `status` and `explain` render the event log and ledger in plain language. The CLI is the first user and the thing the web UI later calls.

## 4. Data flow through one project

Italic items are agents; everything else is code.

1. `karigor new "a site where neighbours lend tools"` creates the project store, writes the `idea` artifact, logs the first event.
2. *Selector* reads the idea, picks a process template and a target profile, and writes both with reasons into the `ledger`.
3. *Estimator* produces three cost tiers. The user picks one. That becomes the budget, split per phase. From here the kernel asks nothing.
4. The state machine enters the first phase and runs the roles the template lists. In `iterative`: *product-owner* writes `spec` and `ledger`; *architect* writes `architecture`; *planner* writes a `backlog` of small items; then sprints loop: *developer* implements one item in the sandbox, mechanical gates run, *reviewer* judges the diff against the spec, *skeptic* objects or stays silent, and the item closes or returns.
5. Every transition evaluates its gates. Pass logs a transition event. Fail logs a failure event with evidence and follows the template's `onFail`. A per-item fail counter and a project-wide failure budget stop infinite loops; exhaustion parks the item and the project continues on everything else.
6. Budget checks run before every worker call (see 3.5).
7. Release phase: deploy to the target's preview, smoke test, verify rollback, promote. Writes `deploy-record` and a plain-language `summary`.
8. The project enters a dormant state owned by the `maintenance` template: signals (errors, downtime, dependency alerts, user feedback) create `work-item` artifacts that re-enter step 4.

## 5. Error handling and the "mistakes cannot reach the user" guarantee

Agents will make mistakes. The guarantee is that a mistake cannot reach the user. Five mechanisms:

1. **Schema rejection** (3.4): malformed output never enters the store.
2. **Evidence-backed gates** (3.3): no pass without an evidence artifact; judged verdicts must cite.
3. **Bounded loops** (4.5): retry budgets per item and per project; exhaustion parks with a plain-language reason and the project continues.
4. **Crash safety** (3.1, 3.4): event log is the truth; `resume` replays to the exact state; idempotent worker calls.
5. **Deploy safety** (4.7): no promotion without a healthy preview and verified rollback; failed promotion auto-rolls back and files a maintenance work item. Secrets never enter artifacts; they live in the host's secret store and are referenced by name.

Plus the *skeptic* role at the end of every phase.

## 6. Testing the kernel

- Unit tests for state machine, gate engine, budget logic and schema validation, all on the mock adapter, zero cost.
- Golden-path integration tests: a fixture idea runs through every shipped template with scripted mock outputs, including scripted failures that must exercise retry, send-back, shrink and park.
- Replay tests: kill the process at random events and assert `resume` reaches the same end state and the same cost total.
- One real-model smoke test behind an opt-in flag, run manually before releases.

## 7. Out of scope for this sub-project

Intake conversation quality, the actual developer tooling inside the sandbox, deploy adapters, production signal collection, and any UI. The kernel ships with the mock adapter and the Claude adapter, the four templates, the nine role prompt files, the gates listed above, and the CLI. The golden-path test proves that the full loop runs end to end on scripted outputs; sub-projects 2 to 5 replace scripted outputs with real work.
