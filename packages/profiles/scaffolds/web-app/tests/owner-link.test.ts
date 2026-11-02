import { describe, expect, it } from "vitest";
import { ownerLink, ownerLinkAuthorized } from "@/server/owner-link";
import { peekLink } from "@/server/people";
import { testDb } from "./db";

describe("the owner's first link, asked for by Karigor", () => {
  it("is switched off without the secret, and needs exactly the secret", () => {
    expect(ownerLinkAuthorized("Bearer x", undefined)).toBe(false);
    expect(ownerLinkAuthorized(null, "s3cret")).toBe(false);
    expect(ownerLinkAuthorized("Bearer wrong", "s3cret")).toBe(false);
    expect(ownerLinkAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("makes the owner an admin and returns a working one-time link on the app's address", async () => {
    const db = await testDb();
    expect(await ownerLink({ email: "nope" }, "https://shop.example.com", db)).toEqual({ error: "an email address is needed" });
    const r = await ownerLink({ email: "owner@example.com", name: "Owner" }, "https://shop.example.com/", db);
    if ("error" in r) throw new Error(r.error);
    expect(r.created).toBe(true);
    expect(r.link).toMatch(/^https:\/\/shop\.example\.com\/welcome\/\S+$/);
    expect(await peekLink(r.link.split("/").pop()!, db)).toBeDefined();
  });
});
