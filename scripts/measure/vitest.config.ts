import { defineConfig } from "vitest/config";

/** Only for the measurements (npm run measure): kept out of npm test, they take minutes. */
export default defineConfig({
  test: {
    include: ["scripts/measure/*.measure.ts"],
    // Each variant in its own process, in parallel: the measurement is pure computation.
    pool: "forks",
    // The summary at the end (teardown).
    globalSetup: ["scripts/measure/summary.ts"],
  },
});
