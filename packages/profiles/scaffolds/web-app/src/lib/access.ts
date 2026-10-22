/**
 * Who may do what. This is the file each app changes: replace `member` with the system's real roles
 * (receptionist, teacher, accountant...), and list every permission with the roles that have it.
 * Check permissions with `can()` in pages and `requirePermission()` / `requireAction()` on the server.
 */
export const ROLES = {
  admin: { label: "Admin", description: "Runs the system: everything, including people and the activity log." },
  member: { label: "Member", description: "Uses the system day to day." },
} as const;

export type Role = keyof typeof ROLES;

/** Permission names are the app's own words. Admin is listed explicitly wherever it applies. */
export const PERMISSIONS = {
  "manage people": ["admin"],
  "see activity": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** The role that runs the system: the first person, and the one who can never be removed last. */
export const ADMIN_ROLE: Role = "admin";

export function isRole(value: string): value is Role {
  return Object.prototype.hasOwnProperty.call(ROLES, value);
}

export function roleLabel(role: string): string {
  return isRole(role) ? ROLES[role].label : role;
}

/** True when this person (active, with a known role) has the permission. */
export function can(user: { role: string; active?: boolean } | null | undefined, permission: Permission): boolean {
  if (!user || user.active === false || !isRole(user.role)) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(user.role);
}

/** Roles in the order they are offered, for selects. */
export function roleOptions(): { value: Role; label: string }[] {
  return (Object.keys(ROLES) as Role[]).map((value) => ({ value, label: ROLES[value].label }));
}
