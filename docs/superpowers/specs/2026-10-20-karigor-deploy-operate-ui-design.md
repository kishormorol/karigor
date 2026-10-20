# Karigor — Deploy, Operate, Maintain, and the Chat UI (sub-projects 4, 5 and 6 of 6)

Date: 2026-10-20
Status: written to finish the roadmap; decisions below were made without questions, in the spirit of the assumption ledger
Depends on: kernel (1), build crew (3)

## 1. Goal

Close the loop. After the build crew, the code sits finished in a workspace and the release gate fails honestly. This document takes it the rest of the way:

- **4. Deploy and operate.** The release phase deploys the real workspace to a preview, checks it over HTTP, verifies that a rollback works, then promotes it to production. A failed promotion rolls back on its own and files a work item.
- **5. Maintenance loop.** Production signals (the site is down, an error in its logs, a vulnerable dependency, a message from the person) become `work-item` artifacts. A released project with open work items re-enters the kernel under the `maintenance` template, which triages, fixes, verifies and releases again.
- **6. The person's interface.** A phone-friendly, chat-first web UI over the same kernel, a Docker image that self-hosts it, and two more model paths: Ollama (local, free) and any model adapter acting as a developer.

Done when:
- `karigor new "<idea>" --run` on a real adapter ends `finished` with a production URL, on the zero-dollar `local` target with no account, or on Vercel's free tier with a token.
- `karigor feedback <id> "..."` (or a failed health check, or an error in the served app's log) on a finished project produces a work item, and `karigor watch`/`serve` runs a maintenance cycle that ships a new release.
- `docker compose up` serves the chat UI; a person types an idea on a phone and watches it get built.

## 2. Principles carried over

Zero-dollar path (the `local` deploy target needs no account; Ollama needs no key); cost is a gate (maintenance cycles get their own budget slice and go through the same checks); no technical questions (the person only ever writes about their product: the idea, a correction, feedback); mistakes caught by gates (nothing goes live without a healthy preview and a verified rollback, and a promotion is verified after it happens); everything replayable (signals, maintenance cycles and corrections are events).

## 3. Sub-project 4: deploy and operate

### 3.1 `@karigor/deploy`

```ts
interface DeployAdapter {
  readonly name: string;                       // "local", "vercel", "fake"
  describe(): string;                          // plain words: where it lives, how to open it
  preview(r: DeployRequest): Promise<DeployResult>;
  promote(r: DeployRequest & { preview: DeployResult }): Promise<DeployResult>;
  rollback(r: { dir: string }): Promise<CommandResult>;
  verifyRollback(r: { dir: string }): Promise<CommandResult>;
  checkUrl?(url: string): Promise<UrlCheck>;   // when a target needs more than a GET (protection)
  ensure?(record): Promise<void>;              // bring a preview back after a crash
  stop(): Promise<void>;                       // stop anything it started
}
```

`DeployRequest` is `{ dir, version, commit, key }` where `dir` is the workspace. Versions are `r<n>-<sha7>`, `n` counting production releases.

Three adapters:

- **`local`** (the default, no account): each release is a clean export of the workspace commit into `<project>/releases/<version>/`, installed and built with the profile's commands. A preview is that release started with the profile's new `start` command on a free port and polled on the profile's `healthPath` until it answers. Promotion moves `<project>/releases/current.json` to that version; `karigor serve` runs whatever is current on a fixed port. Rollback moves the pointer back (or takes it offline for the first release). Verifying a rollback starts the previous release on a spare port, checks its health, and stops it; for a first release, going offline always works and is reported as such. Old releases beyond the last three are deleted. `releases/` is ignored by the project's own git.
- **`vercel`** (free hobby tier, needs `VERCEL_TOKEN` in the environment; the token is referenced by name, never stored): `vercel deploy <workspace> --yes --project <slug>` for a preview, `vercel promote` and `vercel rollback` for the rest. Environment variables named in `KARIGOR_DEPLOY_ENV` (default `DATABASE_URL,DATABASE_AUTH_TOKEN`) are passed through from the host, so a free Turso database works with the web-app profile's libsql client. Previews behind Vercel Authentication are checked with `vercel curl`. Verifying a rollback means the previous production deployment still answers.
- **`fake`**: scripted, for tests and the demo.

### 3.2 Profiles

`Profile` gains `commands.start` (run with `PORT` set) and `healthPath`. `web-app`: `pnpm start`, `/api/health` (already in the scaffold). `fixture`: a twenty-line Node HTTP server (`serve.mjs`) that fails its health check when a `health-fail` marker exists, so the whole deploy path is tested offline with a real server.

### 3.3 Orchestrator

- `runProject` takes `deploy?: DeployAdapter`. With one, the `releaser` step first deploys a preview of the workspace HEAD (code, not tokens) and registers a `deploy-record` (`environment: preview`, `status: deployed | failed`, the adapter's output in the body, `key` and `commit` in the meta). The releaser then only writes the summary; the deploy record it would have described is the real one.
- `preview-healthy` reads that record; before it runs, `ensure` restarts a local preview that a crash took down. `rollback-verified` goes through `LocalSandbox.verifyRollback`, which now delegates to the adapter.
- On the `release -> done` transition the orchestrator promotes. Success: a production `deploy-record`, a workspace tag `karigor-release-<version>`, and a fresh `summary` carrying the production URL. Failure: the adapter rolls back, a `rolled-back` record and a critical `work-item` are written, and the project stops with a plain reason ("the new version failed after going live; the previous version is back"). Promotion is keyed by the preview record, so a resumed run never promotes twice.
- The adapter is stopped when `runProject` returns or throws.

## 4. Sub-project 5: the maintenance loop

### 4.1 State

- `work-item` gains `fingerprint` (dedupe key) and `title`.
- New events:
  - `signal-received { workItemId, source, severity, fingerprint }` registers a work item as open.
  - `maintenance-started { cycle, template, workItemIds }` switches the project to the `maintenance` template, sets it running, clears the current phase entry, and resets the per-cycle failure counters (project failures, phase failures, downgraded phases) so an old build's failures do not exhaust a new cycle. Phase entry counts are kept, so every scope key stays unique across cycles.
  - `assumption-corrected { assumptionId, correctedTo, ledgerId }` records a correction from the person.
- On `project-finished`, every work item in the current cycle becomes `done`. Work items live in `state.workItems`; the artifact's own `status` is the status at creation.

### 4.2 Budget

Starting a cycle estimates the `maintenance` template at the project's tier and adds its phase budgets to the ledger under cycle-scoped names (`m1:triage`, `m1:build`, `m1:release`); spending in a cycle is booked against those, so the first build's spending never starves a fix.

### 4.3 Triage and identity

The planner in `triage` sees the open work items from state. Backlog ids that collide with items from earlier cycles are renamed deterministically (`m<cycle>-<id>`, dependencies re-pointed), so a new `b1` is never mistaken for a finished one.

### 4.4 Operate (`@karigor/cli`, `operate.ts`)

It lives in the CLI package because it drives `runProject`; a separate package would depend on the CLI and the CLI on it.

- **Signals**: `checkHealth(url)` (two failures in a row is downtime, critical), `auditDependencies(sandbox)` (high and critical advisories, one signal per package), `errorSignals(lines)` (error lines from the served app's output, normalised so the same error with different numbers is one signal), and feedback from the person (medium).
- `recordSignals(store, signals)` writes a work item per new fingerprint; a fingerprint that is already open is ignored.
- `startMaintenance(store, templates, adapter)` begins a cycle when the project is finished and has open work items.
- `operateOnce(...)` = collect, record, and if a cycle should start, run it to the end (preview, gates, promote).

### 4.5 CLI

- `karigor feedback <id> "<text>"`: the person's words become a work item.
- `karigor fix <id>`: start a maintenance cycle on open work items now.
- `karigor watch <id> [--every 10m]`: health of the production URL, dependency audit, then maintenance when needed. `--every` loops.
- `karigor serve <id> [--port 3000]`: for the `local` target, run the current release, collect error signals from its output, watch on an interval, and swap to the new release after a maintenance cycle promotes one.

## 5. Sub-project 6: the person's interface

### 5.1 Models

- **`ollama`** model adapter: Ollama's `/api/chat` with `format` set to the role's JSON schema, `stream: false`, temperature 0. Models from `KARIGOR_OLLAMA_MODEL` (default `qwen2.5:7b`) and `OLLAMA_HOST`. Ids are `ollama/<model>`, which the budget already treats as free.
- **`ModelAgent`**: any model adapter as a developer. It shows the model the item, the stack guide, the workspace's file list and the contents of the source files that fit a size cap, asks for whole-file writes and deletions (structured output), and applies them inside the workspace, refusing paths outside it or inside `.git` and `node_modules`. It does not run commands; the gates run the tests. This makes `--adapter claude` (API key) and `--adapter ollama` real builders, not just thinkers.

### 5.2 `@karigor/server` and the chat UI

- A dependency-free Node HTTP server over the kernel: create a project from an idea, run it in the background, list projects, read a project's state as plain-language JSON, stream its story over Server-Sent Events, send feedback, correct an assumption, resume.
- The UI is one HTML page, no build step: a chat thread where the person's idea is the first message and Karigor's progress arrives as short plain-language messages; decision cards with a "that's not right" correction; a cost chip; a final card with the link. The input box changes meaning with the state: an idea before a project exists, feedback after. Mobile first, light and dark.
- Access: if `KARIGOR_TOKEN` is set, every API call needs it (bearer header or a cookie set from `?token=`). Bring-your-own-key: an Anthropic key sent with a request is held in memory for that run only and never written anywhere.
- Binds to `127.0.0.1` unless told otherwise; the Docker image binds to `0.0.0.0`.

### 5.3 Docker self-host

`Dockerfile` (Node 22, git, pnpm, the built monorepo; projects in the `/data` volume) and `docker-compose.yml` with an optional Ollama service. The container has no Claude Code login, so it defaults to Ollama, or to the Anthropic API when `ANTHROPIC_API_KEY` is set.

## 6. Error handling

- A preview that will not start or answer: a failed deploy record with the adapter's output; `preview-healthy` fails; the release ladder retries and then stops with the reason.
- A promotion that fails its health check: automatic rollback, a critical work item, a plain stop reason. The next `watch` or `fix` picks the work item up.
- A flapping site: one failed check is not downtime; two in a row is.
- Duplicate signals: deduped by fingerprint while open.
- A maintenance cycle that cannot fix the problem: the maintenance template's own ladder parks the item or stops; the work item stays open, and the stop reason is shown.
- Server crashes mid-run: projects are event logs; `resume` from the UI or CLI continues.

## 7. Testing

- `local` deploy on the fixture profile with real HTTP servers: preview, health failure, promotion, rollback, verify rollback with and without a previous release, pruning, `ensure` after a stop.
- `vercel` with a scripted exec: argument shapes, URL parsing, protected previews through `vercel curl`, token missing.
- Orchestrator: fixture + `MockAgent` + `local` deploy ends `finished` with a production record and a summary URL; a failing health check walks the release ladder; a promotion failure rolls back and files a work item; crash at any event during release resumes without promoting twice.
- Maintenance: finished project + feedback -> cycle 1 -> new release `r2`; ids renamed; budgets per cycle; failures reset; replay of the whole history.
- Operate: health flapping, error normalisation, audit parsing, dedupe.
- Runtime: Ollama adapter against a scripted fetch; `ModelAgent` path guards and file application.
- Server: API on the demo adapter end to end; token enforcement; SSE stream.
- Opt-in live checks: Ollama structured output (`KARIGOR_REAL_MODEL=1`), local deploy of the real web-app scaffold (`KARIGOR_REAL_DEPLOY=1`).

## 8. Out of scope

A public hosted instance (running it is an operator's choice; the code and image are here), accounts and multi-tenant isolation, paid deploy targets, Cloudflare and Netlify adapters, log drains from Vercel, a competitor survey and a Claude Design pass on the UI (the UI here is a sound first version to iterate on).

## 9. Addendum (20 October 2026): settings the live app needs

The first real run produced an app that went live but could not work: it needed a family passcode, a signing secret and a hosted database that nobody had set. Settings now have a kind, so no question is ever technical:

- **generate**: a secret nobody needs to know (a signing key). Karigor makes 32 random bytes and stores them before the preview, so the preview can run.
- **ask**: a product choice only the person can make (a passcode). The developer's comment in `.env.example` is the question, in plain words.
- **service**: a connection to an outside service with its own account (a hosted database). The person creates the account and pastes what it gives them; Karigor never creates accounts.

The developer states the kind in `.env.example` with a `# karigor: generate|ask|service <name>` line (the stack guide asks for it); without one it is guessed from the name and comment. Values are stored only where the app reads them: Vercel sensitive environment variables for production and previews (sent on stdin, never as arguments), or `<project>/run/settings.json` (mode 0600, ignored by git) for the local target. The event log records `settings-provided` with names only. After the person provides settings (`karigor setup`, or the chat UI's form), the live release is rebuilt to pick them up (Vercel `redeploy`, then the same wait-until-live as promotion; locally, `serve` restarts it) and a fresh production record says what, if anything, is still missing.
