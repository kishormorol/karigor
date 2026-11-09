// Fails when src/app.ts and src/lib/docs.ts disagree about which endpoints exist.
import { undocumented } from "../src/lib/routes.js";

const problems = undocumented();
if (problems.length) {
  console.error(`The docs (src/lib/docs.ts) and the routes (src/app.ts) disagree:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("docs: every endpoint is described");
