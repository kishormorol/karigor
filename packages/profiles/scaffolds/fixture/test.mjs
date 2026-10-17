import { readFileSync, existsSync } from "node:fs";
const c = existsSync("tests.json") ? JSON.parse(readFileSync("tests.json", "utf8")) : { passed: 0, failed: 1, skipped: 0 };
const start = Date.now();
console.log("running fixture tests");
console.log(JSON.stringify({ numTotalTests: c.passed + c.failed + c.skipped, numPassedTests: c.passed, numFailedTests: c.failed, numPendingTests: c.skipped, startTime: start, testResults: [{ endTime: start + 5 }] }));
process.exit(c.failed > 0 ? 1 : 0);
