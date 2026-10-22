import { expect, type Page } from "@playwright/test";
import { createSession, invitePerson, redeemLink } from "../../src/server/people";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import type { Role } from "../../src/lib/access";

let n = 0;

/** A new person of this role, straight in the journeys' database, with a password. */
export async function makePerson(role: Role, name = `${role} ${Date.now()}-${++n}`) {
  const email = `${role}-${Date.now()}-${n}@example.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${n}`;
  const { person, token } = await invitePerson({ name, email, role }, null);
  const r = await redeemLink(token, password, password);
  if (!r.ok) throw new Error(r.error);
  return { ...person, password };
}

/** Sign in through the real sign-in page. */
export async function signInAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A signed-in browser for this role, without going through the sign-in page (faster for most journeys). */
export async function signedIn(page: Page, role: Role) {
  const who = await makePerson(role);
  const { token } = await createSession(who.id);
  await page.context().addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  return who;
}

/** The main navigation: in the sidebar on wide screens, behind Menu on a phone. */
export async function openSection(page: Page, label: string) {
  const menu = page.getByText("Menu", { exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: label }).click();
}
