import { describe, expect, it } from "vitest";
import { pages, problems } from "../scripts/pages.mjs";

describe("the site", () => {
  it("has a home page and a not-found page", () => {
    expect(pages()).toContain("index.html");
    expect(pages()).toContain("404.html");
  });

  for (const page of pages()) {
    it(`${page} fits phones, has a title and description, and every link inside the site works`, () => {
      expect(problems(page)).toEqual([]);
    });
  }

  it("the checker notices what is wrong", () => {
    const bad = '<html><head></head><body><img src="missing.png"><a href="/nowhere">x</a><a href="https://example.com">ok</a></body></html>';
    const found = problems("bad.html", bad).join("\n");
    expect(found).toMatch(/needs a lang/);
    expect(found).toMatch(/needs a <title>/);
    expect(found).toMatch(/viewport/);
    expect(found).toMatch(/no alt text/);
    expect(found).toMatch(/"missing.png" points at nothing/);
    expect(found).toMatch(/"\/nowhere" points at nothing/);
    expect(found).not.toMatch(/example.com/);
  });
});
