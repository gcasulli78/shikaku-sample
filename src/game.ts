import { area, contains, overlaps, sameRect, type Clue, type Puzzle, type Rect } from "./types";

/** Un'azione annullabile: rettangoli tolti e aggiunti insieme. */
interface Action {
  removed: Rect[];
  added: Rect[];
}

/** Esito di un suggerimento: rettangoli sbagliati tolti oppure un pezzo corretto posato. */
export type Hint = { removed: Rect[] } | { placed: Rect };

export class Game {
  readonly puzzle: Puzzle;
  private rects: Rect[] = [];
  private history: Action[] = [];
  hintsUsed = 0;

  constructor(puzzle: Puzzle) {
    this.puzzle = puzzle;
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

  /** Valido se contiene un solo numero e l'area coincide. */
  isValid(rect: Rect): boolean {
    const inside = this.cluesIn(rect);
    return inside.length === 1 && inside[0]!.n === area(rect);
  }

  rectAt(r: number, c: number): Rect | undefined {
    return this.rects.find((rect) => contains(rect, r, c));
  }

  /** Libero se non sovrappone nessun rettangolo già posato. */
  canPlace(rect: Rect): boolean {
    return !this.rects.some((other) => overlaps(other, rect));
  }

  /** Posa un rettangolo solo se non ne sovrappone altri; false se rifiutato. */
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
    this.rects = this.rects.filter((rect) => !action.added.includes(rect));
    this.rects.push(...action.removed);
  }

  /** Rettangoli posati che non fanno parte della soluzione. */
  wrong(): Rect[] {
    return this.rects.filter((rect) => !this.puzzle.solution.some((sol) => sameRect(rect, sol)));
  }

  /**
   * Prima toglie tutti i rettangoli sbagliati; solo se non ce ne sono posa un pezzo
   * mancante della soluzione (che a quel punto è sempre libero). undefined se è già risolto.
   */
  hint(): Hint | undefined {
    const wrong = this.wrong();
    if (wrong.length > 0) {
      this.apply({ removed: wrong, added: [] });
      this.hintsUsed++;
      return { removed: wrong };
    }
    const missing = this.puzzle.solution.find((sol) => !this.rects.some((rect) => sameRect(rect, sol)));
    if (!missing) return undefined;
    this.place(missing);
    this.hintsUsed++;
    return { placed: missing };
  }

  isSolved(): boolean {
    const covered = this.rects.reduce((sum, rect) => sum + area(rect), 0);
    return covered === this.puzzle.rows * this.puzzle.cols && this.rects.every((rect) => this.isValid(rect));
  }

  private apply(action: Action): void {
    this.rects = this.rects.filter((rect) => !action.removed.includes(rect));
    this.rects.push(...action.added);
    this.history.push(action);
  }
}

/** Cronometro con pausa; l'orologio è iniettabile per i test. */
export class Timer {
  private elapsedBefore = 0;
  private startedAt: number | undefined;

  constructor(private readonly now: () => number = () => performance.now()) {}

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

  reset(): void {
    this.elapsedBefore = 0;
    this.startedAt = undefined;
  }

  /** Millisecondi trascorsi. */
  elapsed(): number {
    return this.elapsedBefore + (this.startedAt === undefined ? 0 : this.now() - this.startedAt);
  }
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
