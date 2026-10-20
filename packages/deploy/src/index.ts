export * from "./types.js";
export * from "./fake.js";
export * from "./server.js";
export * from "./local.js";
export * from "./vercel.js";

/** `r<n>-<sha7>`: the nth production release, from this commit. */
export function releaseVersion(n: number, commit: string): string {
  return `r${n}-${commit.slice(0, 7)}`;
}
