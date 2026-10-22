# Karigor — Growing systems: stages, people and roles, journeys, a bigger kit

Date: 2026-10-22
Status: approved by the person ("yes", after the proposal in chat); details decided without questions, in the spirit of the assumption ledger
Depends on: kernel (1), build crew (3), deploy and operate (4–6)

## 1. Goal

Every app Karigor has built so far is small, and not because the pipeline cannot do more: the planner is told to build the first release only, at most 15 items, and to list everything else under "Later", which nothing ever builds. Feedback adds features one at a time, but nothing plans a system. This document lets Karigor build a management system (a clinic, a school, a shop with staff) from one paragraph:

- **A. Stages.** The product owner splits the idea into ordered stages. Stage 1 is built as today; then `karigor grow` builds the next stage on top of the live app, with its own design update, plan, build, checks and release. Between stages the person tries the app and can steer with feedback; `--all` builds every stage without stopping.
- **B. People and roles in the template.** Every web app starts with working sign-in for many people: users with roles, a permission check on every page and action, invitations by link, password resets by link, and an activity log. Built and tested once in the scaffold instead of reinvented, slightly differently, by every app.
- **C. Journeys as a release gate.** Browser tests (Playwright) of each kind of user's main journeys, written by the developer as part of each item, run against a freshly built app on an empty database before anything is released.
- **D. A kit for systems.** A sidebar layout for many sections, a data table (search, filter, sort, pages), tabs, dialogs, simple charts, and CSV export, in the Ledger look.
- **E. A living architecture.** The architect names the system's modules and roles, and revises them at every stage; each backlog item names its module, and the developer is shown that module's part of the design.

Done when:
- A one-paragraph idea for a small clinic (receptionist, doctor, accountant, owner) is built in stages with `karigor new ... --run` then `karigor grow ... --all`, every stage released through the usual gates plus the journeys gate.
- Each role signs in and can do its own job and nothing else, verified in a real browser.
- The owner's dashboard shows totals and a chart, and lists that grow can be searched, sorted and paged.

Not in this round (recorded as "Later"): file uploads, scheduled jobs, SMS, multi-organisation hosting. CSV export is in.

## 2. Principles carried over

The person is never asked a technical question; a stage is described in their words ("Billing: the accountant takes payments and prints receipts"). Cost is a gate: each stage gets its own budget slice at the project's tier, like a fix round. Everything is an event and replays. Nothing ships without evidence; the journeys gate adds evidence that the app works for each role as a whole, which unit tests cannot show.

## 3. A. Stages

### 3.1 The spec carries the stages

`ProductOwnerOutput` and `SpecMeta` gain:

```ts
stages: { id: string; name: string; goal: string; featureIds: string[] }[]   // ordered; at least 1
```

The product owner's prompt changes from "the first release should be small and real" to: plan the whole product the idea describes, then split it into stages. Stage 1 is the smallest version a real person can use end to end (the walking skeleton plus the core job). Each later stage adds one coherent area someone would recognise ("Billing", "Reports"), is useful on its own, and depends only on earlier stages. Every `must` and `should` feature belongs to exactly one stage; `could` features may be left out. A small idea has one stage; nothing is split for its own sake. Old specs without `stages` read as one stage holding every feature (schema default), so existing projects are unchanged.

### 3.2 The planner plans one stage

The planner is shown the stage being built (`ctx.stage`) and plans only its features: at most 15 items per stage. Items from earlier stages are context ("already built"), as in a fix round. The 15-item cap stays: it is what keeps each build reviewable; a system is simply more stages.

### 3.3 State and events

```ts
ev("stage-started", { cycle: number; stageId: string; template: string })
```

