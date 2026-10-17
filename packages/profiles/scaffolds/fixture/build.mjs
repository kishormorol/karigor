import { existsSync } from "node:fs";
if (existsSync("build-fail")) { console.error("build failed"); process.exit(1); }
console.log("built");
