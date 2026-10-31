import { type Clue, fits, type Rect } from "./types";

export interface SolveInput {
  rows: number;
  cols: number;
  clues: Clue[];
  /** Caselle nere (r * cols + c): nessun rettangolo le copre. */
  blocked?: number[];
}

/** Nella mappa degli indizi: casella nera (gli indici ≥ 0 sono indizi, -1 casella libera). */
export const BLOCKED = -2;

export interface SolveResult {
  /** Soluzioni trovate, fermandosi a `limit`. */
  count: number;
  /** Le soluzioni trovate, una per indizio nello stesso ordine di `clues`. */
  solutions: Rect[][];
  /** Ricerca interrotta per budget (passi o tempo) esaurito: count non è affidabile. */
  aborted: boolean;
}

export interface Candidate {
  rect: Rect;
  /** Indici di cella (r * cols + c). */
  cells: number[];
}

/** Indice di ogni cella → numero che contiene (-1 se vuota, BLOCKED se nera). */
export function clueIndexMap(input: SolveInput): Int32Array {
  const clueAt = new Int32Array(input.rows * input.cols).fill(-1);
  for (const idx of input.blocked ?? []) clueAt[idx] = BLOCKED;
  input.clues.forEach((cl, i) => {
    clueAt[cl.r * input.cols + cl.c] = i;
  });
  return clueAt;
}

/** Misure (h, w) ammesse dall'indizio: con l'area nota solo i divisori, altrimenti tutte. */
function sizesFor(clue: Clue, rows: number, cols: number): [number, number][] {
  const sizes: [number, number][] = [];
  for (let h = 1; h <= rows; h++) {
    for (let w = 1; w <= cols; w++) {
      if (fits(clue, { r: 0, c: 0, h, w })) sizes.push([h, w]);
    }
  }
  return sizes;
}

/** Tutti i rettangoli che rispettano l'indizio, lo contengono e non contengono altri indizi né caselle nere. */
export function candidatesFor(input: SolveInput, clueIndex: number, clueAt: Int32Array): Candidate[] {
  const { rows, cols, clues } = input;
  const clue = clues[clueIndex]!;
  const result: Candidate[] = [];
  for (const [h, w] of sizesFor(clue, rows, cols)) {
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
 * `maxNodes` limita i passi di ricerca: con molti indizi ad area aperta, in rari casi
 * la ricerca esplode (567 mila passi, 30 s su un 15×15 Forme). Un passo però può costare
 * molto (200 mila passi in 36 s su un link con 12 "?"): `maxMs` limita anche il tempo.
 */
export function solve(input: SolveInput, limit = 2, maxNodes = Infinity, maxMs = Infinity): SolveResult {
  const { rows, cols, clues } = input;
  const total = rows * cols;
  const blocked = input.blocked ?? [];
  const result: SolveResult = { count: 0, solutions: [], aborted: false };
  let nodes = 0;
  const deadline = performance.now() + maxMs;

  // Con tutte le aree note la somma deve tornare esatta; con aree aperte non può superare la griglia.
  const known = clues.filter((cl) => cl.n !== undefined);
  const sum = known.reduce((s, cl) => s + cl.n!, 0);
  const free = total - blocked.length;
  if (known.length === clues.length ? sum !== free : sum > free) return result;

  const clueAt = new Int32Array(total).fill(-1);
  for (const idx of blocked) clueAt[idx] = BLOCKED;
  for (let i = 0; i < clues.length; i++) {
    const cl = clues[i]!;
    const idx = cl.r * cols + cl.c;
    if ((cl.n !== undefined && cl.n < 1) || clueAt[idx] !== -1) return result;
    clueAt[idx] = i;
  }

  const candidates = clues.map((_, i) => candidatesFor(input, i, clueAt));
  // Le caselle nere contano come già coperte.
  const occupied = new Uint8Array(total);
  for (const idx of blocked) occupied[idx] = 1;
  const placed = new Uint8Array(clues.length);
  const chosen: (Rect | undefined)[] = new Array(clues.length);
  const coverCount = new Int32Array(total);
  let remaining = clues.length;
  let covered = blocked.length;

  const isFree = (cand: Candidate) => cand.cells.every((idx) => occupied[idx] === 0);

  const place = (clueIndex: number, cand: Candidate) => {
    for (const idx of cand.cells) occupied[idx] = 1;
    placed[clueIndex] = 1;
    chosen[clueIndex] = cand.rect;
    remaining--;
    covered += cand.cells.length;
  };
  const unplace = (clueIndex: number, cand: Candidate) => {
    for (const idx of cand.cells) occupied[idx] = 0;
    placed[clueIndex] = 0;
    chosen[clueIndex] = undefined;
    remaining++;
    covered -= cand.cells.length;
  };

  const search = (): boolean => {
    // L'orologio si guarda ogni 256 passi.
    if (++nodes > maxNodes || ((nodes & 255) === 0 && performance.now() > deadline)) {
      result.aborted = true;
      return true;
    }
    if (remaining === 0) {
      // Con aree aperte tutti gli indizi possono essere posati lasciando caselle scoperte.
      if (covered < total) return false;
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
