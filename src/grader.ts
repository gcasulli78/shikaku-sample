import { candidatesFor, clueIndexMap, type Candidate, type SolveInput } from "./solver";
import { DIFFICULTIES, sameRect, type Difficulty, type Rect } from "./types";

/**
 * Valuta la difficoltà risolvendo come farebbe una persona: regole in ordine di costo,
 * ripartendo dalla più semplice dopo ogni progresso. La difficoltà è la regola più
 * avanzata di cui c'è stato bisogno.
 *
 *  0 Facile    forma unica: un numero con un solo rettangolo possibile.
 *  1 Medio     cella contesa da un solo numero; celle comuni a tutte le forme di un numero.
 *  2 Difficile nessun buco: si scarta una forma che lascerebbe celle o numeri senza copertura.
 *  3 Esperto   ipotesi: si prova una forma (tra al massimo 3) e la si scarta se con le
 *              deduzioni di Facile e Medio porta a contraddizione.
 *  4 Maestro   ipotesi profonda: tra al massimo 6 forme, e per smentirla possono servire
 *              i buchi o una seconda ipotesi dentro la prima.
 */

export interface GradeResult {
  difficulty: Difficulty;
  /** Quante volte è stata usata ogni regola, per livello. */
  steps: number[];
  solved: boolean;
  /** Rettangoli posati, per indice di numero (undefined se non risolto). */
  placed: (Rect | undefined)[];
  /** Passi di deduzione usati (vedi WORK_BUDGET). */
  work: number;
}

interface State {
  cands: Candidate[][];
  placed: (Rect | undefined)[];
  occupied: Uint8Array;
}

type Outcome = "progress" | "none" | "contradiction";

function cloneState(s: State): State {
  return { cands: s.cands.map((list) => [...list]), placed: [...s.placed], occupied: s.occupied.slice() };
}

function overlapsCells(cand: Candidate, cells: Set<number> | Uint8Array): boolean {
  if (cells instanceof Uint8Array) return cand.cells.some((idx) => cells[idx] === 1);
  return cand.cells.some((idx) => cells.has(idx));
}

/** Posa la forma del numero i e toglie agli altri le forme che la toccano. */
function place(s: State, i: number, cand: Candidate): void {
  s.placed[i] = cand.rect;
  s.cands[i] = [cand];
  for (const idx of cand.cells) s.occupied[idx] = 1;
  const taken = new Set(cand.cells);
  s.cands.forEach((list, j) => {
    if (j !== i && !s.placed[j]) s.cands[j] = list.filter((c) => !overlapsCells(c, taken));
  });
}

/** Perché uno stato è impossibile: un numero senza più forme, o una cella che nessuno copre. */
export type Conflict = { kind: "starved"; clue: number } | { kind: "uncovered"; cell: number };

function conflictIn(s: State, total: number): Conflict | undefined {
  const covered = new Uint8Array(total);
  for (let i = 0; i < s.cands.length; i++) {
    if (s.placed[i]) continue;
    const list = s.cands[i]!;
    if (list.length === 0) return { kind: "starved", clue: i };
    for (const cand of list) for (const idx of cand.cells) covered[idx] = 1;
  }
  for (let idx = 0; idx < total; idx++) if (!s.occupied[idx] && !covered[idx]) return { kind: "uncovered", cell: idx };
  return undefined;
}

function isContradiction(s: State, total: number): boolean {
  return conflictIn(s, total) !== undefined;
}

// --- Regole ---

function ruleSingle(s: State): Outcome {
  for (let i = 0; i < s.cands.length; i++) {
    if (!s.placed[i] && s.cands[i]!.length === 1) {
      place(s, i, s.cands[i]![0]!);
      return "progress";
    }
  }
  return "none";
}

