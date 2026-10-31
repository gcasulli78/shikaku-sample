import type { GenerateResult } from "./generator";
import { grade } from "./grader";
import { type SolveInput, solve } from "./solver";
import { type Clue, DIFFICULTIES, MAX_SIZE, MIN_SIZE, type Shape, type Variant } from "./types";

/**
 * Un puzzle nel link: gli indizi stessi, non il seed. Il generatore ha un tempo limite,
 * quindi lo stesso seed su un dispositivo lento può dare un altro puzzle, e cambiando il
 * generatore cambierebbero i link vecchi. Formato, in base64url:
 *   versione, variante, righe, colonne; con le Caselle nere quante sono e le loro celle;
 *   poi per indizio: cella (r * cols + c), un byte con numero sì/no (bit 3) e forma
 *   (bit 0-2), e il numero se c'è.
 */
const VERSION = 1;
const SHAPES: (Shape | undefined)[] = [undefined, "square", "oblong", "wide", "tall"];
const VARIANT_CODES: Variant[] = ["classic", "shapes", "blocked"];
const HAS_N = 8;

export interface SharedPuzzle extends SolveInput {
  variant: Variant;
}

export function encodePuzzle({ rows, cols, clues, blocked, variant }: SharedPuzzle): string {
  const bytes = [VERSION, VARIANT_CODES.indexOf(variant), rows, cols];
  if (variant === "blocked") bytes.push(blocked?.length ?? 0, ...(blocked ?? []));
  for (const clue of clues) {
    bytes.push(clue.r * cols + clue.c, SHAPES.indexOf(clue.shape) | (clue.n !== undefined ? HAS_N : 0));
    if (clue.n !== undefined) bytes.push(clue.n);
  }
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** undefined se il codice è rovinato o di una versione sconosciuta. */
export function decodePuzzle(code: string): SharedPuzzle | undefined {
  let bytes: number[];
  try {
    bytes = [...atob(code.replace(/-/g, "+").replace(/_/g, "/"))].map((ch) => ch.charCodeAt(0));
  } catch {
    return undefined;
  }
  const [version, variantCode, rows, cols] = bytes;
  const variant = VARIANT_CODES[variantCode ?? -1];
  if (version !== VERSION || !variant || rows === undefined || cols === undefined) return undefined;
  if (rows < MIN_SIZE || rows > MAX_SIZE || cols < MIN_SIZE || cols > MAX_SIZE) return undefined;
  const clues: Clue[] = [];
  const used = new Set<number>();
  let k = 4;
  const blocked: number[] = [];
  if (variant === "blocked") {
    const count = bytes[k++] ?? 0;
    for (let b = 0; b < count; b++) {
      const cell = bytes[k++];
      if (cell === undefined || cell >= rows * cols || used.has(cell)) return undefined;
      used.add(cell);
      blocked.push(cell);
    }
  }
  while (k < bytes.length) {
    const cell = bytes[k++]!;
    const flags = bytes[k++];
    if (flags === undefined || cell >= rows * cols || used.has(cell) || (flags & 7) >= SHAPES.length) return undefined;
    used.add(cell);
    const clue: Clue = { r: Math.floor(cell / cols), c: cell % cols };
    const shape = SHAPES[flags & 7];
    if (shape) clue.shape = shape;
    if (flags & HAS_N) {
      const n = bytes[k++];
      if (n === undefined || n < 1 || n > rows * cols) return undefined;
      clue.n = n;
    }
    clues.push(clue);
  }
  if (clues.length === 0) return undefined;
  return blocked.length > 0 ? { rows, cols, clues, blocked, variant } : { rows, cols, clues, variant };
}

/** Passi massimi del solver per un puzzle da link (uno generato ne chiede di solito meno di mille). */
const LINK_BUDGET = 200_000;
/**
 * Tempo massimo del solver per un link, in ms: un link costruito ad arte (tanti "?" su un
 * 15×15) teneva il solver occupato 36 s prima di esaurire i passi. I puzzle generati si
 * risolvono in pochi ms.
 */
export const LINK_TIME_MS = 2000;

/**
 * Il puzzle completo da giocare: soluzione dal solver, livello dal valutatore.
 * undefined se non ha una soluzione unica (link modificato a mano) o se il solver non
 * finisce in tempo.
 */
export function completePuzzle(input: SolveInput): GenerateResult | undefined {
  const result = solve(input, 2, LINK_BUDGET, LINK_TIME_MS);
  if (result.aborted || result.count !== 1) return undefined;
  const graded = grade(input);
  return {
    ...input,
    solution: result.solutions[0]!,
    seed: 0,
    unique: true,
    logical: graded.solved,
    difficulty: graded.solved ? graded.difficulty : DIFFICULTIES[DIFFICULTIES.length - 1]!.id,
  };
}

export interface LinkedPuzzle {
  puzzle: GenerateResult;
  variant: Variant;
}

export function puzzleFromCode(code: string): LinkedPuzzle | undefined {
  const shared = decodePuzzle(code);
  if (!shared) return undefined;
  const { variant, ...input } = shared;
  const puzzle = completePuzzle(input);
  return puzzle && { puzzle, variant };
}
