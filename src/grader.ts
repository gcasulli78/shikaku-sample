import { type Candidate, candidatesFor, clueIndexMap, type SolveInput } from "./solver";
import { DIFFICULTIES, type Difficulty, type Rect, sameRect } from "./types";

/**
 * Grades the difficulty by solving the way a person would: rules in order of cost, starting again
 * from the simplest after each progress. The difficulty is the most advanced rule that was needed.
 *
 *  0 Easy      single shape: a number with only one possible rectangle.
 *  1 Medium    cell contested by a single number; cells shared by all shapes of a number.
 *  2 Hard      no holes: a shape is discarded if it would leave cells or numbers without coverage.
 *  3 Expert    guess: a shape is tried (among at most 3) and discarded if, with the Easy and
 *              Medium deductions, it leads to a contradiction.
 *  4 Master    deep guess: among at most 6 shapes, and refuting it may need the holes or a
 *              second guess inside the first.
 */

export interface GradeResult {
  difficulty: Difficulty;
  /** How many times each rule was used, per level. */
  steps: number[];
  solved: boolean;
  /** Placed rectangles, by number index (undefined if unsolved). */
  placed: (Rect | undefined)[];
  /** Deduction steps used (see WORK_BUDGET). */
  work: number;
}

interface State {
  cands: Candidate[][];
  placed: (Rect | undefined)[];
  occupied: Uint8Array;
}

type Outcome = "progress" | "none" | "contradiction";

function cloneState(s: State): State {
  return { cands: s.cands.map((list) => [...list]), placed: [...s.placed], occupied: s.occupied.slice() };
}

function overlapsCells(cand: Candidate, cells: Set<number> | Uint8Array): boolean {
  if (cells instanceof Uint8Array) return cand.cells.some((idx) => cells[idx] === 1);
  return cand.cells.some((idx) => cells.has(idx));
}

/** Places the shape of number i and removes from the others the shapes that touch it. */
function place(s: State, i: number, cand: Candidate): void {
  s.placed[i] = cand.rect;
  s.cands[i] = [cand];
  for (const idx of cand.cells) s.occupied[idx] = 1;
  const taken = new Set(cand.cells);
  s.cands.forEach((list, j) => {
    if (j !== i && !s.placed[j]) s.cands[j] = list.filter((c) => !overlapsCells(c, taken));
  });
}

/** Why a state is impossible: a number with no shapes left, or a cell nobody covers. */
export type Conflict = { kind: "starved"; clue: number } | { kind: "uncovered"; cell: number };

function conflictIn(s: State, total: number): Conflict | undefined {
  const covered = new Uint8Array(total);
  for (let i = 0; i < s.cands.length; i++) {
    if (s.placed[i]) continue;
    const list = s.cands[i]!;
    if (list.length === 0) return { kind: "starved", clue: i };
    for (const cand of list) for (const idx of cand.cells) covered[idx] = 1;
  }
  for (let idx = 0; idx < total; idx++) if (!s.occupied[idx] && !covered[idx]) return { kind: "uncovered", cell: idx };
  return undefined;
}

function isContradiction(s: State, total: number): boolean {
  return conflictIn(s, total) !== undefined;
}

// --- Rules ---

function ruleSingle(s: State): Outcome {
  for (let i = 0; i < s.cands.length; i++) {
    if (!s.placed[i] && s.cands[i]!.length === 1) {
      place(s, i, s.cands[i]![0]!);
      return "progress";
    }
  }
  return "none";
}

function ruleCellOwner(s: State, total: number): Outcome {
  const owners: number[][] = Array.from({ length: total }, () => []);
  s.cands.forEach((list, i) => {
    if (s.placed[i]) return;
    for (const cand of list) {
      for (const idx of cand.cells) {
        const o = owners[idx]!;
        if (o[o.length - 1] !== i) o.push(i);
      }
    }
  });
  let outcome: Outcome = "none";
  for (let idx = 0; idx < total; idx++) {
    if (s.occupied[idx] || owners[idx]!.length !== 1) continue;
    const i = owners[idx]![0]!;
    const list = s.cands[i]!;
    const kept = list.filter((cand) => cand.cells.includes(idx));
    if (kept.length < list.length) {
      s.cands[i] = kept;
      outcome = "progress";
    }
  }
  return outcome;
}

