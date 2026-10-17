# Karigor Kernel — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-16-karigor-kernel-design.md`
Date: 2026-10-16

## Goal

One sentence: a `karigor` CLI that takes an idea through every shipped process template to a "released" state on the mock adapter, with every transition gated, every call budgeted, and `resume` surviving a kill at any event.

Done when: `pnpm test` passes the unit, golden-path (4 templates), and replay suites on the mock adapter at zero cost, and the opt-in real-model smoke test completes one `linear` run on Claude.

## Toolchain (checked on this machine)

Node 25.9, npm 11.12, Docker 29.3, Ollama installed. pnpm is not installed: `corepack enable` provides it. TypeScript strict, vitest, zod for every artifact and output schema, yaml for templates, commander for the CLI.

## Steps, in dependency order

Each step is a PR-sized unit with its own tests. Nothing in a later step is needed to test an earlier one.

1. **Monorepo skeleton.** `package.json` workspaces, `pnpm-workspace.yaml`, `tsconfig.base.json`, vitest config, CI workflow (GitHub Actions, mock adapter only). Packages created empty: `packages/{store,process,gates,runtime,budget,cli}`. Check: `pnpm -r build` and `pnpm test` run green with one placeholder test.

2. **Artifact schemas** in `packages/store/src/schemas/`. One zod schema per artifact kind (12 kinds from spec 3.1) plus the `Event` union (project-created, artifact-written, worker-started, worker-finished, gate-evaluated, transition, item-parked, budget-downgraded, project-finished). Check: schema round-trip tests on fixtures; a malformed fixture is rejected.

3. **Store** in `packages/store/src/`: `fs-store.ts` (project dir, `artifacts/<kind>/<id>.md` with JSON frontmatter, `events.jsonl` append-only), `replay.ts` (fold events into `ProjectState`), `git.ts` (commit per event batch). Check: write/read round trip; replay of a fixture log equals the expected state; a corrupt trailing line in `events.jsonl` is detected and reported, not silently skipped.

4. **Process templates** in `packages/process/`: `template-schema.ts` (zod for the YAML shape in spec 3.2), `loader.ts` with validation (reachability, gate names resolvable, `onFail` targets exist), and the four YAML files under `templates/`. Check: all four load; a template with an unreachable phase fails with a named error.

5. **State machine** in `packages/process/src/machine.ts`: `createMachine(template, state)` exposing `currentPhase`, `openGates`, `next()` returning a typed `Action` (`invokeRole | evaluateGate | loop | finish`), and `apply(event)`. Pure function over state; no IO. Check: table-driven tests walking each template; `next()` after a gate failure follows `onFail`; retry counters and the project failure budget park correctly.

6. **Gate engine** in `packages/gates/`: `registry.ts`, `evaluate.ts`, mechanical gates `schema-valid`, `budget-ok`, and stubs for `tests-pass`, `lint-clean`, `security-scan-clean`, `build-succeeds`, `preview-healthy`, `rollback-verified` that call a `Sandbox` interface (real Docker implementation is sub-project 3; kernel ships a `fake-sandbox.ts`). Judged gates `spec-complete`, `architecture-sound`, `diff-matches-spec`, `skeptic-review` as rubric files plus a verdict schema that requires citations. Check: a verdict without citations fails; every gate writes a `gate-result` artifact.

7. **Model adapter** in `packages/runtime/src/adapters/`: `types.ts` (`complete(request) -> {output, usage, cost}` where request carries a zod schema), `mock.ts` (scripted responses keyed by role and attempt, from a fixture file), `claude.ts` using `@anthropic-ai/sdk` `messages.parse` with `zodOutputFormat`, adaptive thinking left at default, `output_config.effort` per tier, prompt caching on the role prompt, and server-side `fallbacks: "default"`. Tier map: judgment -> `claude-opus-5-5` (effort `high`), routine -> `claude-haiku-5-5` (effort `low`). Check: mock adapter unit tests; the Claude adapter has a contract test that runs only with `KARIGOR_REAL_MODEL=1`.

