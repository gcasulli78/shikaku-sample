import { grade, solvableByDeduction } from "./grader";
import { createRng, pick, type Rng, randomSeed } from "./rng";
import { type SolveInput, solve } from "./solver";
import {
  area,
  type Clue,
  DIFFICULTIES,
  type Difficulty,
  difficultyLevel,
  hintsExplained,
  type Puzzle,
  type Rect,
  sameRect,
  shapeOf,
  type Variant,
} from "./types";

export interface GenerateOptions {
  rows: number;
  cols: number;
  difficulty?: Difficulty;
  /** Classic (numbers only, default), Shapes (clues with shape and area, possibly open) or Blocked (black cells). */
  variant?: Variant;
  seed?: number;
  /** Unique-solution puzzles to grade before settling for the closest one. */
  maxCandidates?: number;
  /** Number moves tried on each candidate to bring it closer to the requested difficulty. */
  tuneMoves?: number;
  /** Maximum time in ms: when it runs out the best one found is returned (makes the result non-deterministic). */
  timeLimitMs?: number;
  /** Different partitions to try to get a unique-solution puzzle. */
  maxAttempts?: number;
  /** Number moves to try on each ambiguous partition. */
  maxFixes?: number;
}

export interface GenerateResult extends Puzzle {
  seed: number;
  /** False only if no attempt produced a unique solution. */
  unique: boolean;
  /** Measured difficulty, which may differ from the requested one if that wasn't found. */
  difficulty: Difficulty;
  /** False if not even the Master rules are enough to solve it (trial and error is needed). */
  logical: boolean;
}

/**
 * How the puzzles of a level are built: larger shapes with more factorizations, numbers far from
 * the shape's edges → more open possibilities.
 */
export interface Profile {
  /** Maximum area relative to the longest side of the grid. */
  areaFactor: number;
  /** Shape weight ∝ area^sizeExp. */
  sizeExp: number;
  /** Bonus for areas with many possible shapes (6, 8, 12…). */
  compositeBonus: number;
  /** Cell weight for the number ∝ (1 + distance from the shape's edge)^interior; negative = edges. */
  interior: number;
}

export const PROFILES: Record<Difficulty, Profile> = {
  easy: { areaFactor: 0.8, sizeExp: 0, compositeBonus: 0, interior: -2 },
  medium: { areaFactor: 1, sizeExp: 0.5, compositeBonus: 0.5, interior: 0 },
  hard: { areaFactor: 1.6, sizeExp: 1, compositeBonus: 1, interior: 2 },
  expert: { areaFactor: 2, sizeExp: 1.5, compositeBonus: 1.5, interior: 3 },
  // Medium shapes with many factorizations: with larger shapes Master becomes rarer (measured).
  master: { areaFactor: 1.3, sizeExp: 1, compositeBonus: 2.5, interior: 3 },
};

/** Probability of accepting a 1×1 when there are larger alternatives. */
const SINGLE_CELL_CHANCE = 0.05;

export function maxAreaFor(rows: number, cols: number, profile: Profile = PROFILES.medium): number {
  return Math.max(6, Math.round(Math.max(rows, cols) * profile.areaFactor));
}

function divisorCount(n: number): number {
  let count = 0;
  for (let d = 1; d <= n; d++) if (n % d === 0) count++;
  return count;
}