function ruleSureCells(s: State): Outcome {
  let outcome: Outcome = "none";
  for (let i = 0; i < s.cands.length; i++) {
    if (s.placed[i]) continue;
    const [first, ...rest] = s.cands[i]!;
    if (!first) continue;
    const sure = new Set(first.cells.filter((idx) => rest.every((cand) => cand.cells.includes(idx))));
    if (sure.size === 0) continue;
    s.cands.forEach((list, j) => {
      if (j === i || s.placed[j]) return;
      const kept = list.filter((cand) => !overlapsCells(cand, sure));
      if (kept.length < list.length) {
        s.cands[j] = kept;
        outcome = "progress";
      }
    });
  }
  return outcome;
}

/** Would placing cand (of number i) leave a number without shapes or an uncovered cell? */
function leavesHole(s: State, i: number, cand: Candidate, total: number, covered: Uint8Array, taken: Uint8Array): boolean {
  covered.fill(0);
  taken.fill(0);
  for (const idx of cand.cells) taken[idx] = 1;
  for (let j = 0; j < s.cands.length; j++) {
    if (j === i || s.placed[j]) continue;
    let any = false;
    for (const other of s.cands[j]!) {
      if (other.cells.some((idx) => taken[idx] === 1)) continue;
      any = true;
      for (const idx of other.cells) covered[idx] = 1;
    }
    if (!any) return true;
  }
  for (let idx = 0; idx < total; idx++) if (!s.occupied[idx] && !taken[idx] && !covered[idx]) return true;
  return false;
}

function ruleNoHole(s: State, total: number): Outcome {
  const covered = new Uint8Array(total);
  const taken = new Uint8Array(total);
  let outcome: Outcome = "none";
  for (let i = 0; i < s.cands.length; i++) {
    if (s.placed[i] || s.cands[i]!.length < 2) continue;
    const kept = s.cands[i]!.filter((cand) => !leavesHole(s, i, cand, total, covered, taken));
    if (kept.length < s.cands[i]!.length) {
      s.cands[i] = kept;
      outcome = "progress";
    }
  }
  return outcome;
}

/**
 * Guesses are only made on numbers with few possible shapes, as a person would: how many shapes at
 * most and up to which level to reason inside the guess.
 */
const GUESS = { options: 3, level: 1 };
const DEEP_GUESS = { options: 6, level: 3 };

/**
 * Deduction steps allowed for a grading, guesses included. With many open clues deep guesses
 * explode (up to seconds per puzzle): when the budget runs out it stops as if there were no more
 * deductions, so no shape is wrongly discarded and the puzzle only comes out as "unsolved".
 * Measured on 15×15: in Classic a grading doesn't exceed ~3000 steps, in Shapes it reached 60000
 * (10 s).
 */
export const WORK_BUDGET = 8000;

interface Work {
  done: number;
}

/** Applies the rules up to level maxLevel as long as there is progress. */
function propagate(s: State, total: number, maxLevel: number, steps: number[], work: Work): "solved" | "stuck" | "contradiction" {
  for (;;) {
    if (++work.done > WORK_BUDGET) return "stuck";
    if (isContradiction(s, total)) return "contradiction";
    if (s.placed.every((r) => r !== undefined)) return "solved";

    let outcome: Outcome = "none";
    let level = 0;
    const rules: [number, () => Outcome][] = [
      [0, () => ruleSingle(s)],
      [1, () => ruleCellOwner(s, total)],
      [1, () => ruleSureCells(s)],
      [2, () => ruleNoHole(s, total)],
      [3, () => ruleGuess(s, total, GUESS, work)],
      [4, () => ruleGuess(s, total, DEEP_GUESS, work)],
    ];
    for (const [ruleLevel, rule] of rules) {
      if (ruleLevel > maxLevel) break;
      outcome = rule();
      level = ruleLevel;
      if (outcome !== "none") break;
    }
    if (outcome === "contradiction") return "contradiction";
    if (outcome === "none") return "stuck";
    steps[level]!++;
  }
}

/**
 * Tries each shape (numbers with fewer choices first) and discards those that lead to a
 * contradiction following the rules up to guess.level (the contradiction check at each step already
 * covers the most obvious holes).
 */
