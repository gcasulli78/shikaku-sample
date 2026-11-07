import { type Clue, fits, type Rect } from "./types";

export interface SolveInput {
  rows: number;
  cols: number;
  clues: Clue[];
  /** Black cells (r * cols + c): no rectangle covers them. */
  blocked?: number[];
}

/** In the clue map: black cell (indices ≥ 0 are clues, -1 a free cell). */
export const BLOCKED = -2;

export interface SolveResult {
  /** Solutions found, stopping at `limit`. */
  count: number;
  /** The solutions found, one per clue in the same order as `clues`. */
  solutions: Rect[][];
  /** Search interrupted because the budget (steps or time) ran out: count is not reliable. */
  aborted: boolean;
}

export interface Candidate {
  rect: Rect;
  /** Cell indices (r * cols + c). */
  cells: number[];
}

/** Index of each cell → number it contains (-1 if empty, BLOCKED if black). */
export function clueIndexMap(input: SolveInput): Int32Array {
  const clueAt = new Int32Array(input.rows * input.cols).fill(-1);
  for (const idx of input.blocked ?? []) clueAt[idx] = BLOCKED;
  input.clues.forEach((cl, i) => {
    clueAt[cl.r * input.cols + cl.c] = i;
  });
  return clueAt;
}

/** Sizes (h, w) allowed by the clue: with a known area only the divisors, otherwise all of them. */
function sizesFor(clue: Clue, rows: number, cols: number): [number, number][] {
  const sizes: [number, number][] = [];
  for (let h = 1; h <= rows; h++) {
    for (let w = 1; w <= cols; w++) {
      if (fits(clue, { r: 0, c: 0, h, w })) sizes.push([h, w]);
    }
  }
  return sizes;
}

/** All the rectangles that match the clue, contain it and contain no other clues or black cells. */
export function candidatesFor(input: SolveInput, clueIndex: number, clueAt: Int32Array): Candidate[] {
  const { rows, cols, clues } = input;
  const clue = clues[clueIndex]!;
  const result: Candidate[] = [];
  for (const [h, w] of sizesFor(clue, rows, cols)) {
    for (let r = Math.max(0, clue.r - h + 1); r <= Math.min(clue.r, rows - h); r++) {
      for (let c = Math.max(0, clue.c - w + 1); c <= Math.min(clue.c, cols - w); c++) {
        const cells: number[] = [];
        let ok = true;
        for (let rr = r; rr < r + h && ok; rr++) {
          for (let cc = c; cc < c + w; cc++) {
            const idx = rr * cols + cc;
            const owner = clueAt[idx]!;
            if (owner !== -1 && owner !== clueIndex) {
              ok = false;
              break;
            }
            cells.push(idx);
          }
        }
        if (ok) result.push({ rect: { r, c, h, w }, cells });
      }
    }
  }
  return result;
}

/**
 * Counts the solutions with backtracking, stopping at `limit`. Heuristics: at each step candidates
 * touching occupied cells are discarded, it fails if a free cell is covered by no candidate, and it
 * branches on the cell covered by the fewest candidates (cells with a single candidate are forced).
 * `maxNodes` limits the search steps: with many open-area clues, in rare cases the search explodes
 * (567 thousand steps, 30 s on a 15×15 Shapes). One step, however, can be very costly (200 thousand
 * steps in 36 s on a link with 12 "?"): `maxMs` limits the time too.
 */
