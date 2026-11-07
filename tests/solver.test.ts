import { describe, expect, it } from "vitest";
import { candidatesFor, clueIndexMap, countSolutions, solve } from "../src/solver";
import type { Clue } from "../src/types";

/** Hand-written grid: digits = numbers, "." = empty cell. */
function parse(lines: string[]): { rows: number; cols: number; clues: Clue[] } {
  const clues: Clue[] = [];
  lines.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch !== ".") clues.push({ r, c, n: parseInt(ch, 36) });
    });
  });
  return { rows: lines.length, cols: lines[0]!.length, clues };
}

describe("solver", () => {
  it("trova l'unica soluzione", () => {
    // The 2 at the top left can only be horizontal because the 4 occupies the rows below.
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
    // Two 2s on a diagonal: split by rows or by columns.
    expect(countSolutions(parse(["2.", ".2"]), 2)).toBe(2);
    // With a higher limit it counts them all: a 2×4 of four 2s has 5.
    expect(countSolutions(parse(["2.2.", ".2.2"]), 10)).toBe(5);
  });

  it("restituisce 0 se impossibile", () => {
    // The areas add up to 4 but the two 2s compete for the same column.
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

describe("caselle nere", () => {
  it("nessun rettangolo le copre, e non vanno coperte", () => {
    //  4 . 1
    //  . . #     with the black cell at the bottom right the 4 is the 2×2 on the left
    const input = {
      rows: 2,
      cols: 3,
      clues: [
        { r: 0, c: 0, n: 4 },
        { r: 0, c: 2, n: 1 },
      ],
      blocked: [5],
    };
    const result = solve(input, 2);
    expect(result.count).toBe(1);
    expect(result.solutions[0]).toEqual([
      { r: 0, c: 0, h: 2, w: 2 },
      { r: 0, c: 2, h: 1, w: 1 },
    ]);
    // Without the black cell the areas don't add up.
    expect(countSolutions({ rows: 2, cols: 3, clues: input.clues })).toBe(0);
    // A clue on a black cell makes the puzzle impossible.
    expect(countSolutions({ ...input, blocked: [0] })).toBe(0);
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

  it("candidati orientati: orizzontale più largo che alto, verticale più alto che largo", () => {
    expect(count({ r: 0, c: 0, shape: "wide" })).toBe(1); // 1×2
    expect(count({ r: 0, c: 0, shape: "tall" })).toBe(1); // 2×1
    expect(count({ r: 0, c: 0, n: 2, shape: "wide" })).toBe(1);
    expect(count({ r: 0, c: 0, n: 4, shape: "wide" })).toBe(0); // 2×2 is a square
    // Area 6 on 6×6 from the corner: 1×6 and 2×3 horizontal, 6×1 and 3×2 vertical.
    const big = (clue: Clue) => ({ rows: 6, cols: 6, clues: [clue] });
    const count6 = (clue: Clue) => candidatesFor(big(clue), 0, clueIndexMap(big(clue))).length;
    expect(count6({ r: 0, c: 0, n: 6, shape: "oblong" })).toBe(4);
    expect(count6({ r: 0, c: 0, n: 6, shape: "wide" })).toBe(2);
    expect(count6({ r: 0, c: 0, n: 6, shape: "tall" })).toBe(2);
    // With a prime number the orientation leaves a single shape.
    expect(count6({ r: 0, c: 0, n: 5, shape: "wide" })).toBe(1);
  });

  it("l'orientamento rende unica una soluzione che con la croce non lo è", () => {
    //  ▭ .     at the top left the cross or the horizontal, at the bottom right a ?
    //  . ?
    const grid = (shape: "oblong" | "wide") => ({
      rows: 2,
      cols: 2,
      clues: [
        { r: 0, c: 0, shape },
        { r: 1, c: 1 },
      ],
    });
    // Cross: 1×2 at the top (rest: 1×2 at the bottom) or 2×1 on the left (rest: 2×1 on the right).
    expect(countSolutions(grid("oblong"), 10)).toBe(2);
    const wide = solve(grid("wide"), 2);
    expect(wide.count).toBe(1);
    expect(wide.solutions[0]![0]).toEqual({ r: 0, c: 0, h: 1, w: 2 });
  });

  it("la forma rende unica una soluzione che con ? non lo è", () => {
    //  ? . □      the □ at the top right can only be the 2×2 on the right
    //  . . .
    const square = {
      rows: 2,
      cols: 3,
      clues: [
        { r: 0, c: 0 },
        { r: 0, c: 2, shape: "square" as const },
      ],
    };
    const result = solve(square, 2);
    expect(result.count).toBe(1);
    expect(result.solutions[0]).toEqual([
      { r: 0, c: 0, h: 2, w: 1 },
      { r: 0, c: 1, h: 2, w: 2 },
    ]);
    expect(
      countSolutions(
        {
          ...square,
          clues: [
            { r: 0, c: 0 },
            { r: 0, c: 2 },
          ],
        },
        10,
      ),
    ).toBe(2);
  });

  it("aree note che superano la griglia: nessuna soluzione", () => {
    expect(
      countSolutions({
        rows: 2,
        cols: 2,
        clues: [
          { r: 0, c: 0, n: 4 },
          { r: 1, c: 1 },
        ],
      }),
    ).toBe(0);
  });
});
