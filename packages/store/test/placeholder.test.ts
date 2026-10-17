import { describe, expect, it } from "vitest";
import { PACKAGE } from "../src/index.js";

describe("workspace", () => {
  it("resolves the package", () => {
    expect(PACKAGE).toBe("@karigor/store");
  });
});
