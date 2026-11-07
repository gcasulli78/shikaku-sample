import { test } from "vitest";
import { measure } from "./run";

// One file per variant: Vitest measures them in parallel.
test("Forme", () => measure("shapes"), 3_600_000);