export function solve(input: SolveInput, limit = 2, maxNodes = Infinity, maxMs = Infinity): SolveResult {
  const { rows, cols, clues } = input;
  const total = rows * cols;
  const blocked = input.blocked ?? [];
  const result: SolveResult = { count: 0, solutions: [], aborted: false };
  let nodes = 0;
  const deadline = performance.now() + maxMs;

  // With all areas known the sum must match exactly; with open areas it can't exceed the grid.
  const known = clues.filter((cl) => cl.n !== undefined);
  const sum = known.reduce((s, cl) => s + cl.n!, 0);
  const free = total - blocked.length;
  if (known.length === clues.length ? sum !== free : sum > free) return result;

  const clueAt = new Int32Array(total).fill(-1);
  for (const idx of blocked) clueAt[idx] = BLOCKED;
  for (let i = 0; i < clues.length; i++) {
    const cl = clues[i]!;
    const idx = cl.r * cols + cl.c;
    if ((cl.n !== undefined && cl.n < 1) || clueAt[idx] !== -1) return result;
    clueAt[idx] = i;
  }

  const candidates = clues.map((_, i) => candidatesFor(input, i, clueAt));
  // Black cells count as already covered.
  const occupied = new Uint8Array(total);
  for (const idx of blocked) occupied[idx] = 1;
  const placed = new Uint8Array(clues.length);
  const chosen: (Rect | undefined)[] = new Array(clues.length);
  const coverCount = new Int32Array(total);
  let remaining = clues.length;
  let covered = blocked.length;

  const isFree = (cand: Candidate) => cand.cells.every((idx) => occupied[idx] === 0);

  const place = (clueIndex: number, cand: Candidate) => {
    for (const idx of cand.cells) occupied[idx] = 1;
    placed[clueIndex] = 1;
    chosen[clueIndex] = cand.rect;
    remaining--;
    covered += cand.cells.length;
  };
  const unplace = (clueIndex: number, cand: Candidate) => {
    for (const idx of cand.cells) occupied[idx] = 0;
    placed[clueIndex] = 0;
    chosen[clueIndex] = undefined;
    remaining++;
    covered -= cand.cells.length;
  };

  const search = (): boolean => {
    // The clock is checked every 256 steps.
    if (++nodes > maxNodes || ((nodes & 255) === 0 && performance.now() > deadline)) {
      result.aborted = true;
      return true;
    }
    if (remaining === 0) {
      // With open areas all clues can be placed while leaving cells uncovered.
      if (covered < total) return false;
      result.count++;
      result.solutions.push(chosen.map((r) => ({ ...r! })));
      return result.count >= limit;
    }

    // Candidates still placeable for each unplaced clue, and cell coverage.
    coverCount.fill(0);
    const valid: Candidate[][] = new Array(clues.length);
    for (let i = 0; i < clues.length; i++) {
      if (placed[i]) continue;
      const list = candidates[i]!.filter(isFree);
      if (list.length === 0) return false;
      valid[i] = list;
      for (const cand of list) for (const idx of cand.cells) coverCount[idx]!++;
    }

    // Free cell covered by the fewest candidates; clue with the fewest candidates.
    let bestCell = -1;
    let bestCellCount = Infinity;
    for (let idx = 0; idx < total; idx++) {
      if (occupied[idx]) continue;
      const n = coverCount[idx]!;
      if (n === 0) return false;
      if (n < bestCellCount) {
        bestCellCount = n;
        bestCell = idx;
      }
    }
    let bestClue = -1;
    let bestClueCount = Infinity;
    for (let i = 0; i < clues.length; i++) {
      const list = valid[i];
      if (list && list.length < bestClueCount) {
        bestClueCount = list.length;
        bestClue = i;
      }
    }

    if (bestCellCount < bestClueCount) {
      // Branches on what covers the most constrained cell.
      for (let i = 0; i < clues.length; i++) {
        const list = valid[i];
        if (!list) continue;
        for (const cand of list) {
          if (!cand.cells.includes(bestCell)) continue;
          place(i, cand);
          const stop = search();
          unplace(i, cand);
          if (stop) return true;
        }
      }
    } else {
      for (const cand of valid[bestClue]!) {
        place(bestClue, cand);
        const stop = search();
        unplace(bestClue, cand);
        if (stop) return true;
      }
    }
    return false;
  };

  search();
  return result;
}

export function countSolutions(input: SolveInput, limit = 2): number {
  return solve(input, limit).count;
}