function ruleGuess(s: State, total: number, guess: { options: number; level: number }, work: Work): Outcome {
  const order = s.cands
    .map((list, i) => ({ i, n: list.length }))
    .filter(({ i, n }) => !s.placed[i] && n >= 2 && n <= guess.options)
    .sort((a, b) => a.n - b.n);
  for (const { i } of order) {
    const kept = s.cands[i]!.filter((cand) => {
      const trial = cloneState(s);
      place(trial, i, cand);
      return (
        propagate(
          trial,
          total,
          guess.level,
          DIFFICULTIES.map(() => 0),
          work,
        ) !== "contradiction"
      );
    });
    if (kept.length < s.cands[i]!.length) {
      s.cands[i] = kept;
      return "progress";
    }
  }
  return "none";
}

function initialState(input: SolveInput): State {
  const clueAt = clueIndexMap(input);
  // Black cells are like already covered: no rule must deal with them.
  const occupied = new Uint8Array(input.rows * input.cols);
  for (const idx of input.blocked ?? []) occupied[idx] = 1;
  return {
    cands: input.clues.map((_, i) => candidatesFor(input, i, clueAt)),
    placed: input.clues.map(() => undefined),
    occupied,
  };
}

/** Places a rectangle if it is a possible shape of its number; false otherwise. */
function placeRect(s: State, rect: Rect): boolean {
  const i = s.cands.findIndex((list, j) => !s.placed[j] && list.some((cand) => sameRect(cand.rect, rect)));
  if (i < 0) return false;
  place(s, i, s.cands[i]!.find((cand) => sameRect(cand.rect, rect))!);
  return true;
}

/** The initial state with the pieces already placed (correct). */
function stateWith(input: SolveInput, given: readonly Rect[]): State {
  const s = initialState(input);
  for (const rect of given) placeRect(s, rect);
  return s;
}

/** maxLevel limits the rules used: beyond it, the puzzle comes out unsolved. */
export function grade(input: SolveInput, maxLevel = DIFFICULTIES.length - 1): GradeResult {
  const total = input.rows * input.cols;
  const state = initialState(input);
  const steps = DIFFICULTIES.map(() => 0);
  const work: Work = { done: 0 };
  const result = propagate(state, total, maxLevel, steps, work);
  const highest = steps.reduce((max, n, level) => (n > 0 ? level : max), 0);
  return {
    difficulty: DIFFICULTIES[highest]!.id,
    steps,
    solved: result === "solved",
    placed: state.placed,
    work: work.done,
  };
}

/**
 * What's wrong with a discarded shape, looking at the grid after placing it: a cell no number can
 * cover anymore, or a number left without room.
 */
export type Problem = { cell: number } | { clue: number };

/**
 * A discarded shape and the problem it creates; forced: the chain, the numbers that with that shape
 * can fit in only one way, one after the other (empty if the problem is immediate). A number is
 * forced if it has a single shape left, or (cell) if it is the only one reaching a cell and reaches
 * it in only one way.
 */
export interface Discard {
  rect: Rect;
  forced: { clue: number; rect: Rect; cell?: number }[];
  problem: Problem;
}

/**
 * How the piece is reached: "single" if the number has only one possible shape, "direct" if every
 * other shape immediately creates a problem, "chain" if some of them need one more step.
 */
export type DeductionKind = "single" | "direct" | "chain";

export interface Deduction {
  /** Index of the number and its shape, now forced. */
  clue: number;
  rect: Rect;
  kind: DeductionKind;
  /** The other possible shapes, each with its problem (empty if "single"). */
  discards: Discard[];
  /**
   * The cell only this number reaches, if it is the problem of all the discarded shapes: then
   * saying that one is enough ("solo il 6 arriva alla casella evidenziata").
   */
  only?: number;
}

/** Distance between a cell and the center of a rectangle, in cells. */
function distance(idx: number, cols: number, rect: Rect): number {
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  return Math.abs(r + 0.5 - (rect.r + rect.h / 2)) + Math.abs(c + 0.5 - (rect.c + rect.w / 2));
}

