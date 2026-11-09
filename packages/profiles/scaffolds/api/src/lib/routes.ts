import { app } from "../app.js";
import { ENDPOINTS } from "./docs.js";

/** Endpoints the service answers that are not in the docs, and endpoints the docs list that it does not answer. */
export function undocumented(): string[] {
  const hidden = new Set(["GET /", "GET /docs", "GET /openapi.json", "POST /owner-key"]);
  const routes = new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`).filter((r) => !hidden.has(r)));
  const docs = new Set(ENDPOINTS.map((e) => `${e.method} ${e.path}`));
  return [
    ...[...routes].filter((r) => !docs.has(r)).map((r) => `${r} answers but is not in ENDPOINTS`),
    ...[...docs].filter((d) => !routes.has(d)).map((d) => `${d} is in ENDPOINTS but src/app.ts has no such route`),
  ];
}
