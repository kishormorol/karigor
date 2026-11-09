import { describe, expect, it } from "vitest";

describe("starting up", () => {
  it("answers /health and /docs before any database is reachable", async () => {
    process.env.DATABASE_URL = "file:/nonexistent-folder/app.db";
    const { app } = await import("../src/app.js");
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/docs")).status).toBe(200);
  });
});
