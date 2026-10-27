import type { Clue, Rect } from "./types";

export interface SolveInput {
  rows: number;
  cols: number;
  clues: Clue[];
}

export interface SolveResult {
  /** Soluzioni trovate, fermandosi a `limit`. */
  count: number;
  /** Le soluzioni trovate, una per indizio nello stesso ordine di `clues`. */
  solutions: Rect[][];
}

export interface Candidate {
  rect: Rect;
  /** Indici di cella (r * cols + c). */
  cells: number[];
}

/** Indice di ogni cella → numero che contiene (-1 se vuota). */
export function clueIndexMap(input: SolveInput): Int32Array {
  const clueAt = new Int32Array(input.rows * input.cols).fill(-1);
  input.clues.forEach((cl, i) => (clueAt[cl.r * input.cols + cl.c] = i));
  return clueAt;
}

/** Tutti i rettangoli di area n che contengono l'indizio e nessun altro indizio. */
export function candidatesFor(input: SolveInput, clueIndex: number, clueAt: Int32Array): Candidate[] {
  const { rows, cols, clues } = input;
  const clue = clues[clueIndex]!;
  const result: Candidate[] = [];
  for (let h = 1; h <= clue.n; h++) {
    if (clue.n % h !== 0) continue;
    const w = clue.n / h;
    if (h > rows || w > cols) continue;
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
 * Conta le soluzioni con backtracking, fermandosi a `limit`.
 * Euristiche: a ogni passo si scartano i candidati che toccano celle occupate,
 * si fallisce se una cella libera non è coperta da nessun candidato, e si ramifica
 * sulla cella coperta da meno candidati (le celle con un solo candidato sono forzate).
 */
export function solve(input: SolveInput, limit = 2): SolveResult {
  const { rows, cols, clues } = input;
  const total = rows * cols;
  const result: SolveResult = { count: 0, solutions: [] };

  const sum = clues.reduce((s, cl) => s + cl.n, 0);
  if (sum !== total) return result;

  const clueAt = new Int32Array(total).fill(-1);
  for (let i = 0; i < clues.length; i++) {
    const cl = clues[i]!;
    const idx = cl.r * cols + cl.c;
    if (cl.n < 1 || clueAt[idx] !== -1) return result;
    clueAt[idx] = i;
  }

  const candidates = clues.map((_, i) => candidatesFor(input, i, clueAt));
  const occupied = new Uint8Array(total);
  const placed = new Uint8Array(clues.length);
  const chosen: (Rect | undefined)[] = new Array(clues.length);
  const coverCount = new Int32Array(total);
  let remaining = clues.length;

  const isFree = (cand: Candidate) => cand.cells.every((idx) => occupied[idx] === 0);

  const place = (clueIndex: number, cand: Candidate) => {
    for (const idx of cand.cells) occupied[idx] = 1;
    placed[clueIndex] = 1;
    chosen[clueIndex] = cand.rect;
    remaining--;
  };
  const unplace = (clueIndex: number, cand: Candidate) => {
    for (const idx of cand.cells) occupied[idx] = 0;
    placed[clueIndex] = 0;
    chosen[clueIndex] = undefined;
    remaining++;
  };

  const search = (): boolean => {
    if (remaining === 0) {
      result.count++;
      result.solutions.push(chosen.map((r) => ({ ...r! })));
      return result.count >= limit;
    }

    // Candidati ancora posabili per ogni indizio non piazzato, e copertura delle celle.
    coverCount.fill(0);
    const valid: Candidate[][] = new Array(clues.length);
    for (let i = 0; i < clues.length; i++) {
      if (placed[i]) continue;
      const list = candidates[i]!.filter(isFree);
      if (list.length === 0) return false;
      valid[i] = list;
      for (const cand of list) for (const idx of cand.cells) coverCount[idx]!++;
    }

    // Cella libera coperta da meno candidati; indizio con meno candidati.
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
      // Ramifica su chi copre la cella più vincolata.
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
