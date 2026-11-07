import { test } from "vitest";
import { measure } from "./run";

// One file per variant: Vitest measures them in parallel.
test("Classico", () => measure("classic"), 3_600_000);