function ruleCellOwner(s: State, total: number): Outcome {
  const owners: number[][] = Array.from({ length: total }, () => []);
  s.cands.forEach((list, i) => {
    if (s.placed[i]) return;
    for (const cand of list) {
      for (const idx of cand.cells) {
        const o = owners[idx]!;
        if (o[o.length - 1] !== i) o.push(i);
      }
    }
  });
  let outcome: Outcome = "none";
  for (let idx = 0; idx < total; idx++) {
    if (s.occupied[idx] || owners[idx]!.length !== 1) continue;
    const i = owners[idx]![0]!;
    const list = s.cands[i]!;
    const kept = list.filter((cand) => cand.cells.includes(idx));
    if (kept.length < list.length) {
      s.cands[i] = kept;
      outcome = "progress";
    }
  }
  return outcome;
}

function ruleSureCells(s: State): Outcome {
  let outcome: Outcome = "none";
  for (let i = 0; i < s.cands.length; i++) {
    if (s.placed[i]) continue;
    const [first, ...rest] = s.cands[i]!;
    if (!first) continue;
    const sure = new Set(first.cells.filter((idx) => rest.every((cand) => cand.cells.includes(idx))));
    if (sure.size === 0) continue;
    s.cands.forEach((list, j) => {
      if (j === i || s.placed[j]) return;
      const kept = list.filter((cand) => !overlapsCells(cand, sure));
      if (kept.length < list.length) {
        s.cands[j] = kept;
        outcome = "progress";
      }
    });
  }
  return outcome;
}

/** Posare cand (del numero i) lascerebbe un numero senza forme o una cella scoperta? */
function leavesHole(s: State, i: number, cand: Candidate, total: number, covered: Uint8Array, taken: Uint8Array): boolean {
  covered.fill(0);
  taken.fill(0);
  for (const idx of cand.cells) taken[idx] = 1;
  for (let j = 0; j < s.cands.length; j++) {
    if (j === i || s.placed[j]) continue;
    let any = false;
    for (const other of s.cands[j]!) {
      if (other.cells.some((idx) => taken[idx] === 1)) continue;
      any = true;
      for (const idx of other.cells) covered[idx] = 1;
    }
    if (!any) return true;
  }
  for (let idx = 0; idx < total; idx++) if (!s.occupied[idx] && !taken[idx] && !covered[idx]) return true;
  return false;
}

function ruleNoHole(s: State, total: number): Outcome {
  const covered = new Uint8Array(total);
  const taken = new Uint8Array(total);
  let outcome: Outcome = "none";
  for (let i = 0; i < s.cands.length; i++) {
    if (s.placed[i] || s.cands[i]!.length < 2) continue;
    const kept = s.cands[i]!.filter((cand) => !leavesHole(s, i, cand, total, covered, taken));
    if (kept.length < s.cands[i]!.length) {
      s.cands[i] = kept;
      outcome = "progress";
    }
  }
  return outcome;
}

/**
 * Le ipotesi si fanno solo sui numeri con poche forme possibili, come farebbe una persona:
 * quante forme al massimo e fino a che livello si ragiona dentro l'ipotesi.
 */
const GUESS = { options: 3, level: 1 };
const DEEP_GUESS = { options: 6, level: 3 };

/**
 * Passi di deduzione concessi a una valutazione, ipotesi comprese. Con molti indizi
 * aperti le ipotesi profonde esplodono (fino a secondi per puzzle): finito il budget ci
 * si ferma come se non ci fossero altre deduzioni, quindi nessuna forma viene scartata
 * a torto e il puzzle risulta solo "non risolto". Misurato su 15×15: nel Classico
 * una valutazione non supera ~3000 passi, nelle Forme arrivava a 60000 (10 s).
 */
export const WORK_BUDGET = 8000;

interface Work {
  done: number;
}

/** Applica le regole fino al livello maxLevel finché c'è progresso. */
function propagate(s: State, total: number, maxLevel: number, steps: number[], work: Work): "solved" | "stuck" | "contradiction" {
  for (;;) {
    if (++work.done > WORK_BUDGET) return "stuck";
    if (isContradiction(s, total)) return "contradiction";
    if (s.placed.every((r) => r !== undefined)) return "solved";

    let outcome: Outcome = "none";
    let level = 0;
    const rules: [number, () => Outcome][] = [
      [0, () => ruleSingle(s)],
      [1, () => ruleCellOwner(s, total)],
      [1, () => ruleSureCells(s)],
      [2, () => ruleNoHole(s, total)],
      [3, () => ruleGuess(s, total, GUESS, work)],
      [4, () => ruleGuess(s, total, DEEP_GUESS, work)],
    ];
    for (const [ruleLevel, rule] of rules) {
      if (ruleLevel > maxLevel) break;
      outcome = rule();
      level = ruleLevel;
      if (outcome !== "none") break;
    }
    if (outcome === "contradiction") return "contradiction";
    if (outcome === "none") return "stuck";
    steps[level]!++;
  }
}

