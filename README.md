# Karigor

**Karigor** (Bangla: *craftsperson*) is free, open-source software in which a team of AI agents takes an idea from a person with no technical knowledge all the way to deployed, maintained software. After the idea and a one-time budget choice, no human is involved. Nobody is ever asked a technical question.

Plenty of tools generate code from a prompt. Karigor is different in two ways:

1. **It owns the whole lifecycle.** Specify, design, plan, build, verify, release, and then watch production and fix what breaks. Not "here is a repo, good luck."
2. **Reliability comes from process, not trust.** A small, deterministic kernel runs a real software process (sprints, phase gates, a skeptic who can only object) and no step moves forward without mechanical evidence: tests green, security scan clean, a healthy preview, a verified rollback. Agents will make mistakes; the gates stop them reaching you.

It is designed to cost nothing to try. Every step has a zero-dollar path (local models, free hosting tiers), cost is a gate rather than a surprise, and the system asks you to pick a budget tier exactly once.

## Status

Early. Sub-project 1 of 6, the **kernel**, is complete and tested:

| Package | What it does |
|---|---|
| `@karigor/store` | Typed artifacts (spec, backlog, test reports, gate results, cost ledger...) and an append-only event log that is the single source of truth. Crash anywhere; `resume` replays to the exact state. |
| `@karigor/process` | Declarative process templates (`iterative`, `linear`, `spike-then-build`, `maintenance`) and a pure state machine with failure ladders: retry, send back, shrink, park, stop. |
| `@karigor/gates` | Mechanical gates (tests, lint, build, security scan, preview health, rollback) and judged gates (reviewer and skeptic with rubrics). A judged verdict with no citations is a fail. |
| `@karigor/runtime` | Role prompts and output schemas, a worker runner (schema rejection, retry with the error quoted, tier escalation), and model adapters: Claude Code headless (no key), the Anthropic API via structured outputs, and a free mock. |
| `@karigor/budget` | Prices, a three-tier estimate (free, cheap, best), a running meter, and the overspend ladder: downgrade the model, then park optional work, then stop. Never silent. |
| `@karigor/cli` | `karigor new`, `run`, `resume`, `status`, `cost`, `explain`, `park`, `unpark`. Plain language throughout. |

What the kernel does **not** do yet: talk to a real sandbox (the developer's code is recorded but not executed), deploy anywhere, or watch production. Those are sub-projects 3 to 5. The `releaser` is honest about it: with no deploy adapter, the release gate fails and the project stops with the reason.

## Try it in two minutes, free

```sh
git clone https://github.com/kishormorol/karigor
cd karigor
npm install -g pnpm   # if you do not have it
pnpm install && pnpm build
node packages/cli/dist/bin.js new "A site where neighbours lend each other tools" --adapter demo --run
```

The `demo` adapter is a scripted mock: no model, no cost, the whole process runs end to end so you can watch the kernel work. Then:

```sh
node packages/cli/dist/bin.js status <projectId>
node packages/cli/dist/bin.js explain <projectId>
node packages/cli/dist/bin.js cost <projectId>
```

To run with real models you do **not** need an API key. If you have [Claude Code](https://claude.com/claude-code) installed and signed in, just drop `--adapter demo`: the default `claude-code` adapter drives Claude Code in headless mode under your own login. Calls cost nothing extra on a subscription, so the default tier is `best`; the cost meter still shows what the same calls would have cost on the pay-per-token API.

```sh
node packages/cli/dist/bin.js new "..." --run                       # Claude Code login, no key
node packages/cli/dist/bin.js new "..." --adapter claude --run      # Anthropic API key in ANTHROPIC_API_KEY
```

Projects live in `~/.karigor/projects` (override with `KARIGOR_ROOT`).

## How it works

```
idea ──▶ selector picks a process template and a target profile
     ──▶ estimator offers three cost tiers; you pick once
     ──▶ state machine runs the template:
            phase roles produce artifacts  (product-owner, architect, planner, developer, releaser)
            every transition needs gates    (mechanical evidence or a cited judged verdict)
            failures walk a ladder          (retry → send back / shrink → park / stop)
     ──▶ released; the maintenance template takes over on production signals
```

Everything is an event in `events.jsonl` and a Markdown artifact with JSON frontmatter, committed to git inside the project directory. `karigor explain` turns the log into a story.

The design is documented in [`docs/superpowers/specs/2026-10-16-karigor-kernel-design.md`](docs/superpowers/specs/2026-10-16-karigor-kernel-design.md) and the build plan in [`docs/superpowers/plans/2026-10-16-kernel-plan.md`](docs/superpowers/plans/2026-10-16-kernel-plan.md). Writing a process template is explained in [`docs/templates.md`](docs/templates.md).

## Roadmap

1. ~~Kernel~~ (this)
2. Intake: idea to spec with an assumption ledger, no questions asked
3. Build and verify crews in a real sandbox; first target profile: full-stack web app
4. Deploy and operate: free-tier targets, previews, rollback
5. Maintenance loop: production signals become work items
6. Hosted, phone-friendly chat UI, plus Docker self-host; local models through Ollama

## Development

```sh
pnpm install
pnpm test        # unit, golden-path, failure and crash-replay suites; all on the mock adapter, zero cost
pnpm typecheck   # builds every package in dependency order
KARIGOR_REAL_MODEL=1 pnpm test packages/runtime   # two small live calls through your Claude Code login (and the API if a key is set)
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0
