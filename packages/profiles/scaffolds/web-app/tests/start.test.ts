import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the start command", () => {
  // Karigor starts every preview and release on a port it chooses (the PORT setting), and the person
  // picks the live port with `karigor serve --port`. A start command with its own port fails the release.
  it("leaves the port to Karigor", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(scripts["start"]).not.toMatch(/(^|\s)(-p|--port)\b|\bPORT=/);
  });
});
