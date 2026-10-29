import { describe, expect, it } from "vitest";
import { nextDeduction } from "../src/grader";
import { completePuzzle } from "../src/share";
import { TUTORIAL } from "../src/tutorial";

describe("tutorial", () => {
  it.each(TUTORIAL.map((step) => [step.title, step] as const))("%s: soluzione unica, livello e prima regola", (_, step) => {
    const puzzle = completePuzzle(step)!;
    expect(puzzle).toBeDefined();
    expect(puzzle.logical).toBe(true);
    expect(puzzle.difficulty).toBe(step.level);
    expect(nextDeduction(step, [])?.kind).toBe(step.firstRule);
    if (step.variant !== "shapes") expect(step.clues.every((cl) => cl.n !== undefined && cl.shape === undefined)).toBe(true);
  });
});
