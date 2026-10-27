import { grade } from "./grader";
import { createRng, pick, randomSeed, type Rng } from "./rng";
import { solve } from "./solver";
import { area, difficultyLevel, sameRect, DIFFICULTIES, type Clue, type Difficulty, type Puzzle, type Rect } from "./types";

export interface GenerateOptions {
  rows: number;
  cols: number;
  difficulty?: Difficulty;
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

/** Taglia la griglia in rettangoli casuali che coprono tutto senza sovrapporsi. */
export function partition(rows: number, cols: number, rng: Rng, profile: Profile = PROFILES.medium): Rect[] {
  const maxArea = maxAreaFor(rows, cols, profile);
  const used = new Uint8Array(rows * cols);
  const rects: Rect[] = [];
  const shapeWeight = (o: Rect) =>
    Math.pow(area(o), profile.sizeExp) * (1 + (profile.compositeBonus * (divisorCount(area(o)) - 2)) / 2);

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

    const bigger = options.filter((o) => area(o) > 1);
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

function placeClue(rect: Rect, rng: Rng, profile: Profile): Clue {
  const cells: { r: number; c: number }[] = [];
  for (let r = rect.r; r < rect.r + rect.h; r++) for (let c = rect.c; c < rect.c + rect.w; c++) cells.push({ r, c });
  const depth = ({ r, c }: { r: number; c: number }) =>
    Math.min(r - rect.r, rect.r + rect.h - 1 - r) + Math.min(c - rect.c, rect.c + rect.w - 1 - c);
  const cell = pickWeighted(rng, cells, (cell) => Math.pow(1 + depth(cell), profile.interior));
  return { ...cell, n: area(rect) };
}

/**
 * Puzzle con soluzione unica: partizione casuale, un numero per rettangolo,
 * poi finché il solver trova un'alternativa si spostano i numeri dei rettangoli
 * che l'alternativa non rispetta; se non basta si riparte con una nuova partizione.
 */
function generateUnique(rows: number, cols: number, rng: Rng, profile: Profile, maxAttempts: number, maxFixes: number) {
  let fallback: { clues: Clue[]; solution: Rect[]; unique: boolean } | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const solution = partition(rows, cols, rng, profile);
    const clues = solution.map((rect) => placeClue(rect, rng, profile));

    for (let fix = 0; fix <= maxFixes; fix++) {
      const { count, solutions } = solve({ rows, cols, clues }, 2);
      if (count === 1) return { clues, solution, unique: true };
      fallback ??= { clues: clues.map((cl) => ({ ...cl })), solution, unique: false };

      const alternative = solutions.find((sol) => !sol.every((rect, i) => sameRect(rect, solution[i]!)));
      if (!alternative) break;
      // Sposta il numero di ogni rettangolo che l'alternativa ha scelto diversamente.
      for (let i = 0; i < solution.length; i++) {
        const rect = solution[i]!;
        if (sameRect(rect, alternative[i]!) || area(rect) === 1) continue;
        let clue = placeClue(rect, rng, profile);
        // Evita di lasciare il numero dove già stava.
        for (let k = 0; k < 4 && clue.r === clues[i]!.r && clue.c === clues[i]!.c; k++) {
          clue = placeClue(rect, rng, profile);
        }
        clues[i] = clue;
      }
    }
  }
  return fallback!;
}

/**
 * Livello misurato; i puzzle che il valutatore non chiude valgono DIFFICULTIES.length.
 * Sotto Maestro la regola più costosa non serve: basta sapere che si va oltre Esperto.
 */
function measure(rows: number, cols: number, clues: Clue[], targetLevel: number): { level: number; steps: number } {
  const graded = grade({ rows, cols, clues }, Math.max(3, targetLevel));
  if (!graded.solved) return { level: DIFFICULTIES.length, steps: 0 };
  const level = difficultyLevel(graded.difficulty);
  return { level, steps: graded.steps[level]! };
}

/**
 * Raffinamento locale: sposta un numero alla volta dentro la sua forma e tiene lo
 * spostamento se la soluzione resta unica e la difficoltà si avvicina all'obiettivo
 * (a parità di livello, più passaggi al livello più alto se si sale, meno se si scende).
 */
function tune(
  rows: number,
  cols: number,
  clues: Clue[],
  solution: Rect[],
  targetLevel: number,
  rng: Rng,
  profile: Profile,
  moves: number,
  outOfTime: () => boolean,
) {
  let current = measure(rows, cols, clues, targetLevel);
  const movable = solution.map((_, i) => i).filter((i) => area(solution[i]!) > 1);
  if (movable.length === 0) return current;
  // Più basso = meglio.
  const cost = ({ level, steps }: { level: number; steps: number }) =>
    Math.abs(level - targetLevel) * 1000 + (level < targetLevel ? -steps : level > targetLevel ? steps : 0);

  for (let m = 0; m < moves && current.level !== targetLevel && !outOfTime(); m++) {
    const i = pick(rng, movable);
    const previous = clues[i]!;
    const moved = placeClue(solution[i]!, rng, profile);
    if (moved.r === previous.r && moved.c === previous.c) continue;
    clues[i] = moved;
    const next = solve({ rows, cols, clues }, 2).count === 1 ? measure(rows, cols, clues, targetLevel) : undefined;
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
  const profile = PROFILES[target];
  const deadline = options.timeLimitMs === undefined ? Infinity : Date.now() + options.timeLimitMs;
  const outOfTime = () => Date.now() > deadline;

  let best: { result: GenerateResult; distance: number } | undefined;
  // Almeno un candidato anche a tempo scaduto.
  for (let k = 0; k < maxCandidates && (k === 0 || !outOfTime()); k++) {
    const { clues, solution, unique } = generateUnique(rows, cols, rng, profile, maxAttempts, maxFixes);
    const { level } = unique
      ? tune(rows, cols, clues, solution, targetLevel, rng, profile, tuneMoves, outOfTime)
      : measure(rows, cols, clues, targetLevel);
    const result: GenerateResult = {
      rows,
      cols,
      clues,
      solution,
      seed,
      unique,
      difficulty: DIFFICULTIES[Math.min(level, DIFFICULTIES.length - 1)]!.id,
    };
    // Un puzzle non unico è sempre l'ultima scelta; a pari distanza meglio un livello sotto
    // che uno sopra (oltre l'ultimo livello il valutatore non garantisce che si risolva ragionando).
    const distance = Math.abs(level - targetLevel) + (level > targetLevel ? 0.5 : 0) + (unique ? 0 : 100);
    if (distance === 0) return result;
    if (!best || distance < best.distance) best = { result, distance };
  }
  return best!.result;
}
