import { defineConfig, devices } from "@playwright/test";

/** In CI (GitHub Actions) niente server già avviato da riusare e un tentativo in più. */
const CI = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CI;

/**
 * Test dell'interfaccia (e2e/): il file costruito servito come su GitHub Pages, in Chromium
 * (Chrome, Edge), WebKit (il motore di Safari) e WebKit con schermo e tocco da iPhone. I test
 * della logica restano in tests/ con Vitest.
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
    // La build prima di servire: si prova sempre il file che verrà pubblicato.
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
