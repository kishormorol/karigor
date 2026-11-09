import { describe, expect, it } from "vitest";
import { undocumented } from "../src/lib/routes.js";
import { ENDPOINTS } from "../src/lib/docs.js";
import { testApi } from "./api.js";

describe("docs", () => {
  it("describe every endpoint the service answers, and only those", () => {
    expect(undocumented()).toEqual([]);
  });

  it("serve a readable page and an OpenAPI document", async () => {
    const { call } = await testApi();
    const page = await call("GET", "/docs");
    expect(page.status).toBe(200);
    for (const e of ENDPOINTS) expect(page.json).toContain(e.path);
    const spec = await call("GET", "/openapi.json");
    expect(spec.json.openapi).toBe("3.1.0");
    expect(spec.json.paths["/v1/keys/{id}"].delete.security).toEqual([{ key: [] }]);
  });
});
