import { describe, expect, it } from "vitest";
import { generate, partition } from "../src/generator";
import { createRng } from "../src/rng";
import { grade } from "../src/grader";
import { countSolutions } from "../src/solver";
import { area, contains, type Difficulty, type Puzzle, type Rect } from "../src/types";

const SIZES: [number, number][] = [
  [4, 4],
  [5, 5],
  [8, 8],
  [10, 10],
  [15, 15],
  [4, 15],
  [15, 4],
];
const PUZZLES_PER_SIZE = 50;

function expectExactCover(rows: number, cols: number, rects: Rect[]) {
  const seen = new Uint8Array(rows * cols);
  for (const rect of rects) {
    expect(rect.r).toBeGreaterThanOrEqual(0);
    expect(rect.c).toBeGreaterThanOrEqual(0);
    expect(rect.r + rect.h).toBeLessThanOrEqual(rows);
    expect(rect.c + rect.w).toBeLessThanOrEqual(cols);
    for (let r = rect.r; r < rect.r + rect.h; r++) {
      for (let c = rect.c; c < rect.c + rect.w; c++) {
        expect(seen[r * cols + c], `cella ${r},${c} coperta due volte`).toBe(0);
        seen[r * cols + c] = 1;
      }
    }
  }
  expect(seen.every((v) => v === 1), "griglia non coperta del tutto").toBe(true);
}

function expectValidPuzzle(p: Puzzle) {
  expectExactCover(p.rows, p.cols, p.solution);
  expect(p.clues).toHaveLength(p.solution.length);
  for (const rect of p.solution) {
    const inside = p.clues.filter((cl) => contains(rect, cl.r, cl.c));
    expect(inside).toHaveLength(1);
    expect(inside[0]!.n).toBe(area(rect));
  }
}

describe("partition", () => {
  it("copre la griglia senza sovrapposizioni", () => {
    const rng = createRng(1);
    for (const [rows, cols] of SIZES) {
      for (let i = 0; i < 20; i++) expectExactCover(rows, cols, partition(rows, cols, rng));
    }
  });
});

describe("generate", () => {
  for (const [rows, cols] of SIZES) {
    it(`${rows}×${cols}: ${PUZZLES_PER_SIZE} puzzle validi con soluzione unica`, () => {
      const times: number[] = [];
      let clues = 0;
      let singles = 0;
      for (let seed = 1; seed <= PUZZLES_PER_SIZE; seed++) {
        const start = performance.now();
        const p = generate({ rows, cols, seed });
        times.push(performance.now() - start);
        clues += p.clues.length;
        singles += p.clues.filter((cl) => cl.n === 1).length;
        expect(p.unique, `seed ${seed}`).toBe(true);
        expectValidPuzzle(p);
        expect(countSolutions(p, 2), `seed ${seed}`).toBe(1);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const max = Math.max(...times);
      const singleShare = singles / clues;
      console.log(
        `${rows}×${cols}: media ${avg.toFixed(1)} ms, max ${max.toFixed(1)} ms, numeri "1": ${(singleShare * 100).toFixed(1)}%`,
      );
      expect(avg).toBeLessThan(1000);
      // Gli 1×1 sono indizi banali: devono restare rari.
      expect(singleShare).toBeLessThan(0.05);
    }, 120_000);
  }

  it("è riproducibile con lo stesso seed", () => {
    expect(generate({ rows: 8, cols: 8, seed: 42 })).toEqual(generate({ rows: 8, cols: 8, seed: 42 }));
  });
});

describe("generate con difficoltà", () => {
  // Esperto e Maestro sono più rari e lenti: meno seed e più candidati (senza limite di tempo, per restare deterministici).
  const CASES: [number, number, Difficulty, number][] = [
    [8, 8, "easy", 10],
    [8, 8, "medium", 10],
    [8, 8, "hard", 10],
    [10, 10, "easy", 10],
    [10, 10, "hard", 10],
    [15, 15, "medium", 5],
    [15, 15, "hard", 5],
    [10, 10, "expert", 3],
    [10, 10, "master", 3],
  ];
  for (const [rows, cols, difficulty, n] of CASES) {
    it(`${rows}×${cols} ${difficulty}: livello misurato = livello chiesto`, () => {
      const rare = difficulty === "expert" || difficulty === "master";
      for (let seed = 1; seed <= n; seed++) {
        const p = generate({ rows, cols, difficulty, seed, maxCandidates: rare ? 100 : 8 });
        expect(p.unique, `seed ${seed}`).toBe(true);
        expectValidPuzzle(p);
        expect(p.difficulty, `seed ${seed}`).toBe(difficulty);
        expect(grade(p).difficulty, `seed ${seed}`).toBe(difficulty);
        expect(countSolutions(p, 2), `seed ${seed}`).toBe(1);
      }
    }, 120_000);
  }

  it("rispetta il limite di tempo", () => {
    const start = Date.now();
    generate({ rows: 15, cols: 15, difficulty: "expert", seed: 3, maxCandidates: 10_000, timeLimitMs: 500 });
    // Il candidato in corso può sforare un poco.
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
