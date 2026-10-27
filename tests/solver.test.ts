import { describe, expect, it } from "vitest";
import { countSolutions, solve } from "../src/solver";
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
