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
- Tests: \`tests/*.test.ts\` or next to the code as \`*.test.ts\`, run with \`pnpm test\`.

How it looks (the "Ledger" look, designed in Claude Design; the person will judge the app by it):
- Build every screen from \`src/components/ui.tsx\`: \`AppShell\` (signed-in screens, with the main navigation) or \`PublicShell\` (public pages), then \`PageHeader\`, \`Card\`, \`ListRow\` (with its \`status\`, \`amount\` and \`action\` slots), \`Amount\`, \`Stat\`/\`StatGrid\`, \`Badge\`, \`Alert\`, \`EmptyState\`, and \`FormStack\` with \`Field\` + \`Input\`/\`Select\`/\`Textarea\` and \`Button\`/\`ButtonLink\`. Do not hand-style raw buttons, inputs or page frames; add a component to \`ui.tsx\` when one is missing, in the same style.
- Colours come from the theme in \`app/globals.css\` (\`bg-primary\`, \`text-muted\`, \`text-owed\`, \`bg-paid-tint\`, ...), never raw hex or Tailwind's default palette. One primary action per screen; red and green only for money and status (owed, paid), with words as well as colour.
- Money is shown with \`<Amount value={...} tone="owed" />\` (or \`money()\` inside text): ৳1,500. Every list has an \`EmptyState\`; every form shows success or errors with \`Alert\` and per-field \`error\`s.
- Mobile first: check that each page reads well at phone width; touch targets stay at least 44px (the components do this).

Conventions:
- Every backlog item adds or changes tests for its acceptance criteria; test pure logic directly and route handlers by calling the exported function with a \`Request\`.
- Forms work without JavaScript first (server actions), then get enhanced.
- \`app/api/health/route.ts\` is how deployments know the app is up. Keep it answering 200 and cheap; do not make it depend on the database.
- Never hard-code secrets. Read configuration from \`process.env\` and document new variables in \`.env.example\`: a comment line saying what it is in plain words (the person may read it), then a line \`# karigor: generate\` (a secret nobody needs to know, such as a signing key; Karigor makes one), \`# karigor: ask\` (a choice only the person can make, such as a passcode; Karigor asks them using your comment as the question), or \`# karigor: service <name>\` (a connection to an outside service with its own account; the person creates that account themselves, so never write that Karigor sets it up), then \`NAME=\` with an empty value. Start the comment with "Optional:" when the app works without it.
- Mobile first: layouts must read well on a phone; use Tailwind's responsive classes.
- Keep dependencies to what is already installed unless an item truly needs more; if you add one, say why in your summary.
- Do not touch files unrelated to the item. Do not reformat the whole project.

Finish an item by running \`pnpm test\` and \`pnpm lint\` and fixing anything that fails.
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
  healthPath: "/api/health",
  localSettings: { DATABASE_URL: "file:./data/app.db" },
  parseTests: parseVitestJson,
  stackGuide: WEB_APP_STACK_GUIDE,
};
