import { describe, expect, it } from "vitest";
import { candidatesFor, clueIndexMap, countSolutions, solve } from "../src/solver";
import type { Clue } from "../src/types";

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

describe("solver", () => {
  it("trova l'unica soluzione", () => {
    // 2 in alto a sinistra può essere solo orizzontale perché il 4 occupa le righe sotto.
    const input = parse([
      "2.", //
      "4.",
      "..",
    ]);
    const result = solve(input, 2);
    expect(result.count).toBe(1);
    expect(result.solutions[0]).toEqual([
      { r: 0, c: 0, h: 1, w: 2 },
      { r: 1, c: 0, h: 2, w: 2 },
    ]);
  });

  it("si ferma a 2 con soluzioni multiple", () => {
    // Due 2 in diagonale: si divide per righe oppure per colonne.
    expect(countSolutions(parse(["2.", ".2"]), 2)).toBe(2);
    // Con limite più alto le conta tutte: una 2×4 di quattro 2 ne ha 5.
    expect(countSolutions(parse(["2.2.", ".2.2"]), 10)).toBe(5);
  });

  it("restituisce 0 se impossibile", () => {
    // Le aree sommano 4 ma i due 2 si contendono la stessa colonna.
    expect(countSolutions(parse(["2.", "2.", ".."]))).toBe(0);
    expect(countSolutions(parse(["3.", ".."]))).toBe(0);
    expect(countSolutions(parse(["3.", ".1"]))).toBe(0);
  });

  it("restituisce 0 se la somma non copre la griglia", () => {
    expect(countSolutions(parse(["2.", ".."]))).toBe(0);
  });

  it("griglia senza vincoli superflui: 1×1 ovunque", () => {
    expect(countSolutions(parse(["11", "11"]))).toBe(1);
  });
});

describe("indizi con forma e area aperte", () => {
  const grid2 = (clue: Clue) => ({ rows: 2, cols: 2, clues: [clue] });
  const count = (clue: Clue) => candidatesFor(grid2(clue), 0, clueIndexMap(grid2(clue))).length;

  it("candidati: ? tutti, □ solo quadrati, ▭ solo non quadrati", () => {
    expect(count({ r: 0, c: 0 })).toBe(4); // 1×1, 1×2, 2×1, 2×2
    expect(count({ r: 0, c: 0, shape: "square" })).toBe(2); // 1×1, 2×2
    expect(count({ r: 0, c: 0, shape: "oblong" })).toBe(2); // 1×2, 2×1
    expect(count({ r: 0, c: 0, n: 4, shape: "square" })).toBe(1);
    expect(count({ r: 0, c: 0, n: 4, shape: "oblong" })).toBe(0);
  });

  it("la forma rende unica una soluzione che con ? non lo è", () => {
    //  ? . □      il □ in alto a destra può essere solo il 2×2 a destra
    //  . . .
    const square = { rows: 2, cols: 3, clues: [{ r: 0, c: 0 }, { r: 0, c: 2, shape: "square" as const }] };
    const result = solve(square, 2);
    expect(result.count).toBe(1);
    expect(result.solutions[0]).toEqual([
      { r: 0, c: 0, h: 2, w: 1 },
      { r: 0, c: 1, h: 2, w: 2 },
    ]);
    expect(countSolutions({ ...square, clues: [{ r: 0, c: 0 }, { r: 0, c: 2 }] }, 10)).toBe(2);
  });

  it("aree note che superano la griglia: nessuna soluzione", () => {
    expect(countSolutions({ rows: 2, cols: 2, clues: [{ r: 0, c: 0, n: 4 }, { r: 1, c: 1 }] })).toBe(0);
  });
});
