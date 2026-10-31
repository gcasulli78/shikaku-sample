import type { SavedGame } from "./game";
import type { GenerateResult } from "./generator";
import { parseRecordKey, type RecordEntry, type Records } from "./records";
import {
  type Clue,
  clampSize,
  type Difficulty,
  isDifficulty,
  isVariant,
  MAX_SIZE,
  MIN_SIZE,
  PRESETS,
  type Rect,
  type Shape,
  type Size,
  type Variant,
} from "./types";

/**
 * Ciò che si rilegge da localStorage può essere vecchio, rovinato o scritto da un'altra
 * pagina della stessa origine (con file:// sono tutti i file locali). Ogni valore si
 * controlla prima di usarlo: con un livello sconosciuto o una griglia 3000×3000 il gioco
 * non partiva più. Quello che non torna si scarta (o prende il valore predefinito).
 */

export type Theme = "auto" | "light" | "dark";
const THEMES: Theme[] = ["auto", "light", "dark"];
const SHAPES: Shape[] = ["square", "oblong", "wide", "tall"];

/** Griglia personalizzata nel menu delle dimensioni. */
export const CUSTOM = "custom";

export interface Settings {
  sizeId: string;
  custom: Size;
  difficulty: Difficulty;
  variant: Variant;
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  sizeId: "8x8",
  custom: { rows: 6, cols: 8 },
  difficulty: "medium",
  variant: "classic",
  theme: "auto",
};

/** La partita in corso, salvata a ogni mossa per riprenderla riaprendo la pagina. */
export interface SavedState {
  puzzle: GenerateResult;
  variant: Variant;
  game: SavedGame;
  elapsed: number;
  /** La nota dopo griglia e variante (" · da un link"…), testo semplice. */
  note: string;
}

type Data = Record<string, unknown>;

