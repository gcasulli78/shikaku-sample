import { conflictOf, nextDeduction, type DeductionKind } from "./grader";
import { area, contains, fits, overlaps, sameRect, type Clue, type Puzzle, type Rect } from "./types";

/** Un'azione annullabile: rettangoli tolti e aggiunti insieme. */
interface Action {
  removed: Rect[];
  added: Rect[];
}

/** Il problema di una forma scartata: una casella che nessuno copre, o un indizio senza spazio. */
export type Problem = { cell: { r: number; c: number } } | { clue: Clue };

/**
 * Una forma scartata, la catena di pezzi obbligati che porta al problema (cell: l'indizio
 * è l'unico ad arrivare a quella casella), e il problema.
 */
export interface Discard {
  rect: Rect;
  forced: { clue: Clue; rect: Rect; cell?: { r: number; c: number } }[];
  problem: Problem;
}

/** Perché il pezzo suggerito è obbligato (vedi nextDeduction): le altre forme dell'indizio, scartate. */
export interface Reason {
  kind: DeductionKind;
  clue: Clue;
  discards: Discard[];
  /** La casella che solo questo indizio raggiunge, problema di tutte le forme scartate. */
  only?: { r: number; c: number };
}

/**
 * Perché un rettangolo è sbagliato: niente indizi o più di uno, area o forma che non
 * rispettano l'indizio, oppure posandolo un indizio resta subito senza spazio o una casella
 * senza copertura. misplaced: rispetta l'indizio ma il motivo non si vede dalla griglia
 * (arriva solo seguendo altri passi): il suggerimento mostra il pezzo giusto di quell'indizio.
 */
export type WrongReason =
  | { kind: "empty" }
  | { kind: "many"; count: number }
  | { kind: "area" | "shape"; clue: Clue }
  | { kind: "starved"; clue: Clue }
  | { kind: "uncovered"; cell: { r: number; c: number } }
  | { kind: "misplaced"; clue: Clue };

/**
 * Esito di un suggerimento, a gradi: prima l'indizio su cui ragionare (focus), poi il
 * motivo (explain), poi il pezzo posato (placed). Se ci sono rettangoli sbagliati si
 * tolgono tutti, spiegando il primo; se il primo è misplaced si posa anche il pezzo giusto
 * del suo indizio (placed), o, durante l'attesa, al suggerimento dopo. Un pezzo posato
 * senza motivo viene dalla soluzione: quando le regole del valutatore non bastano, o (fix)
 * al posto di un rettangolo sbagliato di quell'indizio. wait: il pezzo non si posa ancora,
 * mancano tanti ms (HINT_COOLDOWN dall'ultimo pezzo suggerito). quiet: suggerimento
 * limitato (hintLimit), senza gradi né spiegazioni: toglie gli errori o posa un pezzo; left,
 * quanti ne restano.
 */
export type Hint =
  | { quiet: true; removed: Rect[]; placed?: Rect; left: number }
  | { removed: Rect[]; wrong: { rect: Rect; why: WrongReason }; placed?: Rect }
  | { wait: number }
  | { focus: Reason }
  | { explain: Reason }
  | { placed: Rect; reason?: Reason; fix?: Clue };

/**
 * Tempo massimo per cercare il suggerimento, in ms: gira al clic, sul thread della pagina.
 * Misurato: su 15×15 Forme si arrivava a ~320 ms sul computer (di più sul telefono).
 */
const DEDUCTION_MS = 300;

/** Attesa minima tra due pezzi posati dal suggerimento, in ms (decisa dall'utente). */
export const HINT_COOLDOWN = 15_000;

export interface SavedGame {
  rects: Rect[];
  hintsUsed: number;
  /** Quando il suggerimento ha posato l'ultimo pezzo, in tempo di gioco (ms del cronometro). */
  lastPlacedAt?: number;
  /** Usato un aiuto qualsiasi (anche solo un grado del suggerimento o la verifica). */
  helped?: boolean;
}

export interface GameOptions {
  hintCooldown?: number;
  hintLimit?: number;
}

export class Game {
  readonly puzzle: Puzzle;
  private rects: Rect[] = [];
  private history: Action[] = [];
  /** Pezzi posati o errori tolti dal suggerimento. */
  hintsUsed = 0;
  /** Usato un aiuto qualsiasi: vale per il record "senza aiuti". */
  helped = false;
  /** Il suggerimento in corso e il grado già mostrato; una mossa lo azzera. */
  private pending: { rect: Rect; reason?: Reason; fix?: Clue; stage: 1 | 2 } | undefined;
  /** Quando il suggerimento ha posato l'ultimo pezzo, in tempo di gioco; vedi HINT_COOLDOWN. */
  private lastPlacedAt: number | undefined;
  /** L'ultimo rettangolo posato o tolto: il suggerimento preferisce gli indizi vicini. */
  private lastMove: Rect | undefined;
  /** Attesa tra due pezzi suggeriti, in ms: 0 nel tutorial. */
  readonly hintCooldown: number;
  /**
   * Suggerimenti per partita, se limitati (Maestro e Forme Esperto, vedi hintsExplained):
   * allora niente gradi, spiegazioni né attesa. undefined: senza limite.
   */
  readonly hintLimit: number | undefined;
  /** Caselle nere, una per cella (r * cols + c). */
  private readonly black: Uint8Array;

