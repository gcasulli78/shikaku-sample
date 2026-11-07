import { defineConfig, devices } from "@playwright/test";

/** In CI (GitHub Actions) no already-running server to reuse, and one extra retry. */
const CI = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CI;

/**
 * UI tests (e2e/): the built file served as on GitHub Pages, in Chromium (Chrome, Edge), WebKit
 * (Safari's engine) and WebKit with an iPhone screen and touch. The logic tests stay in tests/ with
 * Vitest.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173/",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "iphone", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    // Build before serving: the file that will be published is always the one tested.
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