/**
 * Prova ogni forma (prima i numeri con meno scelte) e scarta quelle che portano a
 * contraddizione seguendo le regole fino a guess.level (il controllo di contraddizione
 * ad ogni passo copre già i buchi più evidenti).
 */
function ruleGuess(s: State, total: number, guess: { options: number; level: number }, work: Work): Outcome {
  const order = s.cands
    .map((list, i) => ({ i, n: list.length }))
    .filter(({ i, n }) => !s.placed[i] && n >= 2 && n <= guess.options)
    .sort((a, b) => a.n - b.n);
  for (const { i } of order) {
    const kept = s.cands[i]!.filter((cand) => {
      const trial = cloneState(s);
      place(trial, i, cand);
      return propagate(trial, total, guess.level, DIFFICULTIES.map(() => 0), work) !== "contradiction";
    });
    if (kept.length < s.cands[i]!.length) {
      s.cands[i] = kept;
      return "progress";
    }
  }
  return "none";
}

function initialState(input: SolveInput): State {
  const clueAt = clueIndexMap(input);
  // Le caselle nere sono come già coperte: nessuna regola deve occuparsene.
  const occupied = new Uint8Array(input.rows * input.cols);
  for (const idx of input.blocked ?? []) occupied[idx] = 1;
  return {
    cands: input.clues.map((_, i) => candidatesFor(input, i, clueAt)),
    placed: input.clues.map(() => undefined),
    occupied,
  };
}

/** Posa un rettangolo se è una forma possibile del suo numero; false altrimenti. */
function placeRect(s: State, rect: Rect): boolean {
  const i = s.cands.findIndex((list, j) => !s.placed[j] && list.some((cand) => sameRect(cand.rect, rect)));
  if (i < 0) return false;
  place(s, i, s.cands[i]!.find((cand) => sameRect(cand.rect, rect))!);
  return true;
}

/** Lo stato iniziale con i pezzi già posati (corretti). */
function stateWith(input: SolveInput, given: readonly Rect[]): State {
  const s = initialState(input);
  for (const rect of given) placeRect(s, rect);
  return s;
}

/** maxLevel limita le regole usate: oltre, il puzzle risulta non risolto. */
export function grade(input: SolveInput, maxLevel = DIFFICULTIES.length - 1): GradeResult {
  const total = input.rows * input.cols;
  const state = initialState(input);
  const steps = DIFFICULTIES.map(() => 0);
  const work: Work = { done: 0 };
  const result = propagate(state, total, maxLevel, steps, work);
  const highest = steps.reduce((max, n, level) => (n > 0 ? level : max), 0);
  return {
    difficulty: DIFFICULTIES[highest]!.id,
    steps,
    solved: result === "solved",
    placed: state.placed,
    work: work.done,
  };
}

/**
 * Perché un numero ha una sola forma: "single" se l'aveva già (dati i pezzi posati),
 * altrimenti l'ultima regola che gli ha tolto forme.
 */
export type Rule = "single" | "owner" | "sure" | "hole" | "guess" | "deep";

export interface Deduction {
  /** Indice del numero e la sua forma, ormai obbligata. */
  clue: number;
  rect: Rect;
  rule: Rule;
  /** owner: la cella che solo questo numero può coprire. */
  cell?: number;
  /** sure: il numero le cui celle sicure hanno tolto spazio. */
  by?: number;
}

