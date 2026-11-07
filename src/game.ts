import { conflictOf, type DeductionKind, nextDeduction } from "./grader";
import { area, type Clue, contains, fits, overlaps, type Puzzle, type Rect, sameRect } from "./types";

/** An undoable action: rectangles removed and added together. */
interface Action {
  removed: Rect[];
  added: Rect[];
}

/** The problem of a discarded shape: a cell nobody covers, or a clue with no room. */
export type Problem = { cell: { r: number; c: number } } | { clue: Clue };

/**
 * A discarded shape, the chain of forced pieces leading to the problem (cell: the clue is the only
 * one that reaches that cell), and the problem.
 */
export interface Discard {
  rect: Rect;
  forced: { clue: Clue; rect: Rect; cell?: { r: number; c: number } }[];
  problem: Problem;
}

/** Why the hinted piece is forced (see nextDeduction): the clue's other shapes, discarded. */
export interface Reason {
  kind: DeductionKind;
  clue: Clue;
  discards: Discard[];
  /** The cell that only this clue reaches, the problem of all the discarded shapes. */
  only?: { r: number; c: number };
}

/**
 * Why a rectangle is wrong: no clues or more than one, area or shape not matching the clue, or
 * placing it immediately leaves a clue with no room or a cell with no coverage. misplaced: it
 * matches the clue but the reason can't be seen from the grid (it only comes from following other
 * steps): the hint shows that clue's correct piece.
 */
export type WrongReason =
  | { kind: "empty" }
  | { kind: "many"; count: number }
  | { kind: "area" | "shape"; clue: Clue }
  | { kind: "starved"; clue: Clue }
  | { kind: "uncovered"; cell: { r: number; c: number } }
  | { kind: "misplaced"; clue: Clue };

/**
 * Result of a hint, in steps: first the clue to reason about (focus), then the reason (explain),
 * then the placed piece (placed). If there are wrong rectangles they are all removed, explaining
 * the first one; if the first one is misplaced its clue's correct piece is placed too (placed), or,
 * during the cooldown, at the next hint. A piece placed without a reason comes from the solution:
 * when the grader's rules aren't enough, or (fix) in place of a wrong rectangle of that clue. wait:
 * the piece isn't placed yet, this many ms are missing (HINT_COOLDOWN since the last hinted piece).
 * quiet: hint without steps or explanations (quiet option): removes the errors or places a piece;
 * left, how many remain.
 */
export type Hint =
  | { quiet: true; removed: Rect[]; placed?: Rect; left: number }
  | { removed: Rect[]; wrong: { rect: Rect; why: WrongReason }; placed?: Rect }
  | { wait: number }
  | { focus: Reason }
  | { explain: Reason }
  | { placed: Rect; reason?: Reason; fix?: Clue };

/**
 * Maximum time to search for the hint, in ms: it runs on click, on the page thread. Measured: on
 * 15×15 Shapes it reached ~320 ms on the computer (more on the phone).
 */
const DEDUCTION_MS = 300;

/** Minimum wait between two pieces placed by the hint, in ms (decided by the user). */
export const HINT_COOLDOWN = 15_000;

export interface SavedGame {
  rects: Rect[];
  hintsUsed: number;
  /** When the hint placed its last piece, in game time (stopwatch ms). */
  lastPlacedAt?: number;
  /** Any help used (even just one hint step or the check). */
  helped?: boolean;
  /** Checks used (missing in games saved before the limits: 0). */
  checksUsed?: number;
}

export interface GameOptions {
  hintCooldown?: number;
  /** Hints per game (HINT_LIMITS); missing: unlimited. */
  hintLimit?: number;
  /** Hint without steps or explanations (Master and Shapes Expert); goes with hintLimit. */
  quiet?: boolean;
  /** Checks per game (CHECK_LIMITS); missing: unlimited. */
  checkLimit?: number;
}

export class Game {
  readonly puzzle: Puzzle;
  private rects: Rect[] = [];
  private history: Action[] = [];
  /** Pieces placed or errors removed by the hint. */
  hintsUsed = 0;
  /** Times the check was used. */
  checksUsed = 0;
  /** Any help used: matters for the "no help" record. */
  helped = false;
  /** The hint in progress and the step already shown; a move resets it. */
  private pending: { rect: Rect; reason?: Reason; fix?: Clue; stage: 1 | 2 } | undefined;
  /** When the hint placed its last piece, in game time; see HINT_COOLDOWN. */
  private lastPlacedAt: number | undefined;
  /** The last rectangle placed or removed: the hint prefers nearby clues. */
  private lastMove: Rect | undefined;
  /** Wait between two hinted pieces, in ms: 0 in the tutorial. */
  readonly hintCooldown: number;
  /**
   * Hints per game, if limited (HINT_LIMITS, per level): placed pieces and removed errors count,
   * not steps. undefined: unlimited.
   */
  readonly hintLimit: number | undefined;
  /** Hint without steps, explanations or cooldown (Master and Shapes Expert). */
  readonly quiet: boolean;
  /** Checks per game, if limited (CHECK_LIMITS). undefined: unlimited. */
  readonly checkLimit: number | undefined;
  /** Black cells, one per cell (r * cols + c). */
  private readonly black: Uint8Array;

