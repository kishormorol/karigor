import { expect, test } from "@playwright/test";

test("the app can be added to a phone's home screen, and scheduled jobs and files are not open to strangers", async ({ page, request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ display: "standalone", start_url: "/" });
  expect((await request.get("/api/jobs")).status()).toBe(401);
  await page.goto("/files/not-a-real-file");
  await expect(page).toHaveURL(/\/login$/);
});
