/**
 * Measures the generator and the hints, per variant: for each grid and level it generates SEEDS
 * puzzles with the same options as the game (maxCandidates 10 000, TIME_LIMITS) and on each one
 * simulates a game made only of hints, from the empty grid to the end, counting the "Nessuna
 * deduzione semplice". One JSON line per puzzle in measurements/.
 *
 * Environment variables: SEEDS (10), ONLY ("15x15:hard": a single grid and level), VARIANT (a
 * single variant). The thresholds in CLAUDE.md come from these measurements: if the generator,
 * grader or hints change, measure again (npm run measure).
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { generate } from "../../src/generator";
import { nextDeduction } from "../../src/grader";
import { availableDifficulties, type Rect, sameRect, TIME_LIMITS, type Variant } from "../../src/types";
import { OUT_DIR, type Row } from "./rows";

/** The measured grids: small and large squares, and a rectangular one. */
const SIZES = [
  { rows: 7, cols: 7 },
  { rows: 8, cols: 8 },
  { rows: 10, cols: 10 },
  { rows: 15, cols: 15 },
  { rows: 8, cols: 12 },
];

/** Cap for each deduction in the simulation: here what matters is that it exists (the game has 300 ms on click). */
const CALL_CAP = 4000;
/** The game's cap: slower deductions fall back there. */
const GAME_CALL_MS = 300;

export function measure(variant: Variant): void {
  if (process.env.VARIANT && process.env.VARIANT !== variant) return;
  const seeds = Number(process.env.SEEDS ?? 10);
  const only = process.env.ONLY;
  mkdirSync(OUT_DIR, { recursive: true });
  const out = `${OUT_DIR}/${variant}.jsonl`;
  writeFileSync(out, "");
  for (const size of SIZES) {
    for (const difficulty of availableDifficulties(size)) {
      const key = `${size.rows}x${size.cols}`;
      if (only && only !== `${key}:${difficulty}`) continue;
      for (let k = 0; k < seeds; k++) {
        const seed = 1000 + k * 7919;
        const t0 = performance.now();
        const p = generate({ ...size, difficulty, variant, seed, maxCandidates: 10_000, timeLimitMs: TIME_LIMITS[difficulty] });
        const genMs = performance.now() - t0;
        const given: Rect[] = [];
        let fallbacks = 0;
        let slow = 0;
        let maxCall = 0;
        let simMs = 0;
        let firstFail = -1;
        let last: Rect | undefined;
        while (given.length < p.solution.length) {
          const c0 = performance.now();
          const found = nextDeduction(p, given, last, CALL_CAP);
          const dt = performance.now() - c0;
          simMs += dt;
          maxCall = Math.max(maxCall, dt);
          if (dt > GAME_CALL_MS) slow++;
          let rect = found && p.solution.some((s) => sameRect(s, found.rect)) ? found.rect : undefined;
          if (!rect) {
            fallbacks++;
            if (firstFail < 0) firstFail = given.length;
            rect = p.solution.find((s) => !given.some((g) => sameRect(g, s)))!;
          }
          given.push(rect);
          last = rect;
        }
        const row: Row = {
          variant,
          size: key,
          asked: difficulty,
          got: p.difficulty,
          unique: p.unique,
          pieces: p.solution.length,
          genMs: Math.round(genMs),
          simMs: Math.round(simMs),
          maxCall: Math.round(maxCall),
          slow,
          fallbacks,
          firstFail,
        };
        appendFileSync(out, `${JSON.stringify(row)}\n`);
      }
    }
  }
}
