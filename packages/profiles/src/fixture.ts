import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyScaffold } from "./copy.js";
import type { Profile } from "./types.js";
import { parseVitestJson } from "./vitest.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SCAFFOLDS_DIR = join(here, "..", "scaffolds");

/**
 * For Karigor's own tests. No install. `node test.mjs` prints a Vitest-shaped report whose
 * counts come from `tests.json`, so a test scripts failures by editing that file.
 * `lint.mjs` fails if a `lint-fail` file exists; `build.mjs` fails if `build-fail` exists.
 * `serve.mjs` serves the release on `PORT`; its health check fails if `health-fail` exists, and it
 * exits at once if `start-fail` exists.
 */
export const fixture: Profile = {
  name: "fixture",
  description: "Offline fixture for Karigor's own tests.",
  scaffold: (dir) => copyScaffold(join(SCAFFOLDS_DIR, "fixture"), dir),
  commands: {
    test: ["node", "test.mjs"],
    lint: ["node", "lint.mjs"],
    build: ["node", "build.mjs"],
    start: ["node", "serve.mjs"],
  },
  healthPath: "/health",
  parseTests: parseVitestJson,
  stackGuide: "# Fixture stack\n\nPlain Node. Code in `src/`; the fixture test runner reads counts from `tests.json`.\n",
};