/** The problem closest to rect in state s (undefined if there is none). */
function problemNear(s: State, input: SolveInput, rect: Rect): Problem | undefined {
  const { cols } = input;
  const total = input.rows * cols;
  const covered = new Uint8Array(total);
  let best: { problem: Problem; d: number } | undefined;
  const consider = (problem: Problem, idx: number) => {
    const d = distance(idx, cols, rect);
    if (!best || d < best.d) best = { problem, d };
  };
  s.cands.forEach((list, i) => {
    if (s.placed[i]) return;
    if (list.length === 0) consider({ clue: i }, input.clues[i]!.r * cols + input.clues[i]!.c);
    for (const cand of list) for (const idx of cand.cells) covered[idx] = 1;
  });
  for (let idx = 0; idx < total; idx++) if (!s.occupied[idx] && !covered[idx]) consider({ cell: idx }, idx);
  return best?.problem;
}

/** The forced numbers in the state (see Discard): they weren't already forced on the visible grid s. */
function forcedIn(state: State, s: State, input: SolveInput): Discard["forced"] {
  const steps: Discard["forced"] = [];
  const seen = (j: number, rect: Rect) => steps.some((st) => st.clue === j && sameRect(st.rect, rect));
  state.cands.forEach((list, j) => {
    if (!state.placed[j] && list.length === 1 && s.cands[j]!.length > 1) steps.push({ clue: j, rect: list[0]!.rect });
  });
  const total = input.rows * input.cols;
  const owners: number[][] = Array.from({ length: total }, () => []);
  state.cands.forEach((list, j) => {
    if (state.placed[j]) return;
    for (const cand of list) for (const idx of cand.cells) if (owners[idx]![owners[idx]!.length - 1] !== j) owners[idx]!.push(j);
  });
  for (let idx = 0; idx < total; idx++) {
    if (state.occupied[idx] || owners[idx]!.length !== 1) continue;
    const j = owners[idx]![0]!;
    const covering = state.cands[j]!.filter((cand) => cand.cells.includes(idx));
    if (state.cands[j]!.length > 1 && covering.length === 1 && !seen(j, covering[0]!.rect))
      steps.push({ clue: j, rect: covering[0]!.rect, cell: idx });
  }
  return steps;
}

/** Maximum forced pieces in a chain: beyond that, the explanation can't be followed anymore. */
export const MAX_CHAIN = 3;

/**
 * Why shape cand of number i is impossible, looking only at the grid: once placed, it immediately
 * creates a problem; or (chain) another number can fit in only one way, and once that is placed
 * maybe yet another one, up to the problem. The shortest chain, at most MAX_CHAIN pieces. undefined
 * if it can't be seen this way.
 */
function discardOf(s: State, input: SolveInput, i: number, cand: Candidate, maxChain: number): Discard | undefined {
  const first = cloneState(s);
  place(first, i, cand);
  let level: { state: State; forced: Discard["forced"] }[] = [{ state: first, forced: [] }];
  for (let depth = 0; depth <= maxChain && level.length > 0; depth++) {
    for (const { state, forced } of level) {
      const last = forced[forced.length - 1]?.rect ?? cand.rect;
      const problem = problemNear(state, input, last);
      if (problem) return { rect: cand.rect, forced, problem };
    }
    if (depth === maxChain) break;
    const next: typeof level = [];
    for (const { state, forced } of level) {
      for (const step of forcedIn(state, s, input)) {
        const after = cloneState(state);
        place(after, step.clue, state.cands[step.clue]!.find((c) => sameRect(c.rect, step.rect))!);
        next.push({ state: after, forced: [...forced, step] });
      }
    }
    level = next;
  }
  return undefined;
}

/**
 * The next piece, reasoning like a person on one number at a time: "where can it go?". Only the
 * visible grid is considered (the placed pieces, which must be correct): the possible shapes are
 * those that don't touch pieces, other numbers or black cells. A number is deduced if all its
 * shapes but one have a visible problem (discardOf). Among the deducible numbers the simplest is
 * chosen: single shape, then immediate problems, then short chains; on a tie fewer shapes to
 * discard, then the closest to near (the last move). No abstract rules ("only it can cover the
 * cell", guesses with unstated contradictions): reported by the user, the sentences were hard to
 * understand and seemed wrong. Longer chains are the most expensive: after maxMs it settles for
 * what it has found. undefined if no number can be deduced this way.
 */
