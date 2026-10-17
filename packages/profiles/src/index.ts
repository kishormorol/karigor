export * from "./types.js";
export * from "./copy.js";
export * from "./vitest.js";
export * from "./fixture.js";
export * from "./web-app.js";

import { fixture } from "./fixture.js";
import type { Profile } from "./types.js";
import { webApp } from "./web-app.js";

export const PROFILES: Record<string, Profile> = { fixture, "web-app": webApp };

export function profileFor(name: string): Profile {
  const p = PROFILES[name];
  if (!p) throw new Error(`no target profile "${name}" is not implemented yet (have: ${Object.keys(PROFILES).join(", ")})`);
  return p;
}
