import { expect, test } from "@playwright/test";
import { makePerson, openSection, signInAs, signedIn } from "./helpers";

test("an admin adds a member, the member sets a password from the link and signs in", async ({ page, browser }) => {
  const admin = await makePerson("admin");
  await signInAs(page, admin);
  await openSection(page, "People");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  const email = `new-${Date.now()}@example.test`;
  await page.getByLabel("Name", { exact: true }).fill("Rina Akter");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption({ label: "Member" });
  await page.getByRole("button", { name: "Add and make a link" }).click();
  const link = await page.getByLabel("Link to send").inputValue();
  expect(link).toMatch(/\/welcome\//);

  const member = await browser.newPage();
  await member.goto(link);
  await expect(member.getByText("Welcome, Rina Akter")).toBeVisible();
  await member.getByLabel("New password").fill("a-good-password");
  await member.getByLabel("The same password again").fill("a-good-password");
  await member.getByRole("button", { name: "Save and sign in" }).click();
  await expect(member.getByRole("heading", { name: "Hello, Rina Akter" })).toBeVisible();
  // The link works once.
  const again = await browser.newPage();
  await again.goto(link);
  await expect(again.getByText("This link does not work any more")).toBeVisible();
});

test("a member cannot open the admin pages and does not see them in the menu", async ({ page }) => {
  await signedIn(page, "member");
  await page.goto("/");
  const menu = page.getByText("Menu", { exact: true });
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "People" })).toHaveCount(0);
  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Not for your role" })).toBeVisible();
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