Applied like `maintenance-started` (fresh failure budget, phase entry cleared, status running) and also sets `state.stage = stageId`. `state.stagesBuilt: string[]` gains the current stage on `project-finished` (stage 1 is the spec's first stage, recorded when the first build finishes). Cycles are shared with fix rounds: a stage is cycle n like any other, so budget slices (`m<n>:<phase>`), item id prefixes and scope keys need no new rules. Open work items (feedback) at the start of a stage are taken on by the stage too, so a stage also clears what the person asked for since the last release.

### 3.4 The `stage` template

```
design   (architect: revise the architecture for this stage)      gates: architecture-sound, skeptic-review
plan     (planner: this stage's items)                             gates: skeptic-review
build    (loop: developer; tests-pass, lint-clean, diff-matches-spec, skeptic-review; 3 per sprint)
         exit: build-succeeds, security-scan-clean, journeys-pass  → sendBack to plan once
release  (releaser)                                                gates: preview-healthy, rollback-verified
done
```

The releaser's summary for a stage says what the stage added, like a maintenance release.

### 3.5 Commands

- `karigor grow <id>`: when the project is finished and a stage remains unbuilt, start the next stage and run it to the end. `--all` keeps going until every stage is built or something stops it. Without a remaining stage it says the product is complete and points to `feedback`.
- `karigor status` lists the stages: built, being built, still to come.
- `serve` and `watch` never start a stage on their own (stages are the person's call; they cost the most).
- The chat UI gets a "Build the next part" button on a finished project with stages left.

## 4. B. People and roles in the web-app template

The scaffold gains a complete, tested multi-user sign-in, adapted from the code the grocery build produced (scrypt hashes, hashed session tokens, login throttling, same-origin checks on actions):

| Piece | Where |
|---|---|
| Tables `users` (id, name, email, role, password hash, active), `sessions`, `login_attempts`, `access_links` (invite and reset tokens, hashed, one use, expiry), `activity` (who did what, when) | `src/db/schema.ts`, first migration |
| Roles and what each may do: `ROLES`, `PERMISSIONS`, `can(user, permission)` | `src/lib/access.ts` (pure, the file each app edits) |
| Passwords, sessions, links, `requireUser()`, `requirePermission(p)`, `requireAction(p)` for server actions, `logActivity()` | `src/server/auth.ts` |
| Early redirect when there is no session cookie (never touches the database) | `middleware.ts` |
| Pages: `/login`, `/logout`, `/welcome/[token]` (set a password from an invite or reset link), `/team` (list people, invite with a role, change a role, turn off access, make a reset link), `/activity` (owner and admin) | `app/` |
| First admin: `pnpm admin:link <email> [name]` creates the admin if there is none and prints a one-time link to set a password | `scripts/admin-link.ts` |

No email service is needed: invitations and resets are links the admin copies and sends however they like (WhatsApp, SMS). An app that wants email adds it as a setting later.

The template ships two roles, `admin` (everything, including people and the activity log) and `member`; each app's architect replaces `member` with the system's real roles and the developer fills `PERMISSIONS`. Apps that need no sign-in (a public form) leave their public pages outside the signed-in layout; the middleware's public list is in one place.

Karigor gives the person their first link: `karigor admin-link <id> <email> [name]` runs the release's `admin:link` script with the live app's settings and prints the link. The release summary tells the person to run it.

## 5. C. Journeys as a release gate

The scaffold gains Playwright: `@playwright/test` as a dev dependency, `playwright.config.ts`, `tests/e2e/` with a `signIn(page, role)` helper that creates a user of that role directly in the test database, and one journey (an admin signs in, invites a member, the member sets a password from the link and signs in). `pnpm e2e` builds nothing itself; it starts `next start` on a free port against `data/e2e.db`, migrated fresh, via Playwright's `webServer`.

Developers write a journey for each item that changes what a person can do in the browser (stack guide: "each kind of user's main job is a journey"). Item gates stay unit tests and lint (fast); the new mechanical gate `journeys-pass` runs at the end of a build phase: it removes `data/e2e.db`, runs `pnpm build` and `pnpm e2e`, and fails with the failing journeys' names and errors, so the planner's send-back adds fix items exactly as for a failed build. The browser is installed once per machine (`playwright install chromium`) by the gate itself, outside the developer's sandbox; Docker images install it at image build. A profile without an `e2e` command passes the gate with "no journeys for this kind of software".

`journeys-pass` joins the exit gates of the `iterative`, `stage` and `maintenance` build phases (`linear` too, before verify).

## 6. D. A kit for systems

Added to `src/components/ui.tsx` (server-safe) and `src/components/ui-client.tsx` (interactive), all in the Ledger tokens:

- `SidebarShell`: brand, grouped navigation with an active item, the signed-in person and a sign-out button; a sidebar on wide screens, a top bar with a menu button on phones. `AppShell` stays for small apps.
- `DataTable` (client): columns with labels, alignment and optional formatter; search box; a filter select per chosen column; click-to-sort headers; pages of 20; an empty state; rows as links when given an `href`. Data comes from the server as plain rows.
- `Tabs` (links with an active tab, so they work without JavaScript), `Dialog` (native `<dialog>` with a trigger button), `DateRangeFields`.
- Charts in plain SVG, no library: `BarChart`, `LineChart`, `DonutChart` with a legend and an accessible table fallback; colours from the theme (primary, then muted steps), never more than five series.
- `toCsv(rows, columns)` in `src/lib/csv.ts` and the convention of a `GET` route that returns `text/csv` with a download name.

The stack guide documents when to use `SidebarShell` (more than five sections, or more than one role) and that dashboards are built from `StatGrid` plus charts plus `DataTable`.

## 7. E. A living architecture

`ArchitectOutput` and `ArchitectureMeta` gain (both default to empty, so old artifacts still read):

```ts
roles:   { name: string; does: string; can: string[] }[]                   // people who use the system
modules: { id: string; name: string; purpose: string; roles: string[]; data: string[]; pages: string[]; stage: string }[]
```

The architect is shown the previous architecture (when there is one) and the stage being built, and returns the whole revised architecture: earlier modules unchanged unless the stage changes them. `architecture-sound`'s rubric adds: every role in the spec has a module it works in; every module of this stage serves a feature of this stage.

`PlannerItem` gains `moduleId?`. The developer's input shows the item's module in full and the other modules as one line each, instead of the whole architecture body once it is long.

## 8. Changes by package

| Package | Change |
|---|---|
| store | `SpecMeta.stages`, `ArchitectureMeta.roles/modules`, `BacklogItem.moduleId`, event `stage-started`, state `stage` and `stagesBuilt` |
| process | template `stage.yaml`; `journeys-pass` in the build exits of `iterative`, `linear`, `maintenance` |
| runtime | product-owner, architect, planner prompts and schemas; stage-aware inputs; developer sees its module |
| gates | mechanical `journeys-pass` (sandbox `e2e()`) |
| sandbox | `e2e()`: fresh e2e database, build, run, parse Playwright's JSON report; installs the browser once |
| profiles | scaffold: multi-user sign-in, Playwright, kit additions, `admin:link`, CSV; stack guide; `commands.e2e` |
| cli | `grow [--all]`, `admin-link`, stages in `status` |
| server | "Build the next part" button |

## 9. Testing

Unit and golden-path tests on mocks for: stage events and replay; `grow` starting the right stage, refusing when none is left, `--all` walking every stage; the planner input showing only the current stage; old specs reading as one stage; the `journeys-pass` gate on a fixture profile (pass, fail with names, no e2e command). The scaffold's own tests cover `can()`, passwords, sessions, links and throttling; its journey covers invite and sign-in; `KARIGOR_REAL_DEPLOY=1` runs the scaffold's build and journeys for real.

Then the real proof: the clinic idea, built on a Claude Code login, every stage, each role checked in a real browser.
