import { describe, expect, it } from "vitest";
import { generate } from "../src/generator";
import { grade, nextDeduction, type Deduction, type Rule } from "../src/grader";
import { candidatesFor, clueIndexMap, type SolveInput } from "../src/solver";
import { availableDifficulties, contains, sameRect, type Clue, type Difficulty, type Rect, type Variant } from "../src/types";

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

/**
 * Il motivo di "casella" e "caselle sicure" ricalcolato dalle sole forme che il giocatore
 * vede (quelle che non toccano i pezzi posati): il messaggio deve essere vero così.
 */
function visibleReasonHolds(input: SolveInput, given: readonly Rect[], d: Deduction): boolean {
  const clueAt = clueIndexMap(input);
  const taken = new Set(given.flatMap((g) => Array.from({ length: g.h * g.w }, (_, k) => (g.r + Math.floor(k / g.w)) * input.cols + g.c + (k % g.w))));
  const open = input.clues.flatMap((cl, i) => (given.some((g) => contains(g, cl.r, cl.c)) ? [] : [i]));
  const cands = (i: number) => candidatesFor(input, i, clueAt).filter((cand) => !cand.cells.some((idx) => taken.has(idx)));
  const only = (list: { rect: Rect }[]) => list.length === 1 && sameRect(list[0]!.rect, d.rect);
  if (d.rule === "owner") {
    const cell = d.cell!;
    const others = open.filter((i) => i !== d.clue && cands(i).some((cand) => cand.cells.includes(cell)));
    return others.length === 0 && only(cands(d.clue).filter((cand) => cand.cells.includes(cell)));
  }
  if (d.rule === "sure") {
    const byCands = cands(d.by!);
    const sure = byCands[0]!.cells.filter((idx) => byCands.every((cand) => cand.cells.includes(idx)));
    return only(cands(d.clue).filter((cand) => !cand.cells.some((idx) => sure.includes(idx))));
  }
  return true;
}

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
  });

  it("il motivo si vede dalla griglia: niente passi nascosti (puzzle segnalati)", () => {
    // 8×8 Forme, 9 già posato. Prima: "le caselle che il 7 copre comunque tolgono spazio al
    // 2", ma il 7 (1×7 o 7×1) era verticale solo per un passo non detto.
    const first = {
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
    expect(nextDeduction(first, [{ r: 1, c: 0, h: 3, w: 3 }])).toEqual({ clue: 1, rect: { r: 0, c: 6, h: 1, w: 2 }, rule: "guess" });
    // 8×8 Forme, 15 già posato. Prima: "solo il 6 non quadrato può coprire la casella" r0 c0,
    // ma anche l'altro 6 la copriva, con una striscia 6×1 tolta da un passo non detto.
    const second = {
      rows: 8,
      cols: 8,
      clues: [
        { r: 0, c: 1, n: 6, shape: "oblong" as const },
        { r: 0, c: 5, n: 15 },
        { r: 2, c: 0, n: 6 },
        { r: 3, c: 7 },
        { r: 5, c: 2, n: 3 },
        { r: 6, c: 1, shape: "oblong" as const },
        { r: 6, c: 3, n: 2, shape: "oblong" as const },
        { r: 6, c: 5, shape: "oblong" as const },
        { r: 7, c: 3, n: 5, shape: "oblong" as const },
        { r: 7, c: 7, n: 2, shape: "oblong" as const },
      ],
    };
    expect(nextDeduction(second, [{ r: 0, c: 3, h: 3, w: 5 }])).toEqual({ clue: 0, rect: { r: 0, c: 0, h: 2, w: 3 }, rule: "guess" });
  });

  it("forme che lascerebbero buchi", () => {
    // Il 4 in r1 c1 ha più forme: tutte tranne il quadrato a sinistra lascerebbero un buco.
    expect(nextDeduction(parse(["...4", ".4..", "..2.", "3..3"]), [])).toMatchObject({
      clue: 1,
      rect: { r: 1, c: 0, h: 2, w: 2 },
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
          expect(visibleReasonHolds(p, given, d), `${difficulty} ${variant} seed ${seed}: ${d.rule}`).toBe(true);
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
