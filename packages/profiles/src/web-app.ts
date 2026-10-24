import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { copyScaffold } from "./copy.js";
import { SCAFFOLDS_DIR } from "./fixture.js";
import type { Profile } from "./types.js";
import { parsePlaywrightJson } from "./playwright.js";
import { parseVitestJson } from "./vitest.js";

export const WEB_APP_STACK_GUIDE = `# Stack guide: web-app

The workspace is a Next.js (App Router) application in TypeScript with Tailwind, Drizzle ORM over SQLite (a local file; Postgres-ready for production), and Vitest. It was scaffolded so that \`pnpm test\`, \`pnpm lint\` and \`pnpm build\` already pass. Keep them passing.

Where things go:
- Pages and layouts: \`app/<route>/page.tsx\`. Server components by default; add \`"use client"\` only for interactivity.
- Server endpoints: \`app/api/<name>/route.ts\` exporting \`GET\`/\`POST\`, or server actions in \`app/<route>/actions.ts\` with \`"use server"\`.
- Database tables: \`src/db/schema.ts\` (one \`sqliteTable\` per kind of thing). Query with the \`db\` export from \`src/db\` in server code only. After changing the schema, run \`pnpm db:generate\` and keep the new file in \`drizzle/\`: \`pnpm build\` applies migrations first, which is how every release, on this computer or hosted, gets its tables. A fresh, empty database must work after \`pnpm build\` alone; never rely on tables created by hand or by tests. The local \`data/app.db\` is disposable: if migrating it fails because it holds tables from earlier attempts, delete it and run \`pnpm build\` again; Karigor's own build check always starts from an empty database.
- The app's own public address is \`process.env.SITE_URL\` (for links in emails and receipts). Every deploy target sets it; never ask the person for it and never list it in \`.env.example\`.
- \`DATABASE_URL\` keeps its local default (\`file:./data/app.db\`) in \`.env.example\`; a hosted address is a setting given at release, not a code change.
- Pure logic (validation, formatting, rules): \`src/lib/*.ts\`. This is where most unit tests belong.
- Tests: \`tests/*.test.ts\` or next to the code as \`*.test.ts\`, run with \`pnpm test\`. Database code takes a \`database\` argument defaulting to \`db\`; tests pass \`await testDb()\` from \`tests/db.ts\` (a fresh in-memory database with every migration).

People, sign-in and roles (already built and tested; build on them, never add a second login. An app without \`src/server/people.ts\` was made from an older template: keep the sign-in it has):
- Tables \`users\`, \`sessions\`, \`login_attempts\`, \`access_links\`, \`activity\`; database functions in \`src/server/people.ts\` (invite, change role, turn access off, one-time links, sign-in, the activity log).
- Roles and permissions live in \`src/lib/access.ts\`: replace the \`member\` role with the system's real roles from the architecture, and list each permission (in the app's words, e.g. \`"take payments"\`) with the roles that have it. \`admin\` keeps "manage people" and "see activity".
- Every signed-in page sits under \`app/(app)/\` (its layout checks sign-in and draws the sidebar) and starts with \`await requirePermission("...")\` (or \`requireUser()\` when every role may see it). Every server action starts with \`await requireAction("...")\`. Hide what a role cannot do with \`can(user, "...")\`, but never rely on hiding: the server checks are what protect data.
- Record what people do that others may need to trace (payments, changes to records, cancellations) with \`logActivity(user.id, "took ৳500 from Rina Akter", "billing")\`.
- Add each section to \`NAV\` in \`src/lib/nav.ts\` with its permission; the sidebar shows each person only what they may open.
- Public pages (a booking form, a parent's lookup) go outside \`app/(app)/\` and are added to \`PUBLIC_PATHS\` in \`src/lib/session-cookie.ts\`.
- The app's name and tagline are in \`src/lib/app.ts\`; set them in the first item.
- People join by a one-time link an admin copies and sends (no email service needed). The first admin's link comes from \`pnpm admin:link <email> "<name>"\`; Karigor runs it for the person.

Browser journeys (Karigor runs them on a brand-new database before every release; a failing journey stops the release. An app without \`playwright.config.ts\` has none):
- \`tests/e2e/*.spec.ts\` with Playwright. Each kind of user's main jobs is a journey: "the receptionist registers a patient and books a visit", "a doctor cannot see the takings". Add or extend one in every item that changes what someone can do in the browser.
- Use the helpers in \`tests/e2e/helpers.ts\`: \`signedIn(page, "receptionist")\` (a new person of that role, already signed in), \`makePerson(role)\` + \`signInAs(page, person)\` (through the real sign-in page), \`openSection(page, "Visits")\` (works on phone and desktop). Create the data a journey needs through the app's own pages or the server functions; never rely on another journey's data.
- Find things the way a person does: \`getByRole("button", { name: "Save visit" })\`, \`getByLabel("Phone", { exact: true })\` (always \`exact: true\` for labels; a search box or filter may contain the same word). Every journey runs twice, at desktop and phone size.
- To run them: \`pnpm build\` then \`pnpm e2e\`. They use \`data/e2e.db\` (delete it to start empty).

How it looks (the "Ledger" look, designed in Claude Design; the person will judge the app by it):
- Build every screen from \`src/components/ui.tsx\` and \`ui-client.tsx\`: signed-in screens get their frame (\`SidebarShell\`) from \`app/(app)/layout.tsx\`; public pages use \`PublicShell\` (\`AppShell\`, a top bar, is for very small apps with one role); then \`PageHeader\`, \`Card\`, \`ListRow\` (with its \`status\`, \`amount\` and \`action\` slots), \`Amount\`, \`Stat\`/\`StatGrid\`, \`Badge\`, \`Alert\`, \`EmptyState\`, and \`FormStack\` with \`Field\` + \`Input\`/\`Select\`/\`Textarea\` and \`Button\`/\`ButtonLink\`. Do not hand-style raw buttons, inputs or page frames; add a component to \`ui.tsx\` when one is missing, in the same style.
- Colours come from the theme in \`app/globals.css\` (\`bg-primary\`, \`text-muted\`, \`text-owed\`, \`bg-paid-tint\`, ...), never raw hex or Tailwind's default palette. One primary action per screen; red and green only for money and status (owed, paid), with words as well as colour.
- Money is shown with \`<Amount value={...} tone="owed" />\` (or \`money()\` inside text): ৳1,500. Every list has an \`EmptyState\`; every form shows success or errors with \`Alert\` and per-field \`error\`s.
- Mobile first: check that each page reads well at phone width; touch targets stay at least 44px (the components do this).

Systems (many sections, many roles): the signed-in layout uses \`SidebarShell\` (sidebar on wide screens, a Menu on phones). Also in the kit:
- \`DataTable\` (from \`@/components/ui-client\`): any list that grows. Pass plain rows and columns (\`format: "money" | "number" | "date" | "datetime"\`, \`filter: true\` for a filter select, \`badge: { Paid: "paid", Due: "owed" }\`), and \`rowHref\` naming the row field with its link. It searches, filters, sorts and pages by itself; on a phone each row is a card.
- \`Tabs\` (views of one thing as links), \`Dialog\` (a short form or confirmation over the page), \`CopyField\` (a link to pass on), \`SubmitButton\` (disables itself while saving), \`DateRangeFields\` (from/to for reports), \`SimpleTable\` (a small fixed table, e.g. a receipt).
- Dashboards: \`StatGrid\` of \`Stat\`s for the headline numbers, then \`BarChart\` (compare a few named things), \`LineChart\` (change over time), \`DonutChart\` (parts of a whole, five at most), each with \`unit="money"\` where it is money. Each role's home page shows what that role needs first today.
- Exports: \`toCsv\` and \`csvResponse\` from \`src/lib/csv.ts\` in a \`GET\` route (\`app/(app)/<section>/export/route.ts\`) that checks the permission first.
- \`money()\` shows paisa when there are any (৳62.50) and whole taka otherwise (৳1,500); \`number()\` formats counts.

Conventions:
- Every backlog item adds or changes tests for its acceptance criteria; test pure logic directly and route handlers by calling the exported function with a \`Request\`.
- Forms work without JavaScript first (server actions), then get enhanced.
- \`app/api/health/route.ts\` is how deployments know the app is up. Keep it answering 200 and cheap; do not make it depend on the database.
- Never hard-code secrets. Read configuration from \`process.env\` and document new variables in \`.env.example\`: a comment line saying what it is in plain words (the person may read it), then a line \`# karigor: generate\` (a secret nobody needs to know, such as a signing key; Karigor makes one), \`# karigor: ask\` (a choice only the person can make, such as a passcode; Karigor asks them using your comment as the question), or \`# karigor: service <name>\` (a connection to an outside service with its own account; the person creates that account themselves, so never write that Karigor sets it up), then \`NAME=\` with an empty value. Start the comment with "Optional:" when the app works without it.
- Mobile first: layouts must read well on a phone; use Tailwind's responsive classes.
- Keep dependencies to what is already installed unless an item truly needs more; if you add one, say why in your summary.
- Do not touch files unrelated to the item. Do not reformat the whole project.

Finish an item by running \`pnpm test\` and \`pnpm lint\` and fixing anything that fails; when the item changed pages, also \`pnpm build\` and \`pnpm e2e\`.
`;

