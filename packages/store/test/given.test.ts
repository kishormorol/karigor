import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GivenError, addGiven, givenPath, listGiven, renderGiven, safeGivenName, syncGiven } from "../src/index.js";

const dir = () => mkdtemp(join(tmpdir(), "karigor-given-"));

describe("files the person gave", () => {
  it("makes names safe and keeps pictures public, everything else private", () => {
    expect(safeGivenName("../../etc/My Logo (final).PNG")).toBe("My-Logo-final.png");
    expect(safeGivenName("দোকানের তালিকা.csv")).toBe("file.csv");
    expect(givenPath("logo.png")).toBe("public/given/logo.png");
    expect(givenPath("customers.csv")).toBe("given/customers.csv");
  });

  it("refuses unknown kinds, empty files and too many bytes", async () => {
    const p = await dir();
    await expect(addGiven(p, "run.sh", Buffer.from("rm -rf /"))).rejects.toThrow(GivenError);
    await expect(addGiven(p, "a.csv", Buffer.alloc(0))).rejects.toThrow(/empty/);
    await expect(addGiven(p, "big.png", Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow(/too big/);
    expect(await listGiven(p)).toEqual([]);
  });

  it("copies files into the workspace once, and shows agents the start of text files", async () => {
    const p = await dir();
    await addGiven(p, "logo.png", Buffer.from([1, 2, 3]));
    await addGiven(p, "prices.csv", Buffer.from("item,price\nRice,62.50\n"));
    const ws = join(p, "workspace");
    expect((await syncGiven(p, ws)).sort()).toEqual(["given/prices.csv", "public/given/logo.png"]);
    expect(await syncGiven(p, ws)).toEqual([]);
    expect(await readFile(join(ws, "given/prices.csv"), "utf8")).toMatch(/Rice,62.50/);
    expect((await stat(join(ws, "public/given/logo.png"))).size).toBe(3);
    const text = await renderGiven(p);
    expect(text).toMatch(/`public\/given\/logo.png` \(image, 3 bytes\)/);
    expect(text).toMatch(/Rice,62.50/);
    expect(await renderGiven(await dir())).toBeUndefined();
  });
});
