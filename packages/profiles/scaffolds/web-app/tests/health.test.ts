import { describe, expect, it } from "vitest";
import { healthMessage } from "@/lib/health";

describe("healthMessage", () => {
  it("reports ok with the time", () => {
    expect(healthMessage(new Date("2026-01-01T00:00:00.000Z"))).toBe("ok at 2026-01-01T00:00:00.000Z");
  });
});
