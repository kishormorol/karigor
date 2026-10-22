import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, can, isRole, roleLabel } from "@/lib/access";
import { navFor } from "@/lib/nav";

describe("who may do what", () => {
  it("admins manage people; members do not; nobody inactive or unknown can do anything", () => {
    expect(can({ role: "admin" }, "manage people")).toBe(true);
    expect(can({ role: "member" }, "manage people")).toBe(false);
    expect(can({ role: "admin", active: false }, "manage people")).toBe(false);
    expect(can({ role: "ghost" }, "see activity")).toBe(false);
    expect(can(undefined, "see activity")).toBe(false);
  });

  it("every permission names only real roles", () => {
    for (const roles of Object.values(PERMISSIONS)) for (const r of roles) expect(isRole(r)).toBe(true);
    expect(roleLabel("admin")).toBe(ROLES.admin.label);
    expect(roleLabel("unknown")).toBe("unknown");
  });

  it("the menu shows only the sections a person may open", () => {
    const labels = (role: string) => navFor({ role }).flatMap((g) => g.items.map((i) => i.label));
    expect(labels("admin")).toEqual(["Home", "People", "Activity"]);
    expect(labels("member")).toEqual(["Home"]);
  });
});
