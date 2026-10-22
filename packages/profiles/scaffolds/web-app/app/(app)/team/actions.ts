"use server";
import { revalidatePath } from "next/cache";
import { requireAction, siteOrigin } from "@/server/auth";
import { PeopleError, changeRole, createLink, findPerson, invitePerson, logActivity, setActive } from "@/server/people";

export interface TeamState {
  error?: string;
  message?: string;
  /** A link to pass on (invitation or reset). */
  link?: string;
  values?: Record<string, string>;
}

const problem = (e: unknown): TeamState => {
  if (e instanceof PeopleError) return { error: e.message };
  throw e;
};

export async function inviteAction(_prev: TeamState, form: FormData): Promise<TeamState> {
  const me = await requireAction("manage people");
  const values = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "") };
  try {
    const { person, token } = await invitePerson(values, me.id);
    revalidatePath("/team");
    return { message: `${person.name} was added. Send them this link to choose a password; it works once, for 7 days.`, link: `${await siteOrigin()}/welcome/${token}` };
  } catch (e) {
    return { ...problem(e), values };
  }
}

export async function changeRoleAction(id: string, _prev: TeamState, form: FormData): Promise<TeamState> {
  const me = await requireAction("manage people");
  try {
    await changeRole(id, String(form.get("role") ?? ""), me.id);
    revalidatePath(`/team/${id}`);
    revalidatePath("/team");
    return { message: "Role changed." };
  } catch (e) {
    return problem(e);
  }
}

export async function setActiveAction(id: string, active: boolean, _prev: TeamState, _form: FormData): Promise<TeamState> {
  const me = await requireAction("manage people");
  try {
    await setActive(id, active, me.id);
    revalidatePath(`/team/${id}`);
    revalidatePath("/team");
    return { message: active ? "Their access is back on." : "Their access is off, and they were signed out everywhere." };
  } catch (e) {
    return problem(e);
  }
}

export async function resetLinkAction(id: string, _prev: TeamState, _form: FormData): Promise<TeamState> {
  const me = await requireAction("manage people");
  const p = await findPerson(id);
  if (!p) return { error: "That person is not here any more." };
  const purpose = p.hasPassword ? "reset" : "invite";
  const token = await createLink(id, purpose, me.id);
  await logActivity(me.id, `made a ${purpose === "reset" ? "password reset" : "new invitation"} link for ${p.name}`, "people");
  return { message: `Send ${p.name} this link. It works once, for ${purpose === "reset" ? "24 hours" : "7 days"}; older links stop working.`, link: `${await siteOrigin()}/welcome/${token}` };
}