function isObject(v: unknown): v is Data {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInt(v: unknown, min: number, max: number): v is number {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}

function isTime(v: unknown): v is number {
  return Number.isFinite(v) && (v as number) >= 0;
}

/** Tutti gli elementi validi, altrimenti undefined. */
function parseAll<T>(v: unknown, parse: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const items: T[] = [];
  for (const item of v) {
    const parsed = parse(item);
    if (parsed === undefined) return undefined;
    items.push(parsed);
  }
  return items;
}

function parseRect(v: unknown, rows: number, cols: number): Rect | undefined {
  if (!isObject(v)) return undefined;
  const { r, c, h, w } = v;
  if (!isInt(r, 0, rows - 1) || !isInt(c, 0, cols - 1) || !isInt(h, 1, rows - r) || !isInt(w, 1, cols - c)) return undefined;
  return { r, c, h, w };
}

function parseClue(v: unknown, rows: number, cols: number): Clue | undefined {
  if (!isObject(v)) return undefined;
  const { r, c, n, shape } = v;
  if (!isInt(r, 0, rows - 1) || !isInt(c, 0, cols - 1)) return undefined;
  const clue: Clue = { r, c };
  if (n !== undefined) {
    if (!isInt(n, 1, rows * cols)) return undefined;
    clue.n = n;
  }
  if (shape !== undefined) {
    if (!SHAPES.includes(shape as Shape)) return undefined;
    clue.shape = shape as Shape;
  }
  return clue;
}

/** Un puzzle salvato (partita in corso o pronto in anticipo): griglia 4–15, indizi e soluzione dentro la griglia. */
export function parsePuzzle(v: unknown): GenerateResult | undefined {
  if (!isObject(v)) return undefined;
  const { rows, cols, seed, unique, difficulty, logical } = v;
  if (!isInt(rows, MIN_SIZE, MAX_SIZE) || !isInt(cols, MIN_SIZE, MAX_SIZE)) return undefined;
  if (!Number.isFinite(seed) || typeof unique !== "boolean" || !isDifficulty(difficulty) || typeof logical !== "boolean")
    return undefined;
  const clues = parseAll(v.clues, (item) => parseClue(item, rows, cols));
  // La soluzione ha un rettangolo per indizio, nello stesso ordine.
  const solution = parseAll(v.solution, (item) => parseRect(item, rows, cols));
  if (!clues || clues.length === 0 || !solution || solution.length !== clues.length) return undefined;
  const used = new Set(clues.map((cl) => cl.r * cols + cl.c));
  if (used.size !== clues.length) return undefined;
  const puzzle: GenerateResult = { rows, cols, clues, solution, seed: seed as number, unique, difficulty, logical };
  if (v.blocked !== undefined) {
    const blocked = parseAll(v.blocked, (idx) => (isInt(idx, 0, rows * cols - 1) && !used.has(idx) ? idx : undefined));
    if (!blocked || new Set(blocked).size !== blocked.length) return undefined;
    puzzle.blocked = blocked;
  }
  return puzzle;
}

function parseSavedGame(v: unknown, rows: number, cols: number): SavedGame | undefined {
  if (!isObject(v)) return undefined;
  const rects = parseAll(v.rects, (item) => parseRect(item, rows, cols));
  if (!rects || !isInt(v.hintsUsed, 0, Number.MAX_SAFE_INTEGER)) return undefined;
  const game: SavedGame = { rects, hintsUsed: v.hintsUsed };
  if (typeof v.helped === "boolean") game.helped = v.helped;
  if (isTime(v.lastPlacedAt)) game.lastPlacedAt = v.lastPlacedAt;
  if (isInt(v.checksUsed, 0, Number.MAX_SAFE_INTEGER)) game.checksUsed = v.checksUsed;
  return game;
}

export function parseSavedState(v: unknown): SavedState | undefined {
  if (!isObject(v) || !isVariant(v.variant)) return undefined;
  const puzzle = parsePuzzle(v.puzzle);
  const game = puzzle && parseSavedGame(v.game, puzzle.rows, puzzle.cols);
  if (!puzzle || !game) return undefined;
  return {
    puzzle,
    variant: v.variant,
    game,
    elapsed: isTime(v.elapsed) ? v.elapsed : 0,
    note: typeof v.note === "string" ? v.note.slice(0, 200) : "",
  };
}

/** Le impostazioni, campo per campo: quelli che non tornano prendono il valore predefinito. */
export function parseSettings(v: unknown): Settings {
  const s = isObject(v) ? v : {};
  const custom = isObject(s.custom) ? s.custom : {};
  const sizeId = PRESETS.some((p) => p.id === s.sizeId) || s.sizeId === CUSTOM ? (s.sizeId as string) : DEFAULT_SETTINGS.sizeId;
  return {
    sizeId,
    custom: {
      rows: custom.rows === undefined ? DEFAULT_SETTINGS.custom.rows : clampSize(Number(custom.rows)),
      cols: custom.cols === undefined ? DEFAULT_SETTINGS.custom.cols : clampSize(Number(custom.cols)),
    },
    difficulty: isDifficulty(s.difficulty) ? s.difficulty : DEFAULT_SETTINGS.difficulty,
    variant: isVariant(s.variant) ? s.variant : DEFAULT_SETTINGS.variant,
    theme: THEMES.includes(s.theme as Theme) ? (s.theme as Theme) : DEFAULT_SETTINGS.theme,
  };
}

function parseRecordEntry(v: unknown): RecordEntry | undefined {
  if (!isObject(v) || !isInt(v.wins, 1, Number.MAX_SAFE_INTEGER)) return undefined;
  const entry: RecordEntry = { wins: v.wins };
  if (isTime(v.best)) entry.best = v.best;
  if (isTime(v.bestClean)) entry.bestClean = v.bestClean;
  return entry;
}

/** Record e puzzle pronti hanno chiavi griglia:livello:variante: si tengono solo le voci valide. */
function parseKeyed<T>(v: unknown, parse: (value: unknown, key: string) => T | undefined): Record<string, T> {
  const result: Record<string, T> = {};
  if (!isObject(v)) return result;
  for (const [key, value] of Object.entries(v)) {
    if (!parseRecordKey(key)) continue;
    const parsed = parse(value, key);
    if (parsed !== undefined) result[key] = parsed;
  }
  return result;
}

export function parseRecords(v: unknown): Records {
  return parseKeyed(v, parseRecordEntry);
}

/** Puzzle pronti in anticipo: devono avere griglia e livello della loro chiave. */
export function parseReady(v: unknown): Record<string, GenerateResult> {
  return parseKeyed(v, (value, key) => {
    const { rows, cols, difficulty } = parseRecordKey(key)!;
    const puzzle = parsePuzzle(value);
    return puzzle && puzzle.rows === rows && puzzle.cols === cols && puzzle.difficulty === difficulty ? puzzle : undefined;
  });
}
