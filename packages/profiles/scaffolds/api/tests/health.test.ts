import { describe, expect, it } from "vitest";
import { testApi } from "./api.js";

describe("health and errors", () => {
  it("answers /health without a key", async () => {
    const { call } = await testApi();
    expect(await call("GET", "/health")).toEqual({ status: 200, json: { ok: true } });
  });

  it("answers an unknown path with JSON pointing to the docs", async () => {
    const { call } = await testApi();
    const r = await call("GET", "/nowhere");
    expect(r.status).toBe(404);
    expect(r.json.error).toMatch(/see \/docs/);
  });
});
