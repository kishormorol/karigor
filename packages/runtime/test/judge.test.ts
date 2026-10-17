import { describe, expect, it } from "vitest";
import { MockAdapter, makeJudge, renderJudgeInputs } from "../src/index.js";
import { idea } from "./helpers.js";

const req = {
  gate: "skeptic-review" as const,
  role: "skeptic" as const,
  rubric: "# Rubric\nFind problems.",
  inputs: [idea],
  extras: { diff: "+1" },
  key: "specify#1:skeptic-review",
  phase: "specify",
};

const budget = () => {
  const entries: string[] = [];
  return { entries, allow: () => ({ ok: true, reason: "" }), record: (e: { key: string }) => void entries.push(e.key) };
};

describe("makeJudge", () => {
  it("renders inputs with the citable list and returns a validated verdict", async () => {
    let seen = "";
    const adapter = new MockAdapter((r) => {
      seen = r.user;
      expect(r.system).toMatch(/You are the skeptic|Role: skeptic/);
      expect(r.system).toMatch(/# Rubric/);
      return { verdict: "fail", citations: [{ ref: { kind: "idea", id: "idea-1" }, quote: "neighbours" }], reasons: ["no empty state"] };
    });
    const b = budget();
    const v = await makeJudge(adapter, b)(req);
    expect(v.verdict).toBe("fail");
    expect(seen).toMatch(/You may cite only these artifacts/);
    expect(seen).toMatch(/- idea idea-1/);
    expect(seen).toMatch(/## diff/);
    expect(b.entries).toEqual(["specify#1:skeptic-review:judge#1"]);
  });

  it("retries an invalid verdict once, then fails closed", async () => {
    const adapter = new MockAdapter(() => ({ verdict: "maybe" }));
    const v = await makeJudge(adapter, budget())(req);
    expect(v.verdict).toBe("fail");
    expect(v.citations).toEqual([]);
    expect(v.reasons[0]).toMatch(/could not produce a usable verdict/);
    expect(adapter.calls.length).toBe(2);
  });

  it("fails closed when the budget says stop", async () => {
    const adapter = new MockAdapter(() => ({ verdict: "pass", citations: [], reasons: [] }));
    const b = { ...budget(), allow: () => ({ ok: false, action: "stop" as const, reason: "no money" }) };
    const v = await makeJudge(adapter, b)(req);
    expect(v.verdict).toBe("fail");
    expect(v.reasons[0]).toMatch(/no money/);
    expect(adapter.calls.length).toBe(0);
  });

  it("renderJudgeInputs includes the gate, item and phase", () => {
    expect(renderJudgeInputs({ ...req, itemId: "b1" })).toMatch(/# Gate: skeptic-review for item b1 \(phase specify\)/);
  });
});
