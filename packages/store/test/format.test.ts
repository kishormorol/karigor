import { describe, expect, it } from "vitest";
import { parseArtifact, serializeArtifact, ArtifactFormatError } from "../src/index.js";
import * as fx from "./fixtures/artifacts.js";

describe("artifact file format", () => {
  it("round-trips every fixture", () => {
    for (const a of fx.all) expect(parseArtifact(serializeArtifact(a))).toEqual(a);
  });
  it("keeps a body with fences and trailing newline intact", () => {
    const a = { ...fx.idea, body: "# Title\n\n---\n\nnot frontmatter\n" };
    expect(parseArtifact(serializeArtifact(a)).body).toBe(a.body);
  });
  it("names the failure", () => {
    expect(() => parseArtifact("no fence")).toThrow(ArtifactFormatError);
    expect(() => parseArtifact("---\n{bad json\n---\n")).toThrow(/not JSON/);
    expect(() => parseArtifact('---\n{"kind":"poem"}\n---\n')).toThrow(/invalid artifact/);
  });
});
