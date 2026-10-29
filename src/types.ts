/** Rettangolo sulla griglia: angolo in alto a sinistra (r, c), altezza h, larghezza w. */
export interface Rect {
  r: number;
  c: number;
  h: number;
  w: number;
}

/**
 * Forma imposta da un indizio: quadrato, rettangolo non quadrato con orientamento
 * libero (oblong), oppure orientato: più largo che alto (wide) o più alto che largo (tall).
 */
export type Shape = "square" | "oblong" | "wide" | "tall";

/**
 * Indizio sulla griglia: il rettangolo che lo contiene deve avere area n (se c'è)
 * e la forma indicata (se c'è). Senza nessuno dei due è un "?": forma e area libere.
 */
export interface Clue {
  r: number;
  c: number;
  n?: number;
  shape?: Shape;
}

/** La forma esatta del rettangolo (mai oblong, che vale per wide e tall insieme). */
export function shapeOf(rect: Rect): Shape {
  return rect.h === rect.w ? "square" : rect.w > rect.h ? "wide" : "tall";
}

/** Il rettangolo rispetta area e forma dell'indizio? */
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
  /** Caselle nere (r * cols + c), da non coprire: solo nella variante Caselle nere. */
  blocked?: number[];
  /** Una soluzione (con unicità garantita è l'unica). */
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

/** In ordine crescente: l'indice è il livello usato dal valutatore. */
export const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: "easy", label: "Facile" },
  { id: "medium", label: "Medio" },
  { id: "hard", label: "Difficile" },
  { id: "expert", label: "Esperto" },
  { id: "master", label: "Maestro" },
];

/**
 * Lato minimo per i livelli più alti: sotto non si trovano in tempi ragionevoli
 * (misurato per Esperto: 0/30 a 5×5, 2/15 a 4×15, 13/15 a 7×7 con 3 s;
 * per Maestro: 6/8 a 7×7, 8/8 a 8×8 con 10 s).
 */
const MIN_SIDE: Partial<Record<Difficulty, number>> = { expert: 7, master: 8 };

export function minSide(d: Difficulty): number {
  return MIN_SIDE[d] ?? MIN_SIZE;
}

/** Le difficoltà ottenibili su una griglia di queste dimensioni. */
export function availableDifficulties(size: Size): Difficulty[] {
  return DIFFICULTIES.map((d) => d.id).filter((id) => Math.min(size.rows, size.cols) >= minSide(id));
}

/** Tempo di generazione concesso per livello, in ms. */
export const TIME_LIMITS: Record<Difficulty, number> = { easy: 1000, medium: 1000, hard: 1500, expert: 3000, master: 10000 };

export function difficultyLevel(d: Difficulty): number {
  return DIFFICULTIES.findIndex((x) => x.id === d);
}

export function isDifficulty(v: unknown): v is Difficulty {
  return DIFFICULTIES.some((d) => d.id === v);
}

export function difficultyLabel(d: Difficulty): string {
  return DIFFICULTIES[difficultyLevel(d)]!.label;
}

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

/** Rettangolo che ha come angoli opposti le due celle date. */
export function rectFromCorners(r1: number, c1: number, r2: number, c2: number): Rect {
  return {
    r: Math.min(r1, r2),
    c: Math.min(c1, c2),
    h: Math.abs(r1 - r2) + 1,
    w: Math.abs(c1 - c2) + 1,
  };
}