export function nextDeduction(input: SolveInput, given: readonly Rect[], near?: Rect, maxMs = Infinity): Deduction | undefined {
  const deadline = performance.now() + maxMs;
  const s = stateWith(input, given);
  if (isContradiction(s, input.rows * input.cols)) return undefined;
  const nearness = (i: number) => (near ? distance(input.clues[i]!.r * input.cols + input.clues[i]!.c, input.cols, near) : i);
  const open = s.placed.flatMap((rect, i) => (rect ? [] : [i])).sort((a, b) => nearness(a) - nearness(b));

  const singles = open.filter((i) => s.cands[i]!.length === 1);
  if (singles.length > 0) return { clue: singles[0]!, rect: s.cands[singles[0]!]![0]!.rect, kind: "single", discards: [] };

  // Ever longer chains only if the shorter ones aren't enough: it's also much faster.
  let best: { found: Deduction; cost: number } | undefined;
  for (let maxChain = 0; maxChain <= MAX_CHAIN && !best; maxChain++) {
    for (const i of open) {
      if (performance.now() > deadline) break;
      const list = s.cands[i]!;
      // With more shapes to discard it can't beat the best one.
      if (best && list.length - 1 > best.found.discards.length) continue;
      let survivor: Candidate | undefined;
      const discards: Discard[] = [];
      for (const cand of list) {
        const discard = discardOf(s, input, i, cand, maxChain);
        if (discard) discards.push(discard);
        else if (survivor) {
          survivor = undefined;
          break;
        } else survivor = cand;
      }
      if (!survivor || discards.length !== list.length - 1) continue;
      const kind: DeductionKind = discards.some((dis) => dis.forced.length > 0) ? "chain" : "direct";
      // On equal chains fewer shapes to discard, then the closest (open is in order).
      if (!best || discards.length < best.cost)
        best = { found: { clue: i, rect: survivor.rect, kind, discards }, cost: discards.length };
    }
  }
  // A cell only this number reaches and that no discarded shape covers: it is the problem of all of
  // them, and showing that one is enough.
  if (best && best.found.kind !== "single") {
    const found = best.found;
    const rest = s.cands[found.clue]!.filter((cand) => !sameRect(cand.rect, found.rect));
    const survivorCells = s.cands[found.clue]!.find((cand) => sameRect(cand.rect, found.rect))!.cells;
    const only = survivorCells.find(
      (idx) =>
        !s.occupied[idx] &&
        rest.every((cand) => !cand.cells.includes(idx)) &&
        open.every((j) => j === found.clue || !s.cands[j]!.some((cand) => cand.cells.includes(idx))),
    );
    if (only !== undefined) {
      found.only = only;
      found.discards = found.discards.map((dis) => ({ rect: dis.rect, forced: [], problem: { cell: only } }));
    }
  }
  return best?.found;
}

/** Cap per call of solvableByDeduction: generous, what matters is that the deduction exists. */
const SIMULATION_CALL_MS = 2000;

/**
 * Can the end be reached with the hint deductions alone (nextDeduction), starting from the empty
 * grid and placing the deduced piece each time? This one game is enough: placing correct pieces
 * doesn't remove deductions (discarded shapes stay discarded, forced pieces stay forced or are left
 * with a single shape), so whatever correct pieces the player has placed, the first deduction of
 * this sequence they are missing still holds. The game on click has a lower cap (DEDUCTION_MS): on
 * a slow device it may still fall back.
 */
export function solvableByDeduction(input: SolveInput, solution: readonly Rect[]): boolean {
  const given: Rect[] = [];
  let last: Rect | undefined;
  while (given.length < solution.length) {
    const found = nextDeduction(input, given, last, SIMULATION_CALL_MS);
    if (!found || !solution.some((rect) => sameRect(rect, found.rect))) return false;
    given.push(found.rect);
    last = found.rect;
  }
  return true;
}

/**
 * Why rect (which matches its clue) is wrong: placed on top of the correct pieces given, the
 * contradiction that can be seen immediately. Only that one: one that comes from following other
 * steps is invisible to the player ("il 6 non avrebbe più spazio" when the 6 is free), and no short
 * sentence explains it. Measured: even the one-step rules on the visible grid (cell of a single
 * clue, safe cells) only give immediate contradictions. undefined if there is no immediate one.
 */
export function conflictOf(input: SolveInput, given: readonly Rect[], rect: Rect): Conflict | undefined {
  const s = stateWith(input, given);
  if (!placeRect(s, rect)) return undefined;
  return conflictIn(s, input.rows * input.cols);
}