function pickWeighted<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  const weights = items.map(weight);
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    x -= weights[i]!;
    if (x < 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/**
 * Extra weight of horizontal rectangles in the balanced partition: compensates for the
 * one-column-wide strips, where only vertical ones fit. With 2 the horizontal/vertical ratio is
 * 0.94–1.21 on 8×8, 10×10, 15×15 and 8×15 (measured, 200 partitions per grid).
 */
const WIDE_WEIGHT = 2;

/**
 * Cuts the grid into random rectangles that cover everything without overlapping. `balanced`: as
 * many horizontal as vertical ones (see layout).
 */
export function partition(rows: number, cols: number, rng: Rng, profile: Profile = PROFILES.medium, balanced = false): Rect[] {
  const maxArea = maxAreaFor(rows, cols, profile);
  const used = new Uint8Array(rows * cols);
  const rects: Rect[] = [];
  const shapeWeight = (o: Rect) =>
    area(o) ** profile.sizeExp *
    (1 + (profile.compositeBonus * (divisorCount(area(o)) - 2)) / 2) *
    (balanced && o.w > o.h ? WIDE_WEIGHT : 1);

  for (let idx = 0; idx < rows * cols; idx++) {
    if (used[idx]) continue;
    const r = Math.floor(idx / cols);
    const c = idx % cols;

    // Maximum free width on the starting row; then it goes down as long as the rows are free.
    let maxW = 0;
    while (c + maxW < cols && !used[r * cols + c + maxW]) maxW++;
    const options: Rect[] = [];
    for (let w = 1; w <= maxW; w++) {
      for (let h = 1; r + h <= rows && w * h <= maxArea; h++) {
        let free = true;
        for (let cc = c; cc < c + w; cc++) {
          if (used[(r + h - 1) * cols + cc]) {
            free = false;
            break;
          }
        }
        if (!free) break;
        options.push({ r, c, h, w });
      }
    }

    // Balanced: only the shapes that would also fit rotated, so horizontal and vertical ones have
    // the same chances (if anything besides the 1×1 is left).
    const fit = balanced ? new Set(options.map((o) => o.h * 100 + o.w)) : undefined;
    const symmetric = fit ? options.filter((o) => area(o) > 1 && fit.has(o.w * 100 + o.h)) : [];
    const bigger = symmetric.length > 0 ? symmetric : options.filter((o) => area(o) > 1);
    const rect = bigger.length > 0 && rng() >= SINGLE_CELL_CHANCE ? pickWeighted(rng, bigger, shapeWeight) : pick(rng, options);
    for (let rr = rect.r; rr < rect.r + rect.h; rr++) {
      for (let cc = rect.c; cc < rect.c + rect.w; cc++) used[rr * cols + cc] = 1;
    }
    rects.push(rect);
  }
  return mergeSingles(rects, rng, maxArea);
}

/** Union of two rectangles if it is itself a rectangle (side by side with a shared side). */
function union(a: Rect, b: Rect): Rect | undefined {
  if (a.r === b.r && a.h === b.h && (a.c + a.w === b.c || b.c + b.w === a.c)) {
    return { r: a.r, c: Math.min(a.c, b.c), h: a.h, w: a.w + b.w };
  }
  if (a.c === b.c && a.w === b.w && (a.r + a.h === b.r || b.r + b.h === a.r)) {
    return { r: Math.min(a.r, b.r), c: a.c, h: a.h + b.h, w: a.w };
  }
  return undefined;
}

/**
 * Row-by-row filling often leaves isolated cells (1×1, trivial clues): each one merges with a
 * neighbor when the union is still a not-too-large rectangle.
 */
function mergeSingles(rects: Rect[], rng: Rng, maxArea: number): Rect[] {
  const result = [...rects];
  for (let i = 0; i < result.length; i++) {
    const single = result[i]!;
    if (area(single) !== 1) continue;
    const options: { index: number; merged: Rect }[] = [];
    result.forEach((other, index) => {
      if (index === i) return;
      const merged = union(single, other);
      if (merged && area(merged) <= maxArea) options.push({ index, merged });
    });
    if (options.length === 0 || rng() < SINGLE_CELL_CHANCE) continue;
    const { index, merged } = pick(rng, options);
    result[index] = merged;
    result.splice(i, 1);
    i = -1; // start over: the positions have changed
  }
  return result;
}

/**
 * What a clue shows in the Shapes variant: only the number, shape and number, only the shape, or
 * nothing ("?"). In Classic there is only the number.
 */
const KINDS = ["number", "shapeNumber", "shape", "any"] as const;
type Kind = (typeof KINDS)[number];

/**
 * Weights of the clue kinds per level (same order as KINDS): the higher the level, the more open
 * clues. Easy has no open clues (otherwise on 15×15 it isn't found in time); Master has fewer than
 * Expert because its difficulty comes from deep guesses, which with too many open clues exhaust the
 * grader's budget (measured).
 */
export const SHAPE_KINDS: Record<Difficulty, readonly number[]> = {
  easy: [0.3, 0.7, 0, 0],
  medium: [0.3, 0.4, 0.25, 0.05],
  hard: [0.25, 0.3, 0.35, 0.1],
  expert: [0.25, 0.25, 0.35, 0.15],
  master: [0.35, 0.4, 0.2, 0.05],
};
const CLASSIC_KINDS: readonly number[] = [1, 0, 0, 0];

/**
 * Probability that a clue with a non-square shape also tells the orientation (horizontal or
 * vertical) instead of the cross: the orientation halves the possible shapes, so it weighs more at
 * low levels. Measured on 15×15 (16 seeds): Hard at 0.3 drops to 15/16, Master at 0.15 to 10/16;
 * with these values 16/16 (Master 15/16, as before oriented clues).
 */
export const ORIENTED: Record<Difficulty, number> = { easy: 0.5, medium: 0.4, hard: 0.15, expert: 0.15, master: 0 };

/** The clue of the rectangle in the given cell, with the information of the chosen kind. */
function dress(cell: { r: number; c: number }, rect: Rect, kind: Kind, s: Setup): Clue {
  const clue: Clue = { r: cell.r, c: cell.c };
  if (kind === "number" || kind === "shapeNumber") clue.n = area(rect);
  if (kind === "shape" || kind === "shapeNumber") {
    const shape = shapeOf(rect);
    clue.shape = shape !== "square" && s.rng() >= s.oriented ? "oblong" : shape;
  }
  return clue;
}

/** Cell of the rectangle for the clue, preferring the interior or the edges according to the profile. */
function pickCell(rect: Rect, rng: Rng, profile: Profile): { r: number; c: number } {
  const cells: { r: number; c: number }[] = [];
  for (let r = rect.r; r < rect.r + rect.h; r++) for (let c = rect.c; c < rect.c + rect.w; c++) cells.push({ r, c });
  const depth = ({ r, c }: { r: number; c: number }) =>
    Math.min(r - rect.r, rect.r + rect.h - 1 - r) + Math.min(c - rect.c, rect.c + rect.w - 1 - c);
  return pickWeighted(rng, cells, (cell) => (1 + depth(cell)) ** profile.interior);
}

/**
 * Share of black cells in the Blocked variant. Black cells remove possibilities and make puzzles
 * easier: measured (8 seeds) with 8% the level is always found up to Hard (8×15 Hard 7/8); at high
 * levels with 8% Expert and Master on 15×15 dropped to 1/8 and 0/8, with 3% to 3/8 and 2/8 (4/8 and
 * 2/8 with double the time of the advance preparation), 10×10 7/8 and 6/8.
 */
export const BLACK_RATE: Record<Difficulty, number> = { easy: 0.08, medium: 0.08, hard: 0.08, expert: 0.03, master: 0.03 };

/**
 * Blackens small pieces (1 or 2 cells) of the partition up to the black cell share. At high levels
 * small pieces are few: then a strip of 1 or 2 cells is cut off the edge of a narrow rectangle
 * (which stays a rectangle). Black cells scattered at random, instead, take room away from large
 * pieces and make puzzles too easy: with 3% Master could no longer be found (measured).
 */
function blackenSmall(s: Setup, rects: Rect[]): { solution: Rect[]; blocked: number[] } {
  const { rng, cols } = s;
  const target = Math.round(s.rows * cols * s.blackRate);
  const solution = [...rects];
  const blocked: number[] = [];
  const blacken = (rect: Rect) => {
    for (let r = rect.r; r < rect.r + rect.h; r++) for (let c = rect.c; c < rect.c + rect.w; c++) blocked.push(r * cols + c);
  };
  const small = solution.filter((rect) => area(rect) <= 2);
  while (blocked.length < target && small.length > 0) {
    const rect = small.splice(Math.floor(rng() * small.length), 1)[0]!;
    solution.splice(solution.indexOf(rect), 1);
    blacken(rect);
  }
  // Strips: a rectangle 1–2 wide loses its first or last row, one 1–2 tall loses a column.
  const narrow = solution.map((_, i) => i).filter((i) => area(solution[i]!) > 2 && Math.min(solution[i]!.h, solution[i]!.w) <= 2);
  while (blocked.length < target && narrow.length > 0) {
    const i = narrow.splice(Math.floor(rng() * narrow.length), 1)[0]!;
    const rect = solution[i]!;
    const first = rng() < 0.5;
    if (rect.w <= 2 && rect.h > 1) {
      blacken({ r: first ? rect.r : rect.r + rect.h - 1, c: rect.c, h: 1, w: rect.w });
      solution[i] = { ...rect, r: first ? rect.r + 1 : rect.r, h: rect.h - 1 };
    } else {
      blacken({ r: rect.r, c: first ? rect.c : rect.c + rect.w - 1, h: rect.h, w: 1 });
      solution[i] = { ...rect, c: first ? rect.c + 1 : rect.c, w: rect.w - 1 };
    }
  }
  return { solution, blocked: blocked.sort((a, b) => a - b) };
}

/** How a puzzle is built: dimensions, randomness, level profile and clue kinds. */
interface Setup {
  rows: number;
  cols: number;
  rng: Rng;
  profile: Profile;
  kinds: readonly number[];
  /** Probability of an oriented clue (ORIENTED), 0 in Classic. */
  oriented: number;
  /** Partition balanced between horizontal and vertical (BALANCED). */
  balanced: boolean;
  /** Black cell share (BLACK_RATE), 0 outside the Blocked variant. */
  blackRate: number;
}

function placeClue(rect: Rect, s: Setup): Clue {
  const cell = pickCell(rect, s.rng, s.profile);
  // In Classic no draw of the kind: same random sequence as before (Master, with the original
  // partition, generates the same puzzles per seed).
  return dress(cell, rect, s.kinds === CLASSIC_KINDS ? "number" : pickKind(s), s);
}

function pickKind(s: Setup): Kind {
  return pickWeighted(s.rng, KINDS, (k) => s.kinds[KINDS.indexOf(k)]!);
}

/** Same clue kind in another cell of the rectangle (if there is one). */
function relocate(clue: Clue, rect: Rect, s: Setup): Clue {
  let cell = pickCell(rect, s.rng, s.profile);
  for (let k = 0; k < 4 && cell.r === clue.r && cell.c === clue.c; k++) cell = pickCell(rect, s.rng, s.profile);
  return { ...clue, r: cell.r, c: cell.c };
}

/**
 * The same clue with one more piece of information (first the number, then the shape, only in the
 * Shapes variant); undefined if it is already complete. The orientation is not revealed: it makes
 * puzzles too easy and Expert/Master on 15×15 dropped to 14/16 (measured).
 */
function reveal(clue: Clue, rect: Rect, s: Setup): Clue | undefined {
  if (clue.n === undefined) return { ...clue, n: area(rect) };
  if (s.kinds !== CLASSIC_KINDS && clue.shape === undefined && clue.n > 1) {
    const shape = shapeOf(rect);
    return { ...clue, shape: shape === "square" ? shape : "oblong" };
  }
  return undefined;
}

/**
 * Maximum solver steps during generation: fewer than 1000 are usually enough (99.9% out of 16
 * thousand measured checks), one 15×15 Shapes asked for 567 thousand (30 s).
 */
const SOLVE_BUDGET = 20_000;

/**
 * Row-by-row filling favors vertical rectangles (0.23 horizontal per vertical on 15×15, and 4
 * puzzles out of 5 almost all vertical): per level, whether the partition is balanced (in both
 * variants). Master stays as it was: the balanced one has smaller pieces and on 15×15 it dropped to
 * 10/16 in Shapes and to 2/8 in Classic (measured); Expert in Classic holds up (42/48 versus 39/48
 * on 15×15, 8×15, 10×10).
 */
export const BALANCED: Record<Difficulty, boolean> = { easy: true, medium: true, hard: true, expert: true, master: false };

function layout(s: Setup): Rect[] {
  return partition(s.rows, s.cols, s.rng, s.profile, s.balanced);
}

/** Dimensions and black cells: everything the solver and grader need besides the clues. */
type Board = Omit<SolveInput, "clues">;

/**
 * Unique-solution puzzle: random partition, one clue per rectangle, then as long as the solver
 * finds an alternative the clues of the rectangles the alternative doesn't respect are corrected
 * (revealing more information, or moving them if they are already complete); if that's not enough
 * it starts over with a new partition.
 */
function generateUnique(s: Setup, maxAttempts: number, maxFixes: number) {
  let fallback: { board: Board; clues: Clue[]; solution: Rect[]; unique: boolean } | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Without black cells (share 0) blackenSmall draws nothing: Classic and Shapes stay as before.
    const { solution, blocked } = blackenSmall(s, layout(s));
    const board: Board = blocked.length > 0 ? { rows: s.rows, cols: s.cols, blocked } : { rows: s.rows, cols: s.cols };
    const clues = solution.map((rect) => placeClue(rect, s));

    for (let fix = 0; fix <= maxFixes; fix++) {
      const { count, solutions, aborted } = solve({ ...board, clues }, 2, SOLVE_BUDGET);
      if (!aborted && count === 1) return { board, clues, solution, unique: true };
      fallback ??= { board, clues: clues.map((cl) => ({ ...cl })), solution, unique: false };
      // Search too long: uniqueness can't be verified, better another partition.
      if (aborted) break;

      const alternative = solutions.find((sol) => !sol.every((rect, i) => sameRect(rect, solution[i]!)));
      if (!alternative) break;
      for (let i = 0; i < solution.length; i++) {
        const rect = solution[i]!;
        if (sameRect(rect, alternative[i]!)) continue;
        clues[i] = reveal(clues[i]!, rect, s) ?? (area(rect) > 1 ? relocate(clues[i]!, rect, s) : clues[i]!);
      }
    }
  }
  return fallback!;
}

