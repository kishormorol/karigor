import { describe, expect, it } from "vitest";
import { testApi } from "./api.js";

describe("access keys", () => {
  it("refuses a call with no key, a wrong key, or a key that was turned off", async () => {
    const { call, keyFor } = await testApi();
    expect((await call("GET", "/v1/me")).status).toBe(401);
    expect((await call("GET", "/v1/me", { key: "key_not-a-real-key" })).status).toBe(401);
    const owner = await keyFor("full", "Owner");
    const made = await call("POST", "/v1/keys", { key: owner, body: { name: "Shop app" } });
    expect(made.status).toBe(201);
    expect((await call("GET", "/v1/me", { key: made.json.key })).json).toEqual({ name: "Shop app", scope: "full" });
    expect((await call("DELETE", `/v1/keys/${made.json.id}`, { key: owner })).status).toBe(200);
    expect((await call("GET", "/v1/me", { key: made.json.key })).status).toBe(401);
  });

  it("a read key can look but not manage keys", async () => {
    const { call, keyFor } = await testApi();
    const reader = await keyFor("read");
    expect((await call("GET", "/v1/me", { key: reader })).status).toBe(200);
    const r = await call("GET", "/v1/keys", { key: reader });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/may not manage keys/);
  });

  it("never shows a key again after it is made", async () => {
    const { call, keyFor } = await testApi();
    const owner = await keyFor();
    const list = await call("GET", "/v1/keys", { key: owner });
    expect(JSON.stringify(list.json)).not.toContain(owner);
    expect(list.json.keys[0].preview).toBe(owner.slice(0, 8));
  });

  it("explains a body that does not fit", async () => {
    const { call, keyFor } = await testApi();
    const owner = await keyFor();
    const r = await call("POST", "/v1/keys", { key: owner, body: { name: "" } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/name/);
    expect((await call("POST", "/v1/keys", { key: owner, body: { name: "x", scope: "everything" } })).json.error).toMatch(/scope must be one of/);
  });

  it("a key cannot turn itself off", async () => {
    const { call, keyFor } = await testApi();
    const owner = await keyFor();
    const me = (await call("GET", "/v1/keys", { key: owner })).json.keys[0];
    expect((await call("DELETE", `/v1/keys/${me.id}`, { key: owner })).status).toBe(400);
  });
});