  constructor(puzzle: Puzzle, options: GameOptions = {}) {
    this.puzzle = puzzle;
    this.hintCooldown = options.hintCooldown ?? HINT_COOLDOWN;
    this.hintLimit = options.hintLimit;
    this.black = new Uint8Array(puzzle.rows * puzzle.cols);
    for (const idx of puzzle.blocked ?? []) this.black[idx] = 1;
  }

  /** Lo stato da salvare: rettangoli posati e suggerimenti usati (la cronologia di Annulla no). */
  snapshot(): SavedGame {
    return {
      rects: this.rects.map((rect) => ({ ...rect })),
      hintsUsed: this.hintsUsed,
      helped: this.helped,
      lastPlacedAt: this.lastPlacedAt,
    };
  }

  /** Riprende una partita salvata; i rettangoli che si sovrappongono si scartano. */
  static restore(puzzle: Puzzle, saved: SavedGame, options: GameOptions = {}): Game {
    const game = new Game(puzzle, options);
    for (const rect of saved.rects) if (game.canPlace(rect)) game.rects.push({ ...rect });
    game.hintsUsed = saved.hintsUsed;
    game.helped = saved.helped ?? saved.hintsUsed > 0;
    game.lastPlacedAt = saved.lastPlacedAt;
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

  /** Valido se contiene un solo indizio e ne rispetta area e forma. */
  isValid(rect: Rect): boolean {
    const inside = this.cluesIn(rect);
    return inside.length === 1 && fits(inside[0]!, rect);
  }

  /**
   * "bad" se è sicuramente sbagliato: più indizi, o area già raggiunta o superata senza
   * rispettare l'indizio (allargandolo non si sistema). "open" se è ancora incerto.
   */
  status(rect: Rect): "valid" | "bad" | "open" {
    if (this.isValid(rect)) return "valid";
    const inside = this.cluesIn(rect);
    const n = inside[0]?.n;
    return inside.length > 1 || (inside.length === 1 && n !== undefined && n <= area(rect)) ? "bad" : "open";
  }

  /**
   * Cosa fa un trascinamento che disegna rect: un tap (1×1) toglie il rettangolo sotto
   * o chiude un indizio che ammette una sola casella, altrimenti non fa niente;
   * un rettangolo più grande si posa se è libero.
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

  /** Libero se non sovrappone nessun rettangolo già posato né caselle nere. */
  canPlace(rect: Rect): boolean {
    if (this.rects.some((other) => overlaps(other, rect))) return false;
    for (let r = rect.r; r < rect.r + rect.h; r++) for (let c = rect.c; c < rect.c + rect.w; c++) if (this.isBlocked(r, c)) return false;
    return true;
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
    this.pending = undefined;
    this.rects = this.rects.filter((rect) => !action.added.includes(rect));
    this.rects.push(...action.removed);
  }

  /** Rettangoli posati che non fanno parte della soluzione. */
  private wrong(): Rect[] {
    return this.rects.filter((rect) => !this.puzzle.solution.some((sol) => sameRect(rect, sol)));
  }

  /** Quanti dei rettangoli posati sono sbagliati, senza dire quali (pulsante Verifica). */
  check(): number {
    this.helped = true;
    return this.wrong().length;
  }

  /**
   * Quanti ms mancano prima che il suggerimento possa posare un altro pezzo; now è il tempo
   * di gioco. Un ultimo pezzo "nel futuro" (salvato con l'orologio di sistema, prima che si
   * usasse il cronometro) non blocca.
   */
  cooldown(now: number): number {
    if (this.lastPlacedAt === undefined || this.lastPlacedAt > now) return 0;
    return Math.max(0, this.lastPlacedAt + this.hintCooldown - now);
  }

  /** Il grado del suggerimento già mostrato: 0 nessuno, 1 l'indizio, 2 anche il motivo. */
  get hintStage(): 0 | 1 | 2 {
    return this.pending?.stage ?? 0;
  }

  /**
   * Prima toglie tutti i rettangoli sbagliati, spiegando il primo. Se non ce ne sono,
   * il prossimo pezzo a cui si arriva ragionando dai pezzi posati (nextDeduction), a
   * gradi: indizio, motivo, pezzo. Se le regole non bastano posa subito un pezzo
   * mancante della soluzione (che a quel punto è sempre libero). undefined se è già risolto.
   */
  hint(now: number): Hint | undefined {
    if (this.hintLimit !== undefined) return this.quietHint();
    const wrong = this.wrong();
    if (wrong.length > 0) {
      const why = this.whyWrong(wrong[0]!);
      this.apply({ removed: wrong, added: [] });
      this.hintsUsed++;
      this.helped = true;
      const removed = { removed: wrong, wrong: { rect: wrong[0]!, why } };
      if (why.kind !== "misplaced") return removed;
      const rect = this.puzzle.solution[this.puzzle.clues.indexOf(why.clue)]!;
      // Durante l'attesa il pezzo giusto resta pronto per il prossimo suggerimento.
      if (this.cooldown(now) > 0) {
        this.pending = { rect, fix: why.clue, stage: 2 };
        return removed;
      }
      this.placeHinted(rect, undefined, now);
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

  /** Suggerimenti rimasti, se limitati (undefined: senza limite). */
  get hintsLeft(): number | undefined {
    return this.hintLimit === undefined ? undefined : Math.max(0, this.hintLimit - this.hintsUsed);
  }

  /**
   * Suggerimento limitato (deciso dall'utente per Maestro e Forme Esperto): un uso toglie
   * tutti i rettangoli sbagliati, oppure, se non ce ne sono, posa un pezzo; nessuna
   * spiegazione. Il pezzo è quello dedotto se c'è (vicino a dove si sta ragionando),
   * altrimenti il mancante più vicino all'ultima mossa. undefined se finiti o già risolto.
   */
  private quietHint(): Hint | undefined {
    if (this.hintsLeft === 0) return undefined;
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

  /** Posa il pezzo suggerito, se dall'ultimo sono passati HINT_COOLDOWN ms di gioco. */
  private placeHinted(rect: Rect, reason: Reason | undefined, now: number): Hint {
    const wait = this.cooldown(now);
    if (wait > 0) return { wait };
    this.hintsUsed++;
    this.lastPlacedAt = now;
    this.place(rect);
    return reason ? { placed: rect, reason } : { placed: rect };
  }

  /** Il pezzo mancante della soluzione più vicino all'ultima mossa. */
  private nearestMissing(): Rect | undefined {
    const missing = this.puzzle.solution.filter((sol) => !this.rects.some((rect) => sameRect(rect, sol)));
    const near = this.lastMove;
    if (!near) return missing[0];
    const dist = (rect: Rect) => Math.abs(rect.r + rect.h / 2 - (near.r + near.h / 2)) + Math.abs(rect.c + rect.w / 2 - (near.c + near.w / 2));
    return missing.reduce<Rect | undefined>((best, rect) => (!best || dist(rect) < dist(best) ? rect : best), undefined);
  }

  /** Il prossimo pezzo deducibile, con il motivo. */
  private deduce(): { rect: Rect; reason: Reason } | undefined {
    const found = nextDeduction(this.puzzle, this.rects, this.lastMove, DEDUCTION_MS);
    // Le deduzioni valgono per ogni soluzione: fuori dalla soluzione solo se non è unica.
    if (!found || !this.puzzle.solution.some((sol) => sameRect(sol, found.rect))) return undefined;
    const { clues } = this.puzzle;
    const discards = found.discards.map(({ rect, forced, problem }) => ({
      rect,
      forced: forced.map((f) => (f.cell === undefined ? { clue: clues[f.clue]!, rect: f.rect } : { clue: clues[f.clue]!, rect: f.rect, cell: this.cellAt(f.cell) })),
      problem: "cell" in problem ? { cell: this.cellAt(problem.cell) } : { clue: clues[problem.clue]! },
    }));
    const reason: Reason = { kind: found.kind, clue: clues[found.clue]!, discards };
    if (found.only !== undefined) reason.only = this.cellAt(found.only);
    return { rect: found.rect, reason };
  }

  private cellAt(idx: number): { r: number; c: number } {
    return { r: Math.floor(idx / this.puzzle.cols), c: idx % this.puzzle.cols };
  }

  /** Perché un rettangolo posato è sbagliato (vedi WrongReason). */
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
 * Cronometro con pausa; l'orologio è iniettabile per i test. Orologio di sistema e non
 * performance.now(): quello su alcuni telefoni si ferma con il dispositivo in sospensione,
 * mentre il tempo a pagina aperta deve contare anche quello (deciso dall'utente).
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

  /** Azzera, o riparte da un tempo già trascorso (partita ripresa). */
  reset(elapsed = 0): void {
    this.elapsedBefore = elapsed;
    this.startedAt = undefined;
  }

  /** Millisecondi trascorsi. */
  elapsed(): number {
    // Ora del telefono spostata indietro durante la partita: il tempo non cala.
    return this.elapsedBefore + (this.startedAt === undefined ? 0 : Math.max(0, this.now() - this.startedAt));
  }
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
