import { describe, expect, it } from "vitest";
import { requestLog } from "../src/db/schema.js";
import { testApi } from "./api.js";

describe("request log", () => {
  it("records each call with the key that made it", async () => {
    const { call, keyFor, db } = await testApi();
    const owner = await keyFor();
    await call("GET", "/v1/me", { key: owner });
    await call("GET", "/v1/me");
    const rows = await db.select().from(requestLog);
    expect(rows.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(rows.find((r) => r.status === 200)?.keyId).toBeTruthy();
  });
});
