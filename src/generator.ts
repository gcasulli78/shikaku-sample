import { grade, solvableByDeduction } from "./grader";
import { createRng, pick, randomSeed, type Rng } from "./rng";
import { solve, type SolveInput } from "./solver";
import {
  area,
  difficultyLevel,
  hintsExplained,
  sameRect,
  shapeOf,
  DIFFICULTIES,
  type Clue,
  type Difficulty,
  type Puzzle,
  type Rect,
  type Variant,
} from "./types";

export interface GenerateOptions {
  rows: number;
  cols: number;
  difficulty?: Difficulty;
  /** Classico (solo numeri, predefinito), Forme (indizi con forma e area anche aperte) o Caselle nere. */
  variant?: Variant;
  seed?: number;
  /** Puzzle a soluzione unica da valutare prima di accontentarsi del più vicino. */
  maxCandidates?: number;
  /** Spostamenti di numeri provati su ogni candidato per avvicinarlo alla difficoltà chiesta. */
  tuneMoves?: number;
  /** Tempo massimo in ms: allo scadere si restituisce il migliore trovato (rende il risultato non deterministico). */
  timeLimitMs?: number;
  /** Partizioni diverse da provare per ottenere un puzzle a soluzione unica. */
  maxAttempts?: number;
  /** Spostamenti di numeri da provare su ogni partizione ambigua. */
  maxFixes?: number;
}

export interface GenerateResult extends Puzzle {
  seed: number;
  /** False solo se nessun tentativo ha prodotto una soluzione unica. */
  unique: boolean;
  /** Difficoltà misurata, che può differire da quella chiesta se non è stata trovata. */
  difficulty: Difficulty;
  /** False se nemmeno le regole di Maestro bastano a risolverlo (serve andare per tentativi). */
  logical: boolean;
}

/**
 * Come si costruiscono i puzzle di un livello: forme più grandi e con più
 * fattorizzazioni, numeri lontani dai bordi della forma → più possibilità aperte.
 */
export interface Profile {
  /** Area massima rispetto al lato più lungo della griglia. */
  areaFactor: number;
  /** Peso delle forme ∝ area^sizeExp. */
  sizeExp: number;
  /** Bonus per le aree con molte forme possibili (6, 8, 12…). */
  compositeBonus: number;
  /** Peso delle celle per il numero ∝ (1 + distanza dal bordo della forma)^interior; negativo = bordi. */
  interior: number;
}

export const PROFILES: Record<Difficulty, Profile> = {
  easy: { areaFactor: 0.8, sizeExp: 0, compositeBonus: 0, interior: -2 },
  medium: { areaFactor: 1, sizeExp: 0.5, compositeBonus: 0.5, interior: 0 },
  hard: { areaFactor: 1.6, sizeExp: 1, compositeBonus: 1, interior: 2 },
  expert: { areaFactor: 2, sizeExp: 1.5, compositeBonus: 1.5, interior: 3 },
  // Forme medie con molte fattorizzazioni: con forme più grandi Maestro diventa più raro (misurato).
  master: { areaFactor: 1.3, sizeExp: 1, compositeBonus: 2.5, interior: 3 },
};

/** Probabilità di accettare un 1×1 quando ci sono alternative più grandi. */
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
 * Peso in più dei rettangoli orizzontali nella partizione bilanciata: compensa le strisce
 * larghe una colonna, dove ci stanno solo verticali. Con 2 il rapporto orizzontali/verticali
 * è 0.94–1.21 su 8×8, 10×10, 15×15 e 8×15 (misurato, 200 partizioni per griglia).
 */
const WIDE_WEIGHT = 2;

/**
 * Taglia la griglia in rettangoli casuali che coprono tutto senza sovrapporsi.
 * `balanced`: tanti orizzontali quanti verticali (vedi layout).
 */
