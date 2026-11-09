import { describe, expect, it } from "vitest";
import { ownerAuthorized, ownerKey } from "../src/server/owner-key.js";
import { keyFor } from "../src/server/keys.js";
import { testDb } from "./db.js";

describe("the owner's first key", () => {
  it("is switched off without the secret, and needs the exact secret", () => {
    expect(ownerAuthorized("Bearer anything", undefined)).toBe(false);
    expect(ownerAuthorized("Bearer not-the-secret", "test-owner-secret")).toBe(false);
    expect(ownerAuthorized("Bearer test-owner-secret", "test-owner-secret")).toBe(true);
  });

  it("makes a working key with every permission", async () => {
    const db = await testDb();
    const r = await ownerKey({ name: "Rina" }, db);
    if ("error" in r) throw new Error(r.error);
    const k = await keyFor(`Bearer ${r.key}`, db);
    expect(k).toMatchObject({ name: "Rina", scope: "full" });
  });
});
