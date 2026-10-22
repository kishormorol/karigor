import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journeys: each kind of user's main jobs, done the way a person does them.
 * `pnpm build` first (it migrates the database), then `pnpm e2e`. Karigor's journeys check runs both
 * on a brand-new database before every release.
 */
process.env.DATABASE_URL ??= "file:./data/e2e.db";
const port = Number(process.env.E2E_PORT ?? 3901);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ? [["json"], ["line"]] : [["line"]],
  use: { baseURL: `http://localhost:${port}`, trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm db:migrate && pnpm start --port ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: process.env.DATABASE_URL, SITE_URL: `http://localhost:${port}`, PORT: String(port) },
  },
});