/**
 * Measured level; puzzles the grader doesn't close count as DIFFICULTIES.length. Below Master the
 * most expensive rule isn't needed: it's enough to know it goes beyond Expert.
 */
function measure(board: Board, clues: Clue[], targetLevel: number): { level: number; steps: number } {
  const graded = grade({ ...board, clues }, Math.max(3, targetLevel));
  if (!graded.solved) return { level: DIFFICULTIES.length, steps: 0 };
  const level = difficultyLevel(graded.difficulty);
  return { level, steps: graded.steps[level]! };
}

/**
 * Local refinement: changes one clue at a time (moves it within its shape or, in the Shapes
 * variant, changes what it shows) and keeps the change if the solution stays unique and the
 * difficulty gets closer to the target (at the same level, more steps at the highest level when
 * going up, fewer when going down).
 */
function tune(
  s: Setup,
  board: Board,
  clues: Clue[],
  solution: Rect[],
  targetLevel: number,
  moves: number,
  outOfTime: () => boolean,
) {
  const { rng } = s;
  const shapes = s.kinds !== CLASSIC_KINDS;
  let current = measure(board, clues, targetLevel);
  // A clue in a 1×1 can't be moved, but in Shapes it can change kind.
  const movable = solution.map((_, i) => i).filter((i) => shapes || area(solution[i]!) > 1);
  if (movable.length === 0) return current;
  // Lower = better.
  const cost = ({ level, steps }: { level: number; steps: number }) =>
    Math.abs(level - targetLevel) * 1000 + (level < targetLevel ? -steps : level > targetLevel ? steps : 0);

  for (let m = 0; m < moves && current.level !== targetLevel && !outOfTime(); m++) {
    const i = pick(rng, movable);
    const previous = clues[i]!;
    const rect = solution[i]!;
    const changeKind = shapes && (area(rect) === 1 || rng() < 0.5);
    const moved = changeKind ? dress(previous, rect, pickKind(s), s) : { ...previous, ...pickCell(rect, rng, s.profile) };
    if (moved.r === previous.r && moved.c === previous.c && moved.n === previous.n && moved.shape === previous.shape) continue;
    clues[i] = moved;
    // The grader only discards impossible shapes: if it closes the puzzle, the solution is unique
    // and the solver is only needed when it doesn't get there.
    const measured = measure(board, clues, targetLevel);
    const unsolved = measured.level === DIFFICULTIES.length;
    const check = unsolved ? solve({ ...board, clues }, 2, SOLVE_BUDGET) : undefined;
    const next = !check || (!check.aborted && check.count === 1) ? measured : undefined;
    if (next && cost(next) <= cost(current)) current = next;
    else clues[i] = previous;
  }
  return current;
}

