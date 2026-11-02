/** The release is site/ with the person's pictures (public/) beside it, in dist/. */
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC, ROOT, SITE } from "./pages.mjs";

const out = join(ROOT, "dist");
rmSync(out, { recursive: true, force: true });
if (existsSync(PUBLIC)) cpSync(PUBLIC, out, { recursive: true });
cpSync(SITE, out, { recursive: true });
console.log("built dist/");
