/** Rectangle on the grid: top-left corner (r, c), height h, width w. */
export interface Rect {
  r: number;
  c: number;
  h: number;
  w: number;
}

/**
 * Shape imposed by a clue: square, non-square rectangle with free orientation (oblong), or
 * oriented: wider than tall (wide) or taller than wide (tall).
 */
export type Shape = "square" | "oblong" | "wide" | "tall";

/**
 * Clue on the grid: the rectangle containing it must have area n (if present) and the given shape
 * (if present). With neither it is a "?": free shape and area.
 */
export interface Clue {
  r: number;
  c: number;
  n?: number;
  shape?: Shape;
}

/** The exact shape of the rectangle (never oblong, which stands for wide and tall together). */
export function shapeOf(rect: Rect): Shape {
  return rect.h === rect.w ? "square" : rect.w > rect.h ? "wide" : "tall";
}

/** Does the rectangle match the clue's area and shape? */
export function fits(clue: Clue, rect: Rect): boolean {
  if (clue.n !== undefined && clue.n !== area(rect)) return false;
  if (clue.shape === undefined) return true;
  const shape = shapeOf(rect);
  return clue.shape === "oblong" ? shape !== "square" : clue.shape === shape;
}

export type Variant = "classic" | "shapes" | "blocked";

export const VARIANTS: { id: Variant; label: string }[] = [
  { id: "classic", label: "Classico" },
  { id: "shapes", label: "Forme" },
  { id: "blocked", label: "Caselle nere" },
];

export function isVariant(v: unknown): v is Variant {
  return VARIANTS.some((x) => x.id === v);
}

export interface Puzzle {
  rows: number;
  cols: number;
  clues: Clue[];
  /** Black cells (r * cols + c), not to be covered: only in the Blocked variant. */
  blocked?: number[];
  /** A solution (with guaranteed uniqueness, the only one). */
  solution: Rect[];
}

export interface Size {
  rows: number;
  cols: number;
}

export const MIN_SIZE = 4;
export const MAX_SIZE = 15;

export const PRESETS: { id: string; label: string; size: Size }[] = [
  { id: "5x5", label: "5×5", size: { rows: 5, cols: 5 } },
  { id: "8x8", label: "8×8", size: { rows: 8, cols: 8 } },
  { id: "10x10", label: "10×10", size: { rows: 10, cols: 10 } },
  { id: "15x15", label: "15×15", size: { rows: 15, cols: 15 } },
];

export type Difficulty = "easy" | "medium" | "hard" | "expert" | "master";

/** In increasing order: the index is the level used by the grader. */
export const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: "easy", label: "Facile" },
  { id: "medium", label: "Medio" },
  { id: "hard", label: "Difficile" },
  { id: "expert", label: "Esperto" },
  { id: "master", label: "Maestro" },
];

/**
 * Minimum side for the highest levels: below it they can't be found in reasonable time (measured
 * for Expert: 0/30 at 5×5, 2/15 at 4×15, 13/15 at 7×7 with 3 s; for Master: 6/8 at 7×7, 8/8 at 8×8
 * with 10 s).
 */
const MIN_SIDE: Partial<Record<Difficulty, number>> = { expert: 7, master: 8 };

export function minSide(d: Difficulty): number {
  return MIN_SIDE[d] ?? MIN_SIZE;
}

/** The difficulties obtainable on a grid of these dimensions. */
export function availableDifficulties(size: Size): Difficulty[] {
  return DIFFICULTIES.map((d) => d.id).filter((id) => Math.min(size.rows, size.cols) >= minSide(id));
}

/**
 * Generation time allowed per level, in ms. Hard 3 s (was 1.5): with the hint filter (hintsExplained)
 * 15×15 Shapes needs more; the other grids stay below 0.35 s.
 */
export const TIME_LIMITS: Record<Difficulty, number> = { easy: 1000, medium: 1000, hard: 3000, expert: 3000, master: 10000 };

export function difficultyLevel(d: Difficulty): number {
  return DIFFICULTIES.findIndex((x) => x.id === d);
}

export function isDifficulty(v: unknown): v is Difficulty {
  return DIFFICULTIES.some((d) => d.id === v);
}

export function difficultyLabel(d: Difficulty): string {
  return DIFFICULTIES[difficultyLevel(d)]!.label;
}

/**
 * Whether the hint explains (in steps, with the reason) on this level and variant. Here the
 * generator only keeps puzzles that can be solved all the way with the hint deductions
 * (solvableByDeduction). Measured on 2026-10-31 (10 puzzles per grid): 83% or more of Classic and
 * Blocked pass up to Expert and 72% of Shapes at Hard, but only 23–60% at Master and 21% of Shapes
 * at Expert (0% on 15×15). There, as decided by the user, the hint doesn't explain (it immediately
 * places a piece or removes the errors).
 */
export function hintsExplained(variant: Variant, difficulty: Difficulty): boolean {
  return difficulty !== "master" && !(variant === "shapes" && difficulty === "expert");
}

/**
 * Hints per game, per level (decided by the user, the same for every grid and variant): placed
 * pieces and removed errors count, not steps. undefined: unlimited.
 */
export const HINT_LIMITS: Record<Difficulty, number | undefined> = {
  easy: undefined,
  medium: 5,
  hard: 4,
  expert: 3,
  master: 2,
};

/** Checks per game, per level (decided by the user). undefined: unlimited. */
export const CHECK_LIMITS: Record<Difficulty, number | undefined> = {
  easy: undefined,
  medium: 5,
  hard: 3,
  expert: 2,
  master: 1,
};

export function clampSize(n: number): number {
  if (!Number.isFinite(n)) return MIN_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
}

export function area(rect: Rect): number {
  return rect.h * rect.w;
}

export function contains(rect: Rect, r: number, c: number): boolean {
  return r >= rect.r && r < rect.r + rect.h && c >= rect.c && c < rect.c + rect.w;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.r < b.r + b.h && b.r < a.r + a.h && a.c < b.c + b.w && b.c < a.c + a.w;
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.r === b.r && a.c === b.c && a.h === b.h && a.w === b.w;
}

/** Rectangle having the two given cells as opposite corners. */
export function rectFromCorners(r1: number, c1: number, r2: number, c2: number): Rect {
  return {
    r: Math.min(r1, r2),
    c: Math.min(c1, c2),
    h: Math.abs(r1 - r2) + 1,
    w: Math.abs(c1 - c2) + 1,
  };
}
