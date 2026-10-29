import { describe, expect, it } from "vitest";
import { generate } from "../src/generator";
import { grade, nextDeduction, type Rule } from "../src/grader";
import { availableDifficulties, sameRect, type Clue, type Difficulty, type Rect, type Variant } from "../src/types";

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

describe("nextDeduction", () => {
  it("forma unica", () => {
    // Il 2 non può scendere (c'è il 4): ha una sola forma già all'inizio.
    expect(nextDeduction(parse(["2.", "4.", ".."]), [])).toEqual({ clue: 0, rect: { r: 0, c: 0, h: 1, w: 2 }, rule: "single" });
  });

  it("riparte dai pezzi già posati", () => {
    const input = parse(["2.", "4.", ".."]);
    expect(nextDeduction(input, [{ r: 0, c: 0, h: 1, w: 2 }])).toMatchObject({ clue: 1, rect: { r: 1, c: 0, h: 2, w: 2 } });
    expect(nextDeduction(input, [{ r: 0, c: 0, h: 1, w: 2 }, { r: 1, c: 0, h: 2, w: 2 }])).toBeUndefined();
  });

  it("casella che può coprire un solo indizio", () => {
    // La seconda casella in alto la raggiunge solo il 6, a cui resta il 2×3 in alto a destra.
    expect(nextDeduction(parse(["...6", "2...", ".4.."]), [])).toMatchObject({
      clue: 0,
      rect: { r: 0, c: 1, h: 2, w: 3 },
      rule: "owner",
      cell: 1,
    });
  });

  it("celle sicure di un altro indizio", () => {
    // Le caselle che il 4 copre comunque tolgono spazio al 3 in alto a destra: resta orizzontale.
    expect(nextDeduction(parse(["3..3", ".2..", "..4."]), [])).toMatchObject({
      clue: 1,
      rect: { r: 0, c: 1, h: 1, w: 3 },
      rule: "sure",
      by: 3,
    });
    // Il 4 aveva ancora tutte le sue forme: niente passo precedente da spiegare.
    expect(nextDeduction(parse(["3..3", ".2..", "..4."]), [])).not.toHaveProperty("prior");
  });

  it("celle sicure di un indizio che aveva già perso forme: si dice perché", () => {
    // Puzzle segnalato dall'utente (8×8 Forme, 9 già posato). Il 7 può essere 1×7 o 7×1;
    // la casella r1 c7 la raggiunge solo lui, quindi è verticale e copre comunque r6 c7:
    // il 2 non quadrato in r6 c6 deve scendere.
    const input = {
      rows: 8,
      cols: 8,
      clues: [
        { r: 0, c: 2, shape: "oblong" as const },
        { r: 0, c: 6, n: 2 },
        { r: 1, c: 0, n: 9, shape: "square" as const },
        { r: 1, c: 4, n: 12 },
        { r: 4, c: 7, n: 7 },
        { r: 5, c: 2, n: 12, shape: "oblong" as const },
        { r: 5, c: 6, shape: "oblong" as const },
        { r: 6, c: 5, n: 2 },
        { r: 6, c: 6, n: 2, shape: "oblong" as const },
        { r: 7, c: 3, n: 6, shape: "oblong" as const },
      ],
    };
    expect(nextDeduction(input, [{ r: 1, c: 0, h: 3, w: 3 }])).toMatchObject({
      clue: 8,
      rect: { r: 6, c: 6, h: 2, w: 1 },
      rule: "sure",
      by: 4,
      prior: { rule: "owner", cell: 1 * 8 + 7 },
    });
  });

  it("forme che lascerebbero buchi", () => {
    expect(nextDeduction(parse(["..3.", "3..4", "....", ".42."]), [])).toMatchObject({
      clue: 3,
      rect: { r: 2, c: 0, h: 2, w: 2 },
      rule: "hole",
    });
  });

  it("deduzione dopo deduzione si arriva alla soluzione (puzzle generati)", () => {
    const seen = new Set<Rule>();
    const cases: [number, Difficulty, Variant][] = [
      [8, "easy", "classic"],
      [8, "hard", "classic"],
      [8, "expert", "classic"],
      [8, "hard", "shapes"],
      [8, "expert", "shapes"],
    ];
    for (const [size, difficulty, variant] of cases) {
      for (let seed = 1; seed <= 3; seed++) {
        const p = generate({ rows: size, cols: size, difficulty, variant, seed });
        const given: Rect[] = [];
        for (let d = nextDeduction(p, given); d; d = nextDeduction(p, given)) {
          expect(p.solution.some((sol) => sameRect(sol, d!.rect)), `${difficulty} ${variant} seed ${seed}`).toBe(true);
          seen.add(d.rule);
          given.push(d.rect);
        }
        expect(given, `${difficulty} ${variant} seed ${seed}`).toHaveLength(p.solution.length);
      }
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(["guess", "hole", "owner", "single", "sure"]));
  }, 60_000);
});

describe("availableDifficulties", () => {
  it("Esperto da 7, Maestro da 8 (lato minore)", () => {
    expect(availableDifficulties({ rows: 6, cols: 15 })).toEqual(["easy", "medium", "hard"]);
    expect(availableDifficulties({ rows: 7, cols: 7 })).toEqual(["easy", "medium", "hard", "expert"]);
    expect(availableDifficulties({ rows: 15, cols: 8 })).toEqual(["easy", "medium", "hard", "expert", "master"]);
  });
});
