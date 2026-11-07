import { test } from "vitest";
import { measure } from "./run";

// One file per variant: Vitest measures them in parallel.
test("Caselle nere", () => measure("blocked"), 3_600_000);
