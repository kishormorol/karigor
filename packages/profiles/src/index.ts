export * from "./types.js";
export * from "./copy.js";
export * from "./vitest.js";
export * from "./playwright.js";
export * from "./fixture.js";
export * from "./web-app.js";
export * from "./static-site.js";

import { fixture } from "./fixture.js";
import type { Profile } from "./types.js";
import { webApp } from "./web-app.js";
import { staticSite } from "./static-site.js";

export const PROFILES: Record<string, Profile> = { fixture, "web-app": webApp, "static-site": staticSite };

/** The kinds of software a real build can make, the default first (a kind the selector names that is not here falls back to it). */
export const BUILDABLE = ["web-app", "static-site"] as const;

export function profileFor(name: string): Profile {
  const p = PROFILES[name];
  if (!p) throw new Error(`no target profile "${name}" is not implemented yet (have: ${Object.keys(PROFILES).join(", ")})`);
  return p;
}
export * from "./settings.js";