  constructor(puzzle: Puzzle, options: GameOptions = {}) {
    this.puzzle = puzzle;
    this.hintCooldown = options.hintCooldown ?? HINT_COOLDOWN;
    this.hintLimit = options.hintLimit;
    this.quiet = options.quiet ?? false;
    this.checkLimit = options.checkLimit;
    this.black = new Uint8Array(puzzle.rows * puzzle.cols);
    for (const idx of puzzle.blocked ?? []) this.black[idx] = 1;
  }

  /** The state to save: placed rectangles and hints used (not the Undo history). */
  snapshot(): SavedGame {
    return {
      rects: this.rects.map((rect) => ({ ...rect })),
      hintsUsed: this.hintsUsed,
      helped: this.helped,
      lastPlacedAt: this.lastPlacedAt,
      checksUsed: this.checksUsed,
    };
  }

  /** Resumes a saved game; overlapping rectangles are discarded. */
  static restore(puzzle: Puzzle, saved: SavedGame, options: GameOptions = {}): Game {
    const game = new Game(puzzle, options);
    for (const rect of saved.rects) if (game.canPlace(rect)) game.rects.push({ ...rect });
    game.hintsUsed = saved.hintsUsed;
    game.helped = saved.helped ?? saved.hintsUsed > 0;
    game.lastPlacedAt = saved.lastPlacedAt;
    game.checksUsed = saved.checksUsed ?? 0;
    return game;
  }

