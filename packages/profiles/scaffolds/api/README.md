# Service

A service other programs call, answering JSON over HTTPS. No screens of its own besides its docs.

- Routes: `src/app.ts`. Each one starts with `await need(c, "<permission>")` unless anyone may call it.
- Docs: `src/lib/docs.ts` describes every endpoint; `/docs` (a page) and `/openapi.json` are made from it. `pnpm lint` fails when a route is missing there.
- Who may do what: `src/lib/access.ts` (scopes and permissions).
- Database tables: `src/db/schema.ts`; after a change, `pnpm db:generate`.
- Access keys: `pnpm key:new "<who uses it>" [scope]` prints a new key once. Keys are managed at `/v1/keys`.
- `pnpm test`, `pnpm lint`, `pnpm build` (applies migrations, checks types), `pnpm start` (serves on `PORT`).
