import { join } from "node:path";
import { copyScaffold } from "./copy.js";
import { SCAFFOLDS_DIR } from "./fixture.js";
import type { Profile } from "./types.js";
import { parseVitestJson } from "./vitest.js";

export const API_STACK_GUIDE = `# Stack guide: api

The workspace is a service other programs call: Hono in TypeScript (run with tsx), Drizzle ORM over SQLite (a local file; a hosted Turso database in production), Zod for checking what callers send, and Vitest. It answers JSON and has no screens besides its docs. \`pnpm test\`, \`pnpm lint\` and \`pnpm build\` already pass. Keep them passing.

Where things go:
- Routes: \`src/app.ts\`, inside \`createApp\`. Group them by resource under \`/v1/<resource>\` (\`GET /v1/orders\`, \`POST /v1/orders\`, \`GET /v1/orders/:id\`, \`PATCH\`, \`DELETE\`). When a file grows past a few resources, move each into \`src/routes/<resource>.ts\` exporting a function that adds its routes to the app, and call it from \`createApp\`.
- Every route except public ones starts with \`const key = await need(c, "<permission>")\` (\`src/server/auth.ts\`). Permissions and scopes live in \`src/lib/access.ts\`: replace the \`read\` scope with the service's real kinds of caller from the architecture, and list each permission in the service's words with the scopes that have it. \`full\` keeps every permission.
- Docs: add every route to \`ENDPOINTS\` in \`src/lib/docs.ts\` with a one-line summary, its permission, an example body and an example answer. \`/docs\` and \`/openapi.json\` are made from that list; \`pnpm lint\` and \`tests/docs.test.ts\` fail when the two disagree. The service's name and tagline are in \`src/lib/service.ts\`; set them in the first item.
- Checking input: \`await body(c, z.object({ ... }))\` from \`src/lib/validate.ts\` answers 400 with the reason when the body does not fit. Check query strings and path params the same way with Zod. Never trust a caller's ids without looking them up.
- Answers: JSON. A list is \`{ "<things>": [...] }\` (never a bare array) with \`limit\`/\`cursor\` once it can grow past 100. A problem is \`{ "error": "<plain words>" }\` with 400 (bad input), 401 (no key), 403 (not allowed), 404 (no such thing) or 409 (conflict); throw \`HTTPException\` from \`hono/http-exception\` or \`BadRequest\` and \`app.onError\` shapes it. Money is stored and sent as whole paisa/cents (integers) with a currency field; dates as ISO 8601 strings in answers.
- Database tables: \`src/db/schema.ts\`. Handlers read the database as \`c.var.db\` and pass it to every database function (\`listOrders(c.var.db)\`); database functions take a \`database: Db\` argument. After changing the schema, run \`pnpm db:generate\` and keep the new file in \`drizzle/\`: \`pnpm build\` applies migrations first, which is how every release gets its tables. A fresh, empty database must work after \`pnpm build\` alone.
- Pure logic (rules, calculations, formatting): \`src/lib/*.ts\`. This is where most unit tests belong.
- \`DATABASE_URL\` keeps its local default in \`.env.example\`. The service's public address is \`process.env.SITE_URL\` (set by every deploy target; never ask for it).

Built in and tested; build on them:
- Access keys (\`src/server/keys.ts\`, table \`api_keys\`): a caller sends \`Authorization: Bearer key_…\`. Only a hash is stored; a key is shown once when made. Keys are made and turned off at \`/v1/keys\` (permission "manage keys") and on this computer with \`pnpm key:new "<who>" [scope]\`. Once hosted, Karigor asks \`POST /owner-key\` (guarded by OWNER_LINK_SECRET) for the owner's first key; keep that route and its setting as they are.
- A request log (table \`request_log\`, 30 days) of every \`/v1\` call: key, path, status, time taken. An endpoint the owner needs to see usage reads it.
- CORS is open on \`/v1/*\` so a website's pages may call the service; the key is what protects data. A service meant only for one website may narrow \`origin\` in \`src/app.ts\`.
- Data from the person: files they gave are in \`given/\` (never served). A price list or product list becomes the starting data through a migration or a seed function the first item writes and tests.

Tests: \`tests/*.test.ts\` with Vitest. Test each endpoint through \`testApi()\` from \`tests/api.ts\` (a service on a fresh in-memory database): \`const { call, keyFor } = await testApi(); const r = await call("POST", "/v1/orders", { key: await keyFor(), body: {...} })\`, then check \`r.status\` and \`r.json\`. Every endpoint has a test for its main answer, for a caller without the permission (403) and for bad input (400). Fake secrets in tests look plainly fake (\`"test-owner-secret"\`, \`"key_not-a-real-key"\`), never like a real key: the security scan before every release cannot tell them apart.

Conventions:
- Never hard-code secrets. Read configuration from \`process.env\` and document new variables in \`.env.example\`: a comment line saying what it is in plain words, then \`# karigor: generate\`, \`# karigor: ask\` or \`# karigor: service <name>\`, then \`NAME=\` with an empty value. Start the comment with "Optional:" when the service works without it. When the person reads Bangla, add a \`# bn: …\` line with the same words.
- \`/health\` is how deployments know the service is up. Keep it answering 200 and cheap; do not make it depend on the database.
- Keep dependencies to what is installed unless an item truly needs more; if you add one, say why in your summary. Imports between files use the \`.js\` extension (\`./lib/money.js\`).
- Do not touch files unrelated to the item.

Finish an item by running \`pnpm test\` and \`pnpm lint\` and fixing anything that fails.
`;

export const api: Profile = {
  name: "api",
  description: "A JSON service other programs call: Hono + TypeScript + Drizzle (SQLite locally) + Vitest, with access keys and docs. Free to run and to host.",
  scaffold: (dir) => copyScaffold(join(SCAFFOLDS_DIR, "api"), dir),
  commands: {
    install: ["pnpm", "install", "--silent"],
    test: ["pnpm", "test"],
    lint: ["pnpm", "lint"],
    build: ["pnpm", "build"],
    audit: ["pnpm", "audit", "--prod", "--json", "--audit-level", "high"],
    start: ["pnpm", "start"],
  },
  capabilities: {
    can: [
      "Answer other programs over the web in JSON: a shop's app, a partner's system, a website's pages, a device",
      "Access keys for each program that calls it, each allowed only what it needs, and turned off at once when lost",
      "Keep records in its own database, with checks on everything callers send",
      "A docs page anyone can read, with an example call for every endpoint, and an OpenAPI file for tools",
      "A log of who called what in the last 30 days",
    ],
    notYet: [
      "Screens for people to use; that is a web app (the docs page is the only page)",
      "Sign-in for people with passwords; callers use access keys",
      "Calls that stay open (live updates, websockets) or that take longer than a minute",
      "Jobs that run on a schedule by themselves",
      "Sending email or SMS",
      "Files larger than 4 MB",
    ],
  },
  healthPath: "/health",
  localSettings: { DATABASE_URL: "file:./data/app.db" },
  parseTests: parseVitestJson,
  stackGuide: API_STACK_GUIDE,
};