8. **Budget** in `packages/budget/`: `prices.json` (per-model input/output/cache-read rates), `estimate.ts` (three tiers from template `budgetWeight` and a per-role token prior), `check.ts` (allowance before each call, downgrade -> park -> stop ladder), `ledger.ts`. Check: a scripted run that exceeds a phase budget downgrades first, parks second, stops third, and the ledger total matches the sum of entries.

9. **Agent runtime** in `packages/runtime/src/`: `worker.ts` (render role prompt from `roles/<role>.md` plus input artifacts, call adapter, validate, retry-once-with-error, escalate tier, park), `roles/` (nine prompt files and nine output schemas), idempotency key `(itemId, phase, attempt)`. Check: malformed first response then valid second is accepted on attempt 2 and recorded as such; two runs with the same key do not double-charge the ledger.

10. **Orchestrator loop** in `packages/cli/src/run.ts`: `while (action = machine.next())` dispatching to runtime, gates, budget, and store; writes events; commits. This is the only place the packages meet. Check: golden-path test per template on the mock adapter reaches `project-finished`; the scripted failure fixtures exercise retry, sendBack, shrink, park.

11. **CLI commands** in `packages/cli/src/commands/`: `new`, `run`, `status`, `resume`, `cost`, `explain`, `park`, `unpark`. `status` and `explain` render plain language from the event log and ledger. Check: snapshot tests of command output on a fixture project.

12. **Replay tests** in `packages/cli/test/replay.test.ts`: run the golden path, kill at event N for every N, `resume`, assert final state and ledger total equal the unkilled run.

13. **Docs and release hygiene**: README quick start, `CONTRIBUTING.md`, `docs/templates.md` explaining how to write a process template, GitHub repo creation and first push.

## Decision points

- **Which Claude surface for the kernel adapter.** Pick: plain `@anthropic-ai/sdk` with structured outputs, not the Claude Agent SDK. Kernel workers in v1 produce documents, not file edits, so a schema-validated single call is exactly right and far cheaper. The Agent SDK becomes a second adapter in sub-project 3 for the tool-using `developer` role. Tradeoff: two adapters to maintain later, in exchange for a kernel with no sandbox dependency now.
- **Event log as the only truth vs. a state snapshot file.** Pick: event log only, with replay. Snapshots can drift; replay cannot. Tradeoff: replay cost grows with project length, which is fine at kernel scale and can be cached later behind the same interface.
- **Role prompts as Markdown files vs. TypeScript strings.** Pick: Markdown files under `roles/`, loaded at runtime. Non-developers and prompt-tuning PRs can read and change them without touching code. Tradeoff: one more loader and a test that every role has a prompt and a schema.
- **Default judgment model.** Pick: `claude-opus-5-5` at `high` effort, Haiku 5.5 for routine. Fable 5.1 is reserved for an opt-in "best quality" cost tier because its price exceeds Opus-tier and the cost principle says the default must be the cheap-but-reliable path.

## What could go wrong

- **State machine semantics around loops and `sendBack`** are the most likely source of subtle bugs (an item sent back from a sprint to planning must not reset the project failure budget). Covered by the table-driven tests in step 5 and the failure fixtures in step 10; both must be written before the orchestrator.
- **Budget double-counting on resume** if the idempotency key is not checked before the adapter call. Covered by step 9's double-run test and step 12's ledger equality assertion.
- **Judged gates that pass on vague verdicts.** The citation requirement in the verdict schema is the defence; step 6 tests it, and the skeptic rubric must be written to demand specific objections.
- **Mock fixtures diverging from real model behaviour.** The opt-in contract test in step 7 is the only check; it must be run before each release and is listed in step 13's release checklist.
- **Template YAML becoming a second programming language.** Keep the template schema small (spec 3.2 fields only); anything needing logic goes in code behind a named gate or action, not in YAML.

## Open items

None blocking. GitHub repo name `kishormorol/karigor` is assumed free; step 13 checks.

## First step

Step 1: create the monorepo skeleton with `corepack enable`, workspaces, vitest, and a passing placeholder test.
