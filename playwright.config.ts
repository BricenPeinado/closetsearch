import { defineConfig, devices } from "@playwright/test";

const apiUrl = "http://127.0.0.1:4400";
const webUrl = "http://127.0.0.1:4173";
const persistenceDriver = process.env.PLAYWRIGHT_PERSISTENCE_DRIVER ?? "sqlite";

if (persistenceDriver !== "sqlite" && persistenceDriver !== "postgres") {
  throw new Error("PLAYWRIGHT_PERSISTENCE_DRIVER must be sqlite or postgres.");
}

const playwrightDatabaseUrl = process.env.PLAYWRIGHT_DATABASE_URL ?? process.env.DATABASE_URL;

if (persistenceDriver === "postgres" && !playwrightDatabaseUrl) {
  throw new Error(
    "PLAYWRIGHT_DATABASE_URL or DATABASE_URL is required for PostgreSQL Playwright runs.",
  );
}

const persistenceEnvironment =
  persistenceDriver === "postgres"
    ? {
        DATABASE_URL: playwrightDatabaseUrl,
        POSTGRES_ALLOW_INSECURE: process.env.POSTGRES_ALLOW_INSECURE ?? "true",
        POSTGRES_SSL_MODE: process.env.POSTGRES_SSL_MODE ?? "disable",
      }
    : {
        CLOSETSEARCH_DB_PATH: ":memory:",
      };

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results/playwright",
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "tests/e2e",
  timeout: 45_000,
  use: {
    baseURL: webUrl,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "corepack pnpm --filter @closetsearch/api exec tsx src/server.ts",
      env: {
        AUTH_ALLOWED_ORIGINS: webUrl,
        AUTH_COOKIE_SECURE: "false",
        AUTH_SESSION_PEPPER: "closetsearch-playwright-session-pepper-000000000000",
        AUTH_TOKEN_PEPPER: "closetsearch-playwright-token-pepper-00000000000000",
        EBAY_PROVIDER_ENABLED: "false",
        GRAILED_PROVIDER_ENABLED: "false",
        GRAILED_SCRAPING_ALLOWED: "false",
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        PERSISTENCE_DRIVER: persistenceDriver,
        PORT: "4400",
        ...persistenceEnvironment,
        PROVIDER_ALLOW_MOCK_FALLBACK: "false",
        PROVIDER_MOCK_ENABLED: "true",
        PROVIDER_RUNTIME_MODE: "mock",
      },
      reuseExistingServer: false,
      stderr: "pipe",
      stdout: "pipe",
      timeout: 60_000,
      url: `${apiUrl}/health/ready`,
    },
    {
      command: "corepack pnpm --filter @closetsearch/web exec vite --host 127.0.0.1 --port 4173",
      env: {
        VITE_API_BASE_URL: apiUrl,
        VITE_EXPERIMENTAL_METADATA_SIGNALS: "false",
      },
      reuseExistingServer: false,
      stderr: "pipe",
      stdout: "pipe",
      timeout: 60_000,
      url: webUrl,
    },
  ],
  workers: 1,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testMatch: /responsive-product\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "tablet-chromium",
      testMatch: /responsive-product\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        hasTouch: true,
        viewport: { height: 1112, width: 834 },
      },
    },
  ],
});