/**
 * Generates unique-solution puzzles with the requested level's profile, grades them and refines
 * them by moving the numbers; returns the first one of the right difficulty, or the closest.
 */
export function generate(options: GenerateOptions): GenerateResult {
  const { rows, cols } = options;
  const target = options.difficulty ?? "medium";
  const seed = options.seed ?? randomSeed();
  const maxCandidates = options.maxCandidates ?? 8;
  const tuneMoves = options.tuneMoves ?? 150;
  const maxAttempts = options.maxAttempts ?? 200;
  const maxFixes = options.maxFixes ?? 20;
  const rng = createRng(seed);
  const targetLevel = difficultyLevel(target);
  const s: Setup = {
    rows,
    cols,
    rng,
    profile: PROFILES[target],
    kinds: options.variant === "shapes" ? SHAPE_KINDS[target] : CLASSIC_KINDS,
    oriented: options.variant === "shapes" ? ORIENTED[target] : 0,
    balanced: BALANCED[target],
    blackRate: options.variant === "blocked" ? BLACK_RATE[target] : 0,
  };
  const deadline = options.timeLimitMs === undefined ? Infinity : Date.now() + options.timeLimitMs;
  const outOfTime = () => Date.now() > deadline;
  // Where the hints explain, the puzzle must be solvable with their deductions alone.
  const explained = hintsExplained(options.variant ?? "classic", target);

  let best: { result: GenerateResult; distance: number } | undefined;
  // At least one candidate even when time is up.
  for (let k = 0; k < maxCandidates && (k === 0 || !outOfTime()); k++) {
    const { board, clues, solution, unique } = generateUnique(s, maxAttempts, maxFixes);
    const { level } = unique
      ? tune(s, board, clues, solution, targetLevel, tuneMoves, outOfTime)
      : measure(board, clues, targetLevel);
    const logical = level < DIFFICULTIES.length;
    const result: GenerateResult = { ...board, clues, solution, seed, unique, logical, difficulty: labelFor(level) };
    // A non-unique puzzle is always the last choice, one the grader doesn't close the second to
    // last. Of the right level but not solvable with the hints: better than a wrong level.
    let distance = Math.abs(level - targetLevel) + (logical ? 0 : 50) + (unique ? 0 : 100);
    if (distance === 0 && explained && !solvableByDeduction({ ...board, clues }, solution)) distance = 0.5;
    if (distance === 0) return result;
    if (!best || distance < best.distance) best = { result, distance };
  }
  const { result } = best!;
  if (!result.logical && targetLevel < DIFFICULTIES.length - 1) {
    // The measurement was limited: without a limit the true level may be Master.
    const graded = grade(result);
    if (graded.solved) return { ...result, logical: true, difficulty: graded.difficulty };
  }
  return result;
}

/** Beyond the last level the highest label is used anyway (with logical: false). */
function labelFor(level: number): Difficulty {
  return DIFFICULTIES[Math.min(level, DIFFICULTIES.length - 1)]!.id;
}
