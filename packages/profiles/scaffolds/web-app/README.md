# App

Built by Karigor. Next.js (App Router) + TypeScript + Tailwind + Drizzle (SQLite locally, Postgres-ready) + Vitest.

- `pnpm dev` runs it locally. `pnpm test` runs the unit tests. `pnpm lint` and `pnpm build` must pass before release.
- Pages in `app/`, server code in `app/api/*/route.ts` or server actions, database tables in `src/db/schema.ts`, pure logic in `src/lib/`.
