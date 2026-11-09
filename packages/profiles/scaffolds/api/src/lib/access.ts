/**
 * What each kind of key may do. Replace `read` with the service's real scopes from the architecture
 * and list each permission (in the service's words, e.g. "record payments") with the scopes that have it.
 * `full` keeps every permission.
 */
export const SCOPES = {
  full: "Everything",
  read: "Look things up, change nothing",
} as const;
export type Scope = keyof typeof SCOPES;

export const PERMISSIONS: Record<string, Scope[]> = {
  "read data": ["full", "read"],
  "change data": ["full"],
  "manage keys": ["full"],
};

export function isScope(s: string): s is Scope {
  return Object.hasOwn(SCOPES, s);
}

export function allows(scope: string, permission: string): boolean {
  const who = PERMISSIONS[permission];
  if (!who) throw new Error(`unknown permission "${permission}": add it to PERMISSIONS in src/lib/access.ts`);
  return isScope(scope) && who.includes(scope);
}
