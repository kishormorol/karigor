import { describe, expect, it } from "vitest";
import { listTemplates, loadTemplate, parseTemplate, TemplateError } from "../src/index.js";

const minimal = (overrides = "") => `
name: t
description: d
fitsWhen: w
initialPhase: a
phases:
  a:
    roles: [product-owner]
    transitions:
      - to: done
        gates: [spec-complete]
        onFail: [{ action: retry, times: 1 }, { action: stop }]
  done:
    terminal: true
${overrides}`;

describe("template loader", () => {
  it("loads all four shipped templates", async () => {
    const names = await listTemplates();
    expect(names).toEqual(["iterative", "linear", "maintenance", "spike-then-build"]);
    for (const n of names) {
      const t = await loadTemplate(n);
      expect(t.name).toBe(n);
      expect(t.phases[t.initialPhase]).toBeDefined();
    }
  });

  it("applies defaults", () => {
    const t = parseTemplate(minimal());
    expect(t.limits.projectFailures).toBe(25);
    expect(t.phases["a"]!.budgetWeight).toBe(1);
    expect(t.phases["done"]!.transitions).toEqual([]);
  });

  it("names an unknown transition target", () => {
    expect(() => parseTemplate(minimal().replace("to: done", "to: nowhere"))).toThrow(/unknown phase "nowhere"/);
  });

  it("names an unreachable phase", () => {
    expect(() => parseTemplate(minimal("  orphan:\n    terminal: true\n"))).toThrow(/unreachable phases: orphan/);
  });

  it("requires a reachable terminal phase", () => {
    const text = minimal().replace("terminal: true", "roles: [releaser]\n    transitions: [{ to: a }]");
    expect(() => parseTemplate(text)).toThrow(/no terminal phase/);
  });

  it("rejects item actions on phase ladders and vice versa", () => {
    expect(() => parseTemplate(minimal().replace("{ action: stop }", "{ action: park }"))).toThrow(/item action/);
    const loop = `
  b:
    loop:
      itemRoles: [developer]
      onItemFail: [{ action: retry, times: 1 }, { action: stop }]
    transitions: [{ to: done }]`;
    const text = minimal(loop).replace("to: done\n        gates: [spec-complete]", "to: b\n        gates: [spec-complete]");
    expect(() => parseTemplate(text)).toThrow(/phase action/);
  });

  it("rejects an unknown gate or role", () => {
    expect(() => parseTemplate(minimal().replace("spec-complete", "vibes-good"))).toThrow(TemplateError);
    expect(() => parseTemplate(minimal().replace("product-owner", "intern"))).toThrow(TemplateError);
  });

  it("rejects a template whose name does not match its file", async () => {
    await expect(loadTemplate("nope")).rejects.toThrow(/no template "nope"/);
  });
});
