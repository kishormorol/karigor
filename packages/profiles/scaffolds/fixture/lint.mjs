import { existsSync } from "node:fs";
if (existsSync("lint-fail")) { console.error("lint: 1 problem"); process.exit(1); }
console.log("lint: clean");
