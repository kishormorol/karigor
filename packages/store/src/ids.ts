import { randomBytes } from "node:crypto";
import type { ArtifactKind } from "./schemas/index.js";

/** Short, sortable, lowercase id: `<kind>-<time36>-<rand>`. */
export function makeId(kind: ArtifactKind, now: Date = new Date()): string {
  const t = now.getTime().toString(36);
  const r = randomBytes(3).toString("hex");
  return `${kind}-${t}-${r}`;
}

export function makeProjectId(now: Date = new Date()): string {
  return `p-${now.getTime().toString(36)}-${randomBytes(2).toString("hex")}`;
}
