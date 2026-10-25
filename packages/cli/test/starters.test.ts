import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, noopCommitter } from "@karigor/store";
import { STARTERS, STARTERS_BN, createProject, findStarter, ideaFor, renderStarter, renderStarters, starterIdea } from "../src/index.js";

describe("starters", () => {
  it("has at least twenty, each with a unique id", () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(20);
    const ids = STARTERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("each names who may not do something, credits a real repository and stays a plain idea", () => {
    expect(STARTERS.filter((s) => !/cannot|must not|see only/i.test(s.idea)).map((s) => s.id)).toEqual([]);
    for (const s of STARTERS) {
      expect(s.idea.length, s.id).toBeGreaterThan(300);
      expect(s.idea, s.id).toMatch(/Later: /);
      expect(s.basedOn.length, s.id).toBeGreaterThan(0);
      for (const b of s.basedOn) expect(b.repo, s.id).toMatch(/^[\w.-]+\/[\w.-]+$/);
    }
  });

  it("never asks the app to take a payment inside it, which a web app cannot do yet", () => {
    for (const s of STARTERS) expect(s.idea, s.id).not.toMatch(/pay(s|ment)? online|payment gateway|checkout with (card|bkash)|whatsapp/i);
  });

  it("every starter is written in Bangla too, the same way: who may not do what, and what comes later", () => {
    expect(Object.keys(STARTERS_BN).sort()).toEqual(STARTERS.map((s) => s.id).sort());
    for (const s of STARTERS) {
      const bn = STARTERS_BN[s.id]!;
      expect(bn.title.trim(), s.id).not.toBe("");
      expect(bn.for, s.id).toMatch(/জন্য$/);
      expect(bn.idea.length, s.id).toBeGreaterThan(250);
      expect(bn.idea, s.id).toMatch(/পরে: /);
      expect(bn.idea, s.id).toMatch(/পারে না|পারেন না|পারবেন না|পারি না|শুধু/);
      expect(bn.idea, s.id).toMatch(/[\u0980-\u09FF]/);
      expect(bn.idea, s.id).not.toMatch(/whatsapp|হোয়াটসঅ্যাপ/i);
    }
  });

  it("starts from the Bangla idea when the person reads Bangla, with their changes after it", () => {
    const shop = findStarter("shop-counter")!;
    expect(starterIdea(shop, undefined, "bn")).toBe(STARTERS_BN["shop-counter"]!.idea);
    expect(ideaFor("আমাদের দুটি শাখা।", "shop-counter", "bn")).toBe(`${STARTERS_BN["shop-counter"]!.idea}\n\nআমার পরিবর্তন: আমাদের দুটি শাখা।`);
    expect(ideaFor(undefined, "shop-counter")).toBe(shop.idea);
  });

  it("adds the person's changes after the ready-made idea", () => {
    const shop = findStarter("shop-counter")!;
    expect(starterIdea(shop)).toBe(shop.idea);
    expect(starterIdea(shop, "   ")).toBe(shop.idea);
    expect(starterIdea(shop, "Two shops, not one.")).toBe(`${shop.idea}\n\nMy changes to this: Two shops, not one.`);
  });

  it("chooses the idea from the person's words or a starter, and says plainly what is wrong", () => {
    expect(ideaFor("A page for my family's shopping list", undefined)).toBe("A page for my family's shopping list");
    expect(ideaFor(undefined, "pharmacy")).toBe(findStarter("pharmacy")!.idea);
    expect(ideaFor("We also sell cosmetics.", "pharmacy")).toContain("My changes to this: We also sell cosmetics.");
    expect(() => ideaFor(undefined, undefined)).toThrow(/--starter/);
    expect(() => ideaFor(" ", undefined)).toThrow(/your own words/);
    expect(() => ideaFor(undefined, "spaceship")).toThrow(/no ready-made idea called "spaceship"/);
  });

  it("lists every starter and shows one with how to start it", () => {
    const list = renderStarters();
    for (const s of STARTERS) expect(list).toContain(s.id);
    const one = renderStarter(findStarter("samity")!);
    expect(one).toContain("github.com/apache/fineract");
    expect(one).toContain("karigor new --starter samity");
  });

  it("starts a project from a starter with the person's changes as its idea", async () => {
    const root = await mkdtemp(join(tmpdir(), "karigor-starter-"));
    const id = await createProject(root, ideaFor("Two branches.", "pharmacy"), { clock: () => new Date("2026-10-24T00:00:00.000Z"), committer: noopCommitter, projectId: "p1" });
    const store = await FsStore.open(root, id);
    const [ideaId] = await store.listArtifacts("idea");
    const idea = await store.readArtifact("idea", ideaId!);
    expect(idea.body).toContain("expiry date");
    expect(idea.body).toContain("My changes to this: Two branches.");
  });
});
