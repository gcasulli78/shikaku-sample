import { describe, expect, it } from "vitest";
import { generate, partition } from "../src/generator";
import { createRng } from "../src/rng";
import { grade } from "../src/grader";
import { countSolutions } from "../src/solver";
import { contains, fits, type Difficulty, type Puzzle, type Rect } from "../src/types";

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

/** Copertura esatta della griglia, caselle nere escluse (contano come già coperte). */
function expectExactCover(rows: number, cols: number, rects: Rect[], blocked: number[] = []) {
  const seen = new Uint8Array(rows * cols);
  for (const idx of blocked) seen[idx] = 1;
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
  expectExactCover(p.rows, p.cols, p.solution, p.blocked);
  expect(p.clues).toHaveLength(p.solution.length);
  for (const rect of p.solution) {
    const inside = p.clues.filter((cl) => contains(rect, cl.r, cl.c));
    expect(inside).toHaveLength(1);
    expect(fits(inside[0]!, rect)).toBe(true);
  }
}

describe("partition", () => {
  it("copre la griglia senza sovrapposizioni", () => {
    const rng = createRng(1);
    for (const [rows, cols] of SIZES) {
      for (let i = 0; i < 20; i++) expectExactCover(rows, cols, partition(rows, cols, rng));
      for (let i = 0; i < 20; i++) expectExactCover(rows, cols, partition(rows, cols, rng, undefined, true));
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

  for (const [rows, cols] of [
    [8, 8],
    [10, 10],
  ] as const) {
    it(`variante Forme ${rows}×${cols}: ogni livello, soluzione unica e indizi aperti`, () => {
      const open = { shape: 0, area: 0, any: 0, oriented: 0 };
      for (const difficulty of ["easy", "medium", "hard", "expert", "master"] as Difficulty[]) {
        for (let seed = 1; seed <= 2; seed++) {
          const p = generate({ rows, cols, difficulty, variant: "shapes", seed, maxCandidates: 1000 });
          expectValidPuzzle(p);
          expect(p.difficulty, `${difficulty} seed ${seed}`).toBe(difficulty);
          expect(countSolutions(p, 2), `${difficulty} seed ${seed}`).toBe(1);
          for (const cl of p.clues) {
            if (cl.shape) open.shape++;
            if (cl.shape === "wide" || cl.shape === "tall") open.oriented++;
            if (cl.n === undefined) open.area++;
            if (cl.n === undefined && !cl.shape) open.any++;
          }
        }
      }
      // Tutti i tipi di indizio compaiono: forma indicata, orientata, area aperta, "?".
      expect(open.shape).toBeGreaterThan(0);
      expect(open.oriented).toBeGreaterThan(0);
      expect(open.area).toBeGreaterThan(0);
      expect(open.any).toBeGreaterThan(0);
    }, 120_000);
  }

  it("variante Classico: solo numeri", () => {
    const p = generate({ rows: 8, cols: 8, difficulty: "hard", seed: 1 });
    expect(p.clues.every((cl) => cl.n !== undefined && cl.shape === undefined)).toBe(true);
  });

  it("variante Caselle nere: quota di caselle nere, mai sotto un rettangolo, soluzione unica", () => {
    for (const [difficulty, black] of [["easy", 8], ["hard", 8], ["expert", 3]] as [Difficulty, number][]) {
      for (let seed = 1; seed <= 3; seed++) {
        const p = generate({ rows: 10, cols: 10, difficulty, variant: "blocked", seed });
        expectValidPuzzle(p);
        // Si annerisce un pezzo intero, quindi si può sforare di una casella.
        expect(p.blocked!.length, `${difficulty} seed ${seed}`).toBeGreaterThanOrEqual(black);
        expect(p.blocked!.length).toBeLessThanOrEqual(black + 1);
        expect(p.clues.some((cl) => p.blocked!.includes(cl.r * p.cols + cl.c))).toBe(false);
        expect(countSolutions(p)).toBe(1);
      }
    }
  }, 120_000);

  it("Classico e Forme senza caselle nere", () => {
    expect(generate({ rows: 8, cols: 8, seed: 1 }).blocked).toBeUndefined();
    expect(generate({ rows: 8, cols: 8, seed: 1, variant: "shapes" }).blocked).toBeUndefined();
  });

  it("rispetta il limite di tempo", () => {
    const start = Date.now();
    generate({ rows: 15, cols: 15, difficulty: "expert", seed: 3, maxCandidates: 10_000, timeLimitMs: 500 });
    // Il candidato in corso può sforare un poco.
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
