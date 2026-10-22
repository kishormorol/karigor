import { can, type Permission } from "./access";

/**
 * The signed-in sections, grouped as the sidebar shows them. Each item names the permission it needs
 * (none: everyone signed in). Add the app's sections here; pages still check with requirePermission().
 */
export const NAV: { label?: string; items: { href: string; label: string; permission?: Permission }[] }[] = [
  { items: [{ href: "/", label: "Home" }] },
  {
    label: "Admin",
    items: [
      { href: "/team", label: "People", permission: "manage people" },
      { href: "/activity", label: "Activity", permission: "see activity" },
    ],
  },
];

/** The groups and items this person may see; empty groups are left out. */
export function navFor(user: { role: string; active?: boolean }) {
  return NAV.map((g) => ({ ...(g.label ? { label: g.label } : {}), items: g.items.filter((i) => !i.permission || can(user, i.permission)).map(({ href, label }) => ({ href, label })) })).filter((g) => g.items.length > 0);
}