export function partition(
  rows: number,
  cols: number,
  rng: Rng,
  profile: Profile = PROFILES.medium,
  balanced = false,
): Rect[] {
  const maxArea = maxAreaFor(rows, cols, profile);
  const used = new Uint8Array(rows * cols);
  const rects: Rect[] = [];
  const shapeWeight = (o: Rect) =>
    Math.pow(area(o), profile.sizeExp) *
    (1 + (profile.compositeBonus * (divisorCount(area(o)) - 2)) / 2) *
    (balanced && o.w > o.h ? WIDE_WEIGHT : 1);

  for (let idx = 0; idx < rows * cols; idx++) {
    if (used[idx]) continue;
    const r = Math.floor(idx / cols);
    const c = idx % cols;

    // Larghezza massima libera sulla riga di partenza; poi si scende finché le righe sono libere.
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

    // Bilanciata: solo le forme che ci starebbero anche ruotate, così orizzontali e verticali
    // hanno le stesse possibilità (se resta qualcosa oltre al 1×1).
    const fit = balanced ? new Set(options.map((o) => o.h * 100 + o.w)) : undefined;
    const symmetric = fit ? options.filter((o) => area(o) > 1 && fit.has(o.w * 100 + o.h)) : [];
    const bigger = symmetric.length > 0 ? symmetric : options.filter((o) => area(o) > 1);
    const rect =
      bigger.length > 0 && rng() >= SINGLE_CELL_CHANCE ? pickWeighted(rng, bigger, shapeWeight) : pick(rng, options);
    for (let rr = rect.r; rr < rect.r + rect.h; rr++) {
      for (let cc = rect.c; cc < rect.c + rect.w; cc++) used[rr * cols + cc] = 1;
    }
    rects.push(rect);
  }
  return mergeSingles(rects, rng, maxArea);
}

/** Unione di due rettangoli se è a sua volta un rettangolo (affiancati con lato in comune). */
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
 * Il riempimento riga per riga lascia spesso celle isolate (1×1, indizi banali):
 * ognuna si fonde con un vicino quando l'unione resta un rettangolo non troppo grande.
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
    i = -1; // ricomincia: le posizioni sono cambiate
  }
  return result;
}

/**
 * Cosa mostra un indizio nella variante Forme: solo il numero, forma e numero,
 * solo la forma, oppure niente ("?"). Nel Classico c'è solo il numero.
 */
const KINDS = ["number", "shapeNumber", "shape", "any"] as const;
type Kind = (typeof KINDS)[number];

/**
 * Pesi dei tipi di indizio per livello (stesso ordine di KINDS): più si sale, più indizi
 * aperti. Facile senza indizi aperti (sul 15×15 altrimenti non si trova in tempo);
 * Maestro ne ha meno di Esperto perché la difficoltà viene dalle ipotesi profonde, che
 * con troppi indizi aperti esauriscono il budget del valutatore (misurato).
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
 * Probabilità che un indizio con forma non quadrata dica anche l'orientamento
 * (orizzontale o verticale) invece della croce: l'orientamento dimezza le forme
 * possibili, quindi pesa di più ai livelli bassi. Misurato sul 15×15 (16 seed):
 * Difficile a 0.3 scende a 15/16, Maestro a 0.15 a 10/16; con questi valori 16/16
 * (Maestro 15/16, come prima degli indizi orientati).
 */
export const ORIENTED: Record<Difficulty, number> = { easy: 0.5, medium: 0.4, hard: 0.15, expert: 0.15, master: 0 };

/** L'indizio del rettangolo nella cella data, con le informazioni del tipo scelto. */
function dress(cell: { r: number; c: number }, rect: Rect, kind: Kind, s: Setup): Clue {
  const clue: Clue = { r: cell.r, c: cell.c };
  if (kind === "number" || kind === "shapeNumber") clue.n = area(rect);
  if (kind === "shape" || kind === "shapeNumber") {
    const shape = shapeOf(rect);
    clue.shape = shape !== "square" && s.rng() >= s.oriented ? "oblong" : shape;
  }
  return clue;
}

/** Cella del rettangolo per l'indizio, preferendo l'interno o i bordi secondo il profilo. */
function pickCell(rect: Rect, rng: Rng, profile: Profile): { r: number; c: number } {
  const cells: { r: number; c: number }[] = [];
  for (let r = rect.r; r < rect.r + rect.h; r++) for (let c = rect.c; c < rect.c + rect.w; c++) cells.push({ r, c });
  const depth = ({ r, c }: { r: number; c: number }) =>
    Math.min(r - rect.r, rect.r + rect.h - 1 - r) + Math.min(c - rect.c, rect.c + rect.w - 1 - c);
  return pickWeighted(rng, cells, (cell) => Math.pow(1 + depth(cell), profile.interior));
}

/**
 * Quota di caselle nere nella variante Caselle nere. Le caselle nere tolgono possibilità
 * e rendono i puzzle più facili: misurato (8 seed) con l'8% fino a Difficile si trova
 * sempre il livello (8×15 Difficile 7/8); ai livelli alti con l'8% Esperto e Maestro sul
 * 15×15 scendevano a 1/8 e 0/8, con il 3% a 3/8 e 2/8 (4/8 e 2/8 col tempo doppio della
 * preparazione in anticipo), 10×10 7/8 e 6/8.
 */
