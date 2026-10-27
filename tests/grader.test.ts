import { describe, expect, it } from "vitest";
import { generate } from "../src/generator";
import { grade } from "../src/grader";
import { availableDifficulties, sameRect, type Clue, type Difficulty } from "../src/types";

/** Griglia scritta a mano: cifre = numeri, "." = cella vuota. */
function parse(lines: string[]): { rows: number; cols: number; clues: Clue[] } {
  const clues: Clue[] = [];
  lines.forEach((line, r) =>
    [...line].forEach((ch, c) => {
      if (ch !== ".") clues.push({ r, c, n: parseInt(ch, 36) });
    }),
  );
  return { rows: lines.length, cols: lines[0]!.length, clues };
}

describe("grade", () => {
  it("forme uniche → Facile", () => {
    // Il 2 non può scendere (c'è il 4), quindi va a destra; poi il 4 è obbligato.
    const g = grade(parse(["2.", "4.", ".."]));
    expect(g.solved).toBe(true);
    expect(g.difficulty).toBe("easy");
    expect(g.placed).toEqual([
      { r: 0, c: 0, h: 1, w: 2 },
      { r: 1, c: 0, h: 2, w: 2 },
    ]);
  });

  it("puzzle ambiguo: non risolto", () => {
    expect(grade(parse(["2.", ".2"])).solved).toBe(false);
  });

  it("non posa mai forme diverse dalla soluzione (puzzle generati)", () => {
    for (const difficulty of ["easy", "medium", "hard"] as Difficulty[]) {
      for (let seed = 1; seed <= 15; seed++) {
        const p = generate({ rows: 8, cols: 8, difficulty, seed });
        const g = grade(p);
        expect(g.solved, `${difficulty} seed ${seed}`).toBe(true);
        g.placed.forEach((rect, i) => expect(sameRect(rect!, p.solution[i]!)).toBe(true));
      }
    }
  });

  it("non posa mai forme diverse dalla soluzione (variante Forme)", () => {
    for (const difficulty of ["easy", "hard", "expert"] as Difficulty[]) {
      for (let seed = 1; seed <= 5; seed++) {
        const p = generate({ rows: 8, cols: 8, difficulty, variant: "shapes", seed });
        const g = grade(p);
        expect(g.solved, `${difficulty} seed ${seed}`).toBe(true);
        g.placed.forEach((rect, i) => expect(sameRect(rect!, p.solution[i]!)).toBe(true));
      }
    }
  });

  it("Maestro: corretto, e con le sole regole fino a Esperto non si chiude", () => {
    for (let seed = 1; seed <= 2; seed++) {
      const p = generate({ rows: 8, cols: 8, difficulty: "master", seed, maxCandidates: 1000 });
      const g = grade(p);
      expect(g.difficulty, `seed ${seed}`).toBe("master");
      g.placed.forEach((rect, i) => expect(sameRect(rect!, p.solution[i]!)).toBe(true));
      expect(grade(p, 3).solved, `seed ${seed}`).toBe(false);
    }
  }, 120_000);
});

describe("availableDifficulties", () => {
  it("Esperto da 7, Maestro da 8 (lato minore)", () => {
    expect(availableDifficulties({ rows: 6, cols: 15 })).toEqual(["easy", "medium", "hard"]);
    expect(availableDifficulties({ rows: 7, cols: 7 })).toEqual(["easy", "medium", "hard", "expert"]);
    expect(availableDifficulties({ rows: 15, cols: 8 })).toEqual(["easy", "medium", "hard", "expert", "master"]);
  });
});
