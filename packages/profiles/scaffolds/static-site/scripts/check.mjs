import { allProblems, pages } from "./pages.mjs";

const found = allProblems();
if (!pages().length) {
  console.error("site/ has no pages; it needs at least site/index.html");
  process.exit(1);
}
if (found.length) {
  for (const p of found) console.error(p);
  process.exit(1);
}
console.log(`${pages().length} page(s) checked`);
