# Karigor Build Crew — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-17-karigor-build-crew-design.md`

## Steps

1. `@karigor/profiles`: `Profile` interface, `fixture` profile (scaffold with a package.json whose test script prints Vitest-style JSON from a marker file), `web-app` profile scaffold files and stack guide, `parseTests` for the Vitest JSON reporter. Tests: both profiles scaffold into a temp dir; parse real and malformed outputs.
2. `@karigor/sandbox`: `Workspace` (create from profile, baseline commit, head, commitAll, itemCommits, revertItem, reset) and `LocalSandbox` (tests, lint, build, audit plus secrets scan, checkUrl, diff). Tests on the fixture profile.
3. `@karigor/runtime`: `AgentAdapter`, `MockAgent`, `ClaudeCodeAgent` (headless with tools, allow-list, usage parsing), and `runAgentWorker` for the developer: prompt assembly (item, spec, architecture, stack guide, feedback), reset-before-retry, "no files changed" handling. Offline tests with scripted exec; one live test behind the flag.
4. `@karigor/cli`: wire workspace, profile and agent into `runProject`; change artifact from the diff with the commit hash; revert on park; CLI defaults. Golden path and failure tests with `MockAgent` on the fixture profile. Replay suite extended to the agentic path.
5. Live run on Claude Code with the `web-app` profile; fix what it shows; docs.

## Decisions

- Claude Code as the agent, not the Agent SDK package: it is what the user has and is logged into, and the CLI already exposes tools, permission modes and JSON output.
- Next.js for the web-app profile: the stack Claude is strongest at, free hosting on Vercel hobby or Cloudflare, and the scaffold can be shipped as plain files so no network is needed beyond `pnpm install`.
- Workspace inside the project folder, not a separate location, so the project's own git history and the app's history live side by side and `resume` finds both.

## Risks

- `pnpm install` in the scaffold needs the network and takes a minute; it runs once per project and its failure is a gated, visible phase failure.
- The Bash allow-list syntax for headless Claude Code must be verified with a real call before relying on it.
- Vitest JSON output can be preceded by other text; the parser takes the last JSON object in the output.
