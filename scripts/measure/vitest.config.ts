import { defineConfig } from "vitest/config";

/** Solo per le misure (npm run measure): fuori da npm test, durano minuti. */
export default defineConfig({
  test: {
    include: ["scripts/measure/*.measure.ts"],
    // Ogni variante nel suo processo, in parallelo: la misura è tutta calcolo.
    pool: "forks",
    // Il riepilogo alla fine (teardown).
    globalSetup: ["scripts/measure/summary.ts"],
  },
});