export const BLACK_RATE: Record<Difficulty, number> = { easy: 0.08, medium: 0.08, hard: 0.08, expert: 0.03, master: 0.03 };

/**
 * Annerisce pezzi piccoli (1 o 2 caselle) della partizione fino alla quota di caselle
 * nere. Ai livelli alti i pezzi piccoli sono pochi: allora si taglia via una striscia di
 * 1 o 2 caselle dal bordo di un rettangolo stretto (che resta un rettangolo).
 * Caselle nere sparse a caso, invece, tolgono spazio ai pezzi grandi e rendono i
 * puzzle troppo facili: con il 3% Maestro non si trovava più (misurato).
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
  // Strisce: un rettangolo largo 1–2 perde la prima o l'ultima riga, uno alto 1–2 una colonna.
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

/** Come si costruisce un puzzle: dimensioni, casualità, profilo del livello e tipi di indizio. */
interface Setup {
  rows: number;
  cols: number;
  rng: Rng;
  profile: Profile;
  kinds: readonly number[];
  /** Probabilità di un indizio orientato (ORIENTED), 0 nel Classico. */
  oriented: number;
  /** Partizione bilanciata tra orizzontali e verticali (BALANCED). */
  balanced: boolean;
  /** Quota di caselle nere (BLACK_RATE), 0 fuori dalla variante Caselle nere. */
  blackRate: number;
}

function placeClue(rect: Rect, s: Setup): Clue {
  const cell = pickCell(rect, s.rng, s.profile);
  // Nel Classico niente estrazione del tipo: stessa sequenza casuale di prima (Maestro, con la
  // partizione originale, genera gli stessi puzzle per seed).
  return dress(cell, rect, s.kinds === CLASSIC_KINDS ? "number" : pickKind(s), s);
}

function pickKind(s: Setup): Kind {
  return pickWeighted(s.rng, KINDS, (k) => s.kinds[KINDS.indexOf(k)]!);
}

/** Stesso tipo di indizio in un'altra cella del rettangolo (se ce n'è una). */
function relocate(clue: Clue, rect: Rect, s: Setup): Clue {
  let cell = pickCell(rect, s.rng, s.profile);
  for (let k = 0; k < 4 && cell.r === clue.r && cell.c === clue.c; k++) cell = pickCell(rect, s.rng, s.profile);
  return { ...clue, r: cell.r, c: cell.c };
}

/**
 * Lo stesso indizio con un'informazione in più (prima il numero, poi la forma, solo
 * nella variante Forme); undefined se è già completo. L'orientamento non si rivela:
 * rende i puzzle troppo facili e Esperto/Maestro sul 15×15 scendevano a 14/16 (misurato).
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
 * Passi massimi del solver durante la generazione: di solito ne bastano meno di 1000
 * (il 99,9% su 16 mila controlli misurati), un 15×15 Forme ne ha chiesti 567 mila (30 s).
 */
const SOLVE_BUDGET = 20_000;

/**
 * Il riempimento riga per riga favorisce i rettangoli verticali (0.23 orizzontali per
 * verticale sul 15×15, e 4 puzzle su 5 quasi tutti verticali): per livello, se la
 * partizione è bilanciata (in entrambe le varianti). Maestro resta com'era: la bilanciata
 * ha pezzi più piccoli e sul 15×15 scendeva a 10/16 nelle Forme e a 2/8 nel Classico
 * (misurato); Esperto nel Classico regge (42/48 contro 39/48 su 15×15, 8×15, 10×10).
 */
export const BALANCED: Record<Difficulty, boolean> = { easy: true, medium: true, hard: true, expert: true, master: false };

function layout(s: Setup): Rect[] {
  return partition(s.rows, s.cols, s.rng, s.profile, s.balanced);
}

/** Dimensioni e caselle nere: tutto ciò che serve a solver e valutatore oltre agli indizi. */
type Board = Omit<SolveInput, "clues">;

/**
 * Puzzle con soluzione unica: partizione casuale, un indizio per rettangolo, poi
 * finché il solver trova un'alternativa si correggono gli indizi dei rettangoli che
 * l'alternativa non rispetta (rivelando un'informazione, o spostandoli se sono già
 * completi); se non basta si riparte con una nuova partizione.
 */