export const webApp: Profile = {
  name: "web-app",
  description: "Next.js + TypeScript + Tailwind + Drizzle (SQLite locally) + Vitest. Free to run and to host.",
  scaffold: (dir) => copyScaffold(join(SCAFFOLDS_DIR, "web-app"), dir),
  commands: {
    install: ["pnpm", "install", "--silent"],
    test: ["pnpm", "test"],
    lint: ["pnpm", "lint"],
    build: ["pnpm", "build"],
    // What ships to users: build-time tooling (linters, test runners) never runs in the live app.
    audit: ["pnpm", "audit", "--prod", "--json", "--audit-level", "high"],
    start: ["pnpm", "start"],
    e2e: ["pnpm", "e2e"],
    e2eInstall: ["pnpm", "exec", "playwright", "install", "chromium"],
  },
  // Apps built from a template before journeys existed have no e2e script; their gate passes saying so.
  hasJourneys: async (dir) => {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8").catch(() => "{}")) as { scripts?: Record<string, string> };
    return Boolean(pkg.scripts?.e2e);
  },
  parseJourneys: parsePlaywrightJson,
  capabilities: {
    can: [
      "Work in a browser on phones and computers",
      "Sign-in for many people, with roles and what each may see and do; invitations by one-time link",
      "An activity log of who did what",
      "Forms, searchable and sortable lists, records with money and stock",
      "Dashboards with charts, and CSV export for spreadsheets",
      "Password-reset emails, once the person has a free Resend account",
    ],
    notYet: [
      "File uploads (photos, documents)",
      "Jobs that run on a schedule by themselves (a reminder every morning)",
      "Sending SMS or WhatsApp messages",
      "One installation serving several separate organisations, each with its own data",
    ],
  },
  healthPath: "/api/health",
  localSettings: { DATABASE_URL: "file:./data/app.db" },
  parseTests: parseVitestJson,
  stackGuide: WEB_APP_STACK_GUIDE,
};
