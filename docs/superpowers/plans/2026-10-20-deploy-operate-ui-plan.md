# Karigor Deploy, Operate, Maintain and UI — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-20-karigor-deploy-operate-ui-design.md`

## Steps

1. `@karigor/store`: deploy-record `key`/`commit`/`releaseId`; work-item `title`/`fingerprint`; events `signal-received`, `maintenance-started`, `assumption-corrected`; replay rules (`workItems`, `cycle`, per-cycle resets, cycle items done on finish). Tests.
2. `@karigor/profiles`: `commands.start`, `healthPath`; fixture `serve.mjs`; web-app ignores `.vercel`. Tests.
3. `@karigor/deploy`: `DeployAdapter`, `FakeDeploy`, `LocalDeploy` (release export, install, build, start, health poll, pointer, rollback, verify, prune, ensure, stop), `VercelDeploy` (scripted exec). `@karigor/sandbox`: `LocalSandbox` delegates rollback and URL checks to a deploy adapter; `Workspace.tag`. Tests on the fixture with real servers.
4. `@karigor/runtime`: releaser uses the real deploy record; planner sees open work items from state and gets collision-free ids; `OllamaAdapter`; `ModelAgent`. Tests.
5. `@karigor/cli`: deploy in the release phase, promotion on `release -> done`, rollback and work item on failure, cycle-scoped budgets, stop the adapter on exit; `--deploy local|vercel`. Golden path, failures, crash replay through release.
6. Operate (`operate.ts` in `@karigor/cli`, which it drives): signals, dedupe, `startMaintenance`, `operateOnce`; CLI `feedback`, `fix`, `watch`, `serve`. Full loop test: released, feedback, cycle, `r2`.
7. `@karigor/server`: API, SSE, token, BYOK, the chat page; `Dockerfile`, `docker-compose.yml`. API tests on the demo adapter.
8. Live checks (Ollama structured output, local deploy of the real web-app scaffold), README, templates doc, CI.

## Decisions

- **`local` as the default target.** It is the only target that needs no account, so it is the zero-dollar path. "Production" on `local` means `karigor serve`, which is honest about what a laptop can do; Vercel is the first hosted target because the web-app profile is Next.js.
- **Promotion is done by the orchestrator, not a gate.** Gates must not have side effects. The promotion is verified by the adapter and failure is handled in code with a rollback, matching the kernel spec's "failed promotion auto-rolls back and files a maintenance work item".
- **Per-cycle resets live in replay.** `maintenance-started` resets failure counters as a pure fold, so a resumed maintenance run is identical to an uninterrupted one.
- **Server without a framework.** Node's `http` module and one HTML file keep the self-host image small and the dependency audit clean.

## Risks

- Next.js `start` needs a production build per release; on `local` this is a minute per release. Acceptable for a laptop; the build is reused from the preview for promotion.
- `vercel` CLI output formats change between versions; URL parsing falls back to the last `https://` URL in the output, and the live path is opt-in.
- Small local models produce weaker specs and code; the gates catch it, and the person sees parked items rather than broken releases.
