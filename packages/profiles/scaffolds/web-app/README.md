# App

Built by Karigor. Next.js (App Router) + TypeScript + Tailwind + Drizzle (SQLite locally, Turso when hosted) + Vitest + Playwright.

- `pnpm dev` runs it locally. `pnpm test` runs the unit tests; `pnpm build` then `pnpm e2e` runs the browser journeys. `pnpm lint`, `pnpm build` and the journeys must pass before release.
- `pnpm admin:link <email> "<name>"` makes the first admin and prints a one-time link to set a password.
- Pages in `app/` (signed-in pages under `app/(app)/`), server code in server actions or `app/api/*/route.ts`, database tables in `src/db/schema.ts`, people and sign-in in `src/server/people.ts` and `src/server/auth.ts`, roles and permissions in `src/lib/access.ts`, pure logic in `src/lib/`.
- The look: `src/components/ui.tsx` and `ui-client.tsx`, colours in `app/globals.css`.
