import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { MockAdapter } from "../src/index.js";

const Out = z.object({ title: z.string(), n: z.number() });
const req = (key = "k") => ({ tier: "routine" as const, system: "sys", user: "do it", schema: Out, key, role: "planner" as const });

describe("MockAdapter", () => {
  it("validates scripted output and counts tokens", async () => {
    const a = new MockAdapter(() => ({ title: "t", n: 1 }));
    const r = await a.complete(req());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toEqual({ title: "t", n: 1 });
      expect(r.usage.inputTokens).toBe(Math.ceil(("sys".length + "do it".length) / 4));
      expect(r.usage.outputTokens).toBeGreaterThan(0);
    }
  });

  it("reports malformed answers as invalid and retryable, with the raw text", async () => {
    const a = new MockAdapter(() => ({ title: 5 }));
    const r = await a.complete(req());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("invalid");
      expect(r.retryable).toBe(true);
      expect(r.raw).toBe('{"title":5}');
      expect(r.message).toMatch(/title/);
    }
  });

  it("counts attempts per key so scripts can answer differently on retry", async () => {
    const a = new MockAdapter((_r, attempt) => (attempt === 1 ? { bad: true } : { title: "ok", n: 2 }));
    expect((await a.complete(req("x"))).ok).toBe(false);
    expect((await a.complete(req("x"))).ok).toBe(true);
    expect((await a.complete(req("y"))).ok).toBe(false);
    expect(a.calls.map((c) => `${c.key}:${c.attempt}`)).toEqual(["x:1", "x:2", "y:1"]);
  });

  it("can script a refusal and an API failure", async () => {
    const refuse = new MockAdapter(() => MockAdapter.REFUSE);
    const r1 = await refuse.complete(req());
    expect(r1.ok === false && r1.error).toBe("refusal");
    const boom = new MockAdapter(() => {
      throw new Error("network down");
    });
    const r2 = await boom.complete(req());
    expect(r2.ok === false && r2.error).toBe("api");
  });
});
