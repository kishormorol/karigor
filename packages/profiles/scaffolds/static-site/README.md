# Static site

Plain HTML, CSS and a little JavaScript: no framework, no database, nothing to run on a server.

- Pages: `site/*.html` (`site/about.html` is served at `/about`). `site/404.html` is shown for missing pages.
- Look: `site/styles.css`. Small touches: `site/site.js`.
- Pictures the person gave are in `public/given/` and served at `/given/<name>`.
- `pnpm lint` checks every page (title, description, language, phone viewport, alt text, links that lead somewhere).
- `pnpm test` runs those checks as tests, plus any in `tests/`.
- `pnpm build` makes `dist/`; `pnpm start` serves it on `PORT`.