  get placed(): readonly Rect[] {
    return this.rects;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  cluesIn(rect: Rect): Clue[] {
    return this.puzzle.clues.filter((cl) => contains(rect, cl.r, cl.c));
  }

  /** Valid if it contains exactly one clue and matches its area and shape. */
  isValid(rect: Rect): boolean {
    const inside = this.cluesIn(rect);
    return inside.length === 1 && fits(inside[0]!, rect);
  }

  /**
   * "bad" if it is surely wrong: several clues, or area already reached or exceeded without
   * matching the clue (enlarging it won't fix it). "open" if it is still uncertain.
   */
  status(rect: Rect): "valid" | "bad" | "open" {
    if (this.isValid(rect)) return "valid";
    const inside = this.cluesIn(rect);
    const n = inside[0]?.n;
    return inside.length > 1 || (inside.length === 1 && n !== undefined && n <= area(rect)) ? "bad" : "open";
  }

  /**
   * What a drag that draws rect does: a tap (1×1) removes the rectangle underneath or closes a clue
   * that allows a single cell, otherwise it does nothing; a larger rectangle is placed if it is
   * free.
   */
  intent(rect: Rect): "remove" | "place" | "blocked" | "none" {
    if (area(rect) === 1) {
      if (this.rectAt(rect.r, rect.c)) return "remove";
      return this.isValid(rect) ? "place" : "none";
    }
    return this.canPlace(rect) ? "place" : "blocked";
  }

  rectAt(r: number, c: number): Rect | undefined {
    return this.rects.find((rect) => contains(rect, r, c));
  }

  isBlocked(r: number, c: number): boolean {
    return this.black[r * this.puzzle.cols + c] === 1;
  }

  /** Free if it overlaps no already placed rectangle and no black cells. */
  canPlace(rect: Rect): boolean {
    if (this.rects.some((other) => overlaps(other, rect))) return false;
    for (let r = rect.r; r < rect.r + rect.h; r++)
      for (let c = rect.c; c < rect.c + rect.w; c++) if (this.isBlocked(r, c)) return false;
    return true;
  }

  /** Places a rectangle only if it doesn't overlap others; false if rejected. */
  place(rect: Rect): boolean {
    if (!this.canPlace(rect)) return false;
    this.apply({ removed: [], added: [{ ...rect }] });
    return true;
  }

  remove(rect: Rect): void {
    const existing = this.rects.find((other) => sameRect(other, rect));
    if (existing) this.apply({ removed: [existing], added: [] });
  }

  clear(): void {
    if (this.rects.length > 0) this.apply({ removed: [...this.rects], added: [] });
  }

  undo(): void {
    const action = this.history.pop();
    if (!action) return;
    this.pending = undefined;
    this.rects = this.rects.filter((rect) => !action.added.includes(rect));
    this.rects.push(...action.removed);
  }

  /** Placed rectangles that are not part of the solution. */
  private wrong(): Rect[] {
    return this.rects.filter((rect) => !this.puzzle.solution.some((sol) => sameRect(rect, sol)));
  }

  /**
   * How many of the placed rectangles are wrong, without saying which (Check button). undefined if
   * the checks are used up.
   */
  check(): number | undefined {
    if (this.checksLeft === 0) return undefined;
    this.checksUsed++;
    this.helped = true;
    return this.wrong().length;
  }

  /** Checks left, if limited (undefined: unlimited). */
  get checksLeft(): number | undefined {
    return this.checkLimit === undefined ? undefined : Math.max(0, this.checkLimit - this.checksUsed);
  }

  /**
   * How many ms are left before the hint can place another piece; now is the game time. A last
   * piece "in the future" (saved with the system clock, before the stopwatch was used) doesn't
   * block.
   */
  cooldown(now: number): number {
    if (this.lastPlacedAt === undefined || this.lastPlacedAt > now) return 0;
    return Math.max(0, this.lastPlacedAt + this.hintCooldown - now);
  }

  /** The hint step already shown: 0 none, 1 the clue, 2 the reason too. */
  get hintStage(): 0 | 1 | 2 {
    return this.pending?.stage ?? 0;
  }

  /**
   * First removes all wrong rectangles, explaining the first one. If there are none, the next piece
   * reached by reasoning from the placed pieces (nextDeduction), in steps: clue, reason, piece. If
   * the rules aren't enough it immediately places a missing piece of the solution (which at that
   * point is always free). undefined if already solved or the hints are used up. With a limit,
   * removing the errors and placing the correct piece in the same click counts only once.
   */
  hint(now: number): Hint | undefined {
    if (this.hintsLeft === 0) return undefined;
    if (this.quiet) return this.quietHint();
    const wrong = this.wrong();
    if (wrong.length > 0) {
      const why = this.whyWrong(wrong[0]!);
      this.apply({ removed: wrong, added: [] });
      this.hintsUsed++;
      this.helped = true;
      const removed = { removed: wrong, wrong: { rect: wrong[0]!, why } };
      if (why.kind !== "misplaced") return removed;
      const rect = this.puzzle.solution[this.puzzle.clues.indexOf(why.clue)]!;
      // During the cooldown the correct piece stays ready for the next hint.
      if (this.cooldown(now) > 0) {
        this.pending = { rect, fix: why.clue, stage: 2 };
        return removed;
      }
      // Doesn't go through placeHinted: the cooldown is already checked and this click has already
      // been counted.
      this.lastPlacedAt = now;
      this.place(rect);
      return { ...removed, placed: rect };
    }
    const missing = this.nearestMissing();
    if (!missing) return undefined;
    this.helped = true;
    if (!this.pending) {
      const found = this.deduce();
      if (!found) return this.placeHinted(missing, undefined, now);
      this.pending = { ...found, stage: 1 };
      return { focus: found.reason };
    }
    const { rect, reason, fix, stage } = this.pending;
    if (stage === 1 && reason) {
      this.pending = { rect, reason, stage: 2 };
      return { explain: reason };
    }
    const placed = this.placeHinted(rect, reason, now);
    return fix && "placed" in placed ? { ...placed, fix } : placed;
  }

  /** Hints left, if limited (undefined: unlimited). */
  get hintsLeft(): number | undefined {
    return this.hintLimit === undefined ? undefined : Math.max(0, this.hintLimit - this.hintsUsed);
  }

  /**
   * Hint without explanations (decided by the user for Master and Shapes Expert): one use removes
   * all wrong rectangles or, if there are none, places a piece; no explanation. The piece is the
   * deduced one if there is one (close to where the player is reasoning), otherwise the missing one
   * closest to the last move. undefined if already solved.
   */
  private quietHint(): Hint | undefined {
    const wrong = this.wrong();
    if (wrong.length > 0) {
      this.apply({ removed: wrong, added: [] });
      this.hintsUsed++;
      this.helped = true;
      return { quiet: true, removed: wrong, left: this.hintsLeft! };
    }
    const rect = this.deduce()?.rect ?? this.nearestMissing();
    if (!rect) return undefined;
    this.place(rect);
    this.hintsUsed++;
    this.helped = true;
    return { quiet: true, removed: [], placed: rect, left: this.hintsLeft! };
  }

  /** Places the hinted piece, if HINT_COOLDOWN ms of game time have passed since the last one. */
  private placeHinted(rect: Rect, reason: Reason | undefined, now: number): Hint {
    const wait = this.cooldown(now);
    if (wait > 0) return { wait };
    this.hintsUsed++;
    this.lastPlacedAt = now;
    this.place(rect);
    return reason ? { placed: rect, reason } : { placed: rect };
  }

  /** The missing solution piece closest to the last move. */
  private nearestMissing(): Rect | undefined {
    const missing = this.puzzle.solution.filter((sol) => !this.rects.some((rect) => sameRect(rect, sol)));
    const near = this.lastMove;
    if (!near) return missing[0];
    const dist = (rect: Rect) =>
      Math.abs(rect.r + rect.h / 2 - (near.r + near.h / 2)) + Math.abs(rect.c + rect.w / 2 - (near.c + near.w / 2));
    return missing.reduce<Rect | undefined>((best, rect) => (!best || dist(rect) < dist(best) ? rect : best), undefined);
  }

  /** The next deducible piece, with the reason. */
  private deduce(): { rect: Rect; reason: Reason } | undefined {
    const found = nextDeduction(this.puzzle, this.rects, this.lastMove, DEDUCTION_MS);
    // Deductions hold for every solution: outside the solution only if it isn't unique.
    if (!found || !this.puzzle.solution.some((sol) => sameRect(sol, found.rect))) return undefined;
    const { clues } = this.puzzle;
    const discards = found.discards.map(({ rect, forced, problem }) => ({
      rect,
      forced: forced.map((f) =>
        f.cell === undefined
          ? { clue: clues[f.clue]!, rect: f.rect }
          : { clue: clues[f.clue]!, rect: f.rect, cell: this.cellAt(f.cell) },
      ),
      problem: "cell" in problem ? { cell: this.cellAt(problem.cell) } : { clue: clues[problem.clue]! },
    }));
    const reason: Reason = { kind: found.kind, clue: clues[found.clue]!, discards };
    if (found.only !== undefined) reason.only = this.cellAt(found.only);
    return { rect: found.rect, reason };
  }

  private cellAt(idx: number): { r: number; c: number } {
    return { r: Math.floor(idx / this.puzzle.cols), c: idx % this.puzzle.cols };
  }

  /** Why a placed rectangle is wrong (see WrongReason). */
  whyWrong(rect: Rect): WrongReason {
    const inside = this.cluesIn(rect);
    if (inside.length === 0) return { kind: "empty" };
    if (inside.length > 1) return { kind: "many", count: inside.length };
    const clue = inside[0]!;
    if (clue.n !== undefined && clue.n !== area(rect)) return { kind: "area", clue };
    if (!fits(clue, rect)) return { kind: "shape", clue };
    const correct = this.rects.filter((other) => this.puzzle.solution.some((sol) => sameRect(sol, other)));
    const conflict = conflictOf(this.puzzle, correct, rect);
    if (conflict?.kind === "starved") return { kind: "starved", clue: this.puzzle.clues[conflict.clue]! };
    if (conflict?.kind === "uncovered") return { kind: "uncovered", cell: this.cellAt(conflict.cell) };
    return { kind: "misplaced", clue };
  }

  isSolved(): boolean {
    const covered = this.rects.reduce((sum, rect) => sum + area(rect), 0);
    const free = this.puzzle.rows * this.puzzle.cols - (this.puzzle.blocked?.length ?? 0);
    return covered === free && this.rects.every((rect) => this.isValid(rect));
  }

  private apply(action: Action): void {
    this.pending = undefined;
    this.lastMove = action.added[0] ?? action.removed[0] ?? this.lastMove;
    this.rects = this.rects.filter((rect) => !action.removed.includes(rect));
    this.rects.push(...action.added);
    this.history.push(action);
  }
}

/**
 * Stopwatch with pause; the clock can be injected for tests. System clock and not
 * performance.now(): on some phones that one stops while the device sleeps, while the time with the
 * page open must count that too (decided by the user).
 */
export class Timer {
  private elapsedBefore = 0;
  private startedAt: number | undefined;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get running(): boolean {
    return this.startedAt !== undefined;
  }

  start(): void {
    if (this.startedAt === undefined) this.startedAt = this.now();
  }

  pause(): void {
    if (this.startedAt === undefined) return;
    this.elapsedBefore += this.now() - this.startedAt;
    this.startedAt = undefined;
  }

  /** Resets, or restarts from an already elapsed time (resumed game). */
  reset(elapsed = 0): void {
    this.elapsedBefore = elapsed;
    this.startedAt = undefined;
  }

  /** Elapsed milliseconds. */
  elapsed(): number {
    // Phone clock moved back during the game: the time doesn't decrease.
    return this.elapsedBefore + (this.startedAt === undefined ? 0 : Math.max(0, this.now() - this.startedAt));
  }
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