function generateUnique(s: Setup, maxAttempts: number, maxFixes: number) {
  let fallback: { board: Board; clues: Clue[]; solution: Rect[]; unique: boolean } | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Senza caselle nere (quota 0) blackenSmall non estrae nulla: Classico e Forme restano come prima.
    const { solution, blocked } = blackenSmall(s, layout(s));
    const board: Board = blocked.length > 0 ? { rows: s.rows, cols: s.cols, blocked } : { rows: s.rows, cols: s.cols };
    const clues = solution.map((rect) => placeClue(rect, s));

    for (let fix = 0; fix <= maxFixes; fix++) {
      const { count, solutions, aborted } = solve({ ...board, clues }, 2, SOLVE_BUDGET);
      if (!aborted && count === 1) return { board, clues, solution, unique: true };
      fallback ??= { board, clues: clues.map((cl) => ({ ...cl })), solution, unique: false };
      // Ricerca troppo lunga: unicità non verificabile, meglio un'altra partizione.
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
 * Livello misurato; i puzzle che il valutatore non chiude valgono DIFFICULTIES.length.
 * Sotto Maestro la regola più costosa non serve: basta sapere che si va oltre Esperto.
 */
function measure(board: Board, clues: Clue[], targetLevel: number): { level: number; steps: number } {
  const graded = grade({ ...board, clues }, Math.max(3, targetLevel));
  if (!graded.solved) return { level: DIFFICULTIES.length, steps: 0 };
  const level = difficultyLevel(graded.difficulty);
  return { level, steps: graded.steps[level]! };
}

/**
 * Raffinamento locale: cambia un indizio alla volta (lo sposta dentro la sua forma
 * oppure, nella variante Forme, cambia cosa mostra) e tiene la modifica se la soluzione
 * resta unica e la difficoltà si avvicina all'obiettivo (a parità di livello, più
 * passaggi al livello più alto se si sale, meno se si scende).
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
  // Un indizio in un 1×1 non si può spostare, ma nelle Forme può cambiare tipo.
  const movable = solution.map((_, i) => i).filter((i) => shapes || area(solution[i]!) > 1);
  if (movable.length === 0) return current;
  // Più basso = meglio.
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
    // Il valutatore scarta solo forme impossibili: se chiude il puzzle, la soluzione è unica
    // e il solver serve solo quando non ci arriva.
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
 * Genera puzzle a soluzione unica con il profilo del livello chiesto, li valuta e li
 * raffina spostando i numeri; restituisce il primo della difficoltà giusta, o il più vicino.
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
  // Dove i suggerimenti spiegano, il puzzle deve risolversi con le loro sole deduzioni.
  const explained = hintsExplained(options.variant ?? "classic", target);

  let best: { result: GenerateResult; distance: number } | undefined;
  // Almeno un candidato anche a tempo scaduto.
  for (let k = 0; k < maxCandidates && (k === 0 || !outOfTime()); k++) {
    const { board, clues, solution, unique } = generateUnique(s, maxAttempts, maxFixes);
    const { level } = unique
      ? tune(s, board, clues, solution, targetLevel, tuneMoves, outOfTime)
      : measure(board, clues, targetLevel);
    const logical = level < DIFFICULTIES.length;
    const result: GenerateResult = { ...board, clues, solution, seed, unique, logical, difficulty: labelFor(level) };
    // Un puzzle non unico è sempre l'ultima scelta, uno che il valutatore non chiude la penultima.
    // Del livello giusto ma non risolvibile con i suggerimenti: meglio di un livello sbagliato.
    let distance = Math.abs(level - targetLevel) + (logical ? 0 : 50) + (unique ? 0 : 100);
    if (distance === 0 && explained && !solvableByDeduction({ ...board, clues }, solution)) distance = 0.5;
    if (distance === 0) return result;
    if (!best || distance < best.distance) best = { result, distance };
  }
  const { result } = best!;
  if (!result.logical && targetLevel < DIFFICULTIES.length - 1) {
    // La misura era limitata: senza limite il livello vero può essere Maestro.
    const graded = grade(result);
    if (graded.solved) return { ...result, logical: true, difficulty: graded.difficulty };
  }
  return result;
}

/** Oltre l'ultimo livello si usa comunque l'etichetta più alta (con logical: false). */
function labelFor(level: number): Difficulty {
  return DIFFICULTIES[Math.min(level, DIFFICULTIES.length - 1)]!.id;
}
