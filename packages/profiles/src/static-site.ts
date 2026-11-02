import { join } from "node:path";
import { copyScaffold } from "./copy.js";
import { SCAFFOLDS_DIR } from "./fixture.js";
import type { Profile } from "./types.js";
import { parseVitestJson } from "./vitest.js";

export const STATIC_SITE_STACK_GUIDE = `# Stack guide: static-site

The workspace is a plain website: HTML pages, one stylesheet and a little JavaScript, with no framework, no database and no server code. \`pnpm test\`, \`pnpm lint\` and \`pnpm build\` already pass. Keep them passing.

Where things go:
- Pages: \`site/<name>.html\`, served at \`/<name>\` (\`site/index.html\` is the home page; \`site/404.html\` is shown for a missing page). Folders work too: \`site/menu/index.html\` is \`/menu\`.
- Look: \`site/styles.css\`. Colours, fonts and spacing are tokens on \`:root\` with a dark version; change the tokens before adding new colours. Reuse \`.wrap\`, \`.row\`, \`.grid\`, \`.card\`, \`.btn\`, \`.band\`, \`.hero\`, \`.lead\`.
- Small touches (a menu button, a year, a filter on a list): \`site/site.js\`, written so the page still works with JavaScript off. No libraries from other sites unless the item needs one (a map); never a framework.
- Pictures the person gave are in \`public/given/\` and served at \`/given/<name>\`. Use them (a logo in the header, photos in a gallery) with real alt text. Other files they gave (a price list, a menu) are in \`given/\` and are never served: copy what the pages need into the HTML.
- Use root-relative links (\`/about\`, \`/styles.css\`) so every page works from any folder.

Rules every page follows (\`pnpm lint\` and the tests check them, and the release stops if they fail):
- \`<html lang="...">\` in the language of the site, a \`<title>\`, \`<meta name="description">\`, and \`<meta name="viewport" content="width=device-width, initial-scale=1">\`.
- Every \`<img>\` has alt text. Every link or picture inside the site leads to a file that exists.
- Phone first: it must read well at 360px wide with no sideways scrolling, tap targets at least 44px tall.
- The header and footer are the same on every page; copy them, keeping the current page's nav link marked with \`aria-current="page"\`.

What a static site cannot do, and what to do instead (record the choice in the assumption ledger in plain words):
- Keep form answers itself. A contact or order form becomes a WhatsApp link (\`https://wa.me/<number>?text=...\`), a phone link (\`tel:\`), an email link (\`mailto:\`), or a form that posts to a form service the person signs up for; never a form that posts nowhere.
- Sign-in, accounts, or anything that changes per visitor. If the idea truly needs these, say so in the ledger: it should have been a web app.

Tests: \`tests/*.test.js\` with Vitest. \`tests/site.test.js\` checks every page; add a test only for logic in \`site/site.js\`.

Finish an item by running \`pnpm test\` and \`pnpm lint\` and fixing anything that fails.
`;

export const staticSite: Profile = {
  name: "static-site",
  description: "Plain HTML + CSS + a little JavaScript, checked page by page. Free to host anywhere.",
  scaffold: (dir) => copyScaffold(join(SCAFFOLDS_DIR, "static-site"), dir),
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
      "Pages that read well on phones and computers: a home page, about, services, a menu or price list, a gallery, opening hours, a map, contact details",
      "The person's own logo and photos",
      "Contact by WhatsApp, phone or email links, and a form through a free form service the person signs up for",
      "Opens fast and costs nothing to keep online",
    ],
    notYet: [
      "Sign-in, accounts, or anything different for each visitor",
      "Keeping what visitors type (orders, bookings, messages) inside the site itself",
      "Changing its content from a page; changes are asked for in the chat",
      "Taking payments",
    ],
  },
  healthPath: "/",
  parseTests: parseVitestJson,
  stackGuide: STATIC_SITE_STACK_GUIDE,
};
