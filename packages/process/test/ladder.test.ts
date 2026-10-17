import { describe, expect, it } from "vitest";
import { rungFor } from "../src/index.js";

describe("rungFor", () => {
  const ladder = [
    { action: "retry" as const, times: 2 },
    { action: "shrink" as const, times: 1 },
    { action: "park" as const },
  ];
  it("walks rungs by fail count", () => {
    expect(rungFor(ladder, 1).action).toBe("retry");
    expect(rungFor(ladder, 2).action).toBe("retry");
    expect(rungFor(ladder, 3).action).toBe("shrink");
    expect(rungFor(ladder, 4).action).toBe("park");
    expect(rungFor(ladder, 99).action).toBe("park");
  });
  it("returns the last rung when every rung has times", () => {
    expect(rungFor([{ action: "retry", times: 1 }], 5).action).toBe("retry");
  });
});
