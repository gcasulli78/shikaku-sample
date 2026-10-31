import { test } from "vitest";
import { measure } from "./run";

// Un file per variante: Vitest le misura in parallelo.
test("Caselle nere", () => measure("blocked"), 3_600_000);
