import { join } from "node:path";
import { copyScaffold } from "./copy.js";
import { SCAFFOLDS_DIR } from "./fixture.js";
import type { Profile } from "./types.js";
import { parseVitestJson } from "./vitest.js";

export const WEB_APP_STACK_GUIDE = `# Stack guide: web-app

The workspace is a Next.js (App Router) application in TypeScript with Tailwind, Drizzle ORM over SQLite (a local file; Postgres-ready for production), and Vitest. It was scaffolded so that \`pnpm test\`, \`pnpm lint\` and \`pnpm build\` already pass. Keep them passing.

Where things go:
- Pages and layouts: \`app/<route>/page.tsx\`. Server components by default; add \`"use client"\` only for interactivity.
- Server endpoints: \`app/api/<name>/route.ts\` exporting \`GET\`/\`POST\`, or server actions in \`app/<route>/actions.ts\` with \`"use server"\`.
- Database tables: \`src/db/schema.ts\` (one \`sqliteTable\` per kind of thing). Query with the \`db\` export from \`src/db\` in server code only. After changing the schema, run \`pnpm db:push\`.
- Pure logic (validation, formatting, rules): \`src/lib/*.ts\`. This is where most unit tests belong.
- Tests: \`tests/*.test.ts\` or next to the code as \`*.test.ts\`, run with \`pnpm test\`.

Conventions:
- Every backlog item adds or changes tests for its acceptance criteria; test pure logic directly and route handlers by calling the exported function with a \`Request\`.
- Forms work without JavaScript first (server actions), then get enhanced.
- \`app/api/health/route.ts\` is how deployments know the app is up. Keep it answering 200 and cheap; do not make it depend on the database.
- Never hard-code secrets. Read configuration from \`process.env\` and document new variables in \`.env.example\`: a comment line saying what it is in plain words (the person may read it), then a line \`# karigor: generate\` (a secret nobody needs to know, such as a signing key; Karigor makes one), \`# karigor: ask\` (a choice only the person can make, such as a passcode; Karigor asks them using your comment as the question), or \`# karigor: service <name>\` (a connection to an outside service with its own account), then \`NAME=\` with an empty value. Start the comment with "Optional:" when the app works without it.
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
  },
  healthPath: "/api/health",
  parseTests: parseVitestJson,
  stackGuide: WEB_APP_STACK_GUIDE,
};