/**
 * Il prossimo pezzo che si deduce con UNA regola applicata alla griglia che il giocatore
 * vede (solo i pezzi posati, che devono essere corretti): regole in ordine di costo, e per
 * ogni regola il numero di indice più basso che resta con una sola forma. Ogni regola
 * guarda solo la griglia visibile, senza le forme tolte prima ad altri numeri: così il
 * motivo detto si verifica guardando la griglia. Con le catene di grade il messaggio
 * diceva solo l'ultimo passo ("solo il 6 può coprire la casella" quando l'altro 6 l'aveva
 * perso per un passo non detto). undefined se nessuna regola basta da sola.
 */
export function nextDeduction(input: SolveInput, given: readonly Rect[]): Deduction | undefined {
  const total = input.rows * input.cols;
  const s = stateWith(input, given);
  if (isContradiction(s, total)) return undefined;
  const open = s.placed.flatMap((rect, i) => (rect ? [] : [i]));
  const forced = (i: number, kept: Candidate[]): Rect | undefined =>
    kept.length === 1 && s.cands[i]!.length > 1 ? kept[0]!.rect : undefined;

  for (const i of open) if (s.cands[i]!.length === 1) return { clue: i, rect: s.cands[i]![0]!.rect, rule: "single" };

  // Casella che un solo numero può coprire.
  const owners: number[][] = Array.from({ length: total }, () => []);
  for (const i of open) {
    for (const cand of s.cands[i]!) {
      for (const idx of cand.cells) {
        const o = owners[idx]!;
        if (o[o.length - 1] !== i) o.push(i);
      }
    }
  }
  for (const i of open) {
    for (let idx = 0; idx < total; idx++) {
      if (s.occupied[idx] || owners[idx]!.length !== 1 || owners[idx]![0] !== i) continue;
      const rect = forced(i, s.cands[i]!.filter((cand) => cand.cells.includes(idx)));
      if (rect) return { clue: i, rect, rule: "owner", cell: idx };
    }
  }

  // Celle comuni a tutte le forme di un altro numero.
  const sure = s.cands.map((list, i) => {
    const [first, ...rest] = list;
    if (s.placed[i] || !first) return new Set<number>();
    return new Set(first.cells.filter((idx) => rest.every((cand) => cand.cells.includes(idx))));
  });
  for (const j of open) {
    for (const i of open) {
      if (i === j || sure[i]!.size === 0) continue;
      const rect = forced(j, s.cands[j]!.filter((cand) => !overlapsCells(cand, sure[i]!)));
      if (rect) return { clue: j, rect, rule: "sure", by: i };
    }
  }

  const covered = new Uint8Array(total);
  const taken = new Uint8Array(total);
  for (const i of open) {
    const rect = forced(i, s.cands[i]!.filter((cand) => !leavesHole(s, i, cand, total, covered, taken)));
    if (rect) return { clue: i, rect, rule: "hole" };
  }

  const work: Work = { done: 0 };
  for (const [rule, guess] of [["guess", GUESS], ["deep", DEEP_GUESS]] as const) {
    for (const i of open) {
      if (s.cands[i]!.length > guess.options) continue;
      const kept = s.cands[i]!.filter((cand) => {
        const trial = cloneState(s);
        place(trial, i, cand);
        return propagate(trial, total, guess.level, DIFFICULTIES.map(() => 0), work) !== "contradiction";
      });
      const rect = forced(i, kept);
      if (rect) return { clue: i, rect, rule };
    }
  }
  return undefined;
}

/**
 * Perché rect (che rispetta il suo indizio) è sbagliato: posato sopra ai pezzi corretti
 * given, la contraddizione che si vede subito. Solo quella: una che arriva seguendo altri
 * passi il giocatore non la vede ("il 6 non avrebbe più spazio" quando il 6 è libero), e
 * nessuna frase breve la spiega. Misurato: anche le regole di un passo sulla griglia
 * visibile (casella di un solo indizio, celle sicure) danno solo contraddizioni immediate.
 * undefined se non ce n'è una immediata.
 */
export function conflictOf(input: SolveInput, given: readonly Rect[], rect: Rect): Conflict | undefined {
  const s = stateWith(input, given);
  if (!placeRect(s, rect)) return undefined;
  return conflictIn(s, input.rows * input.cols);
}
