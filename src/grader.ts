import { type Candidate, candidatesFor, clueIndexMap, type SolveInput } from "./solver";
import { DIFFICULTIES, type Difficulty, type Rect, sameRect } from "./types";

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
      return (
        propagate(
          trial,
          total,
          guess.level,
          DIFFICULTIES.map(() => 0),
          work,
        ) !== "contradiction"
      );
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
 * Cosa non va in una forma scartata, guardando la griglia dopo averla posata: una casella
 * che nessun numero può più coprire, o un numero rimasto senza spazio.
 */
export type Problem = { cell: number } | { clue: number };

/**
 * Una forma scartata e il problema che crea; forced: la catena, i numeri che con quella
 * forma possono stare in un solo modo, uno dopo l'altro (vuota se il problema è immediato).
 * Un numero è obbligato se gli resta una forma sola, o (cell) se è l'unico ad arrivare a
 * una casella e ci arriva in un modo solo.
 */
export interface Discard {
  rect: Rect;
  forced: { clue: number; rect: Rect; cell?: number }[];
  problem: Problem;
}

/**
 * Come si arriva al pezzo: "single" se il numero ha una sola forma possibile, "direct" se
 * ogni altra forma crea subito un problema, "chain" se per qualcuna serve un passo in più.
 */
export type DeductionKind = "single" | "direct" | "chain";

export interface Deduction {
  /** Indice del numero e la sua forma, ormai obbligata. */
  clue: number;
  rect: Rect;
  kind: DeductionKind;
  /** Le altre forme possibili, ognuna con il suo problema (vuoto se "single"). */
  discards: Discard[];
  /**
   * La casella che solo questo numero raggiunge, se è il problema di tutte le forme
   * scartate: allora basta dire quella ("solo il 6 arriva alla casella evidenziata").
   */
  only?: number;
}

/** Distanza tra una cella e il centro di un rettangolo, in caselle. */
function distance(idx: number, cols: number, rect: Rect): number {
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  return Math.abs(r + 0.5 - (rect.r + rect.h / 2)) + Math.abs(c + 0.5 - (rect.c + rect.w / 2));
}

/** Il problema più vicino a rect nello stato s (undefined se non ce n'è). */
function problemNear(s: State, input: SolveInput, rect: Rect): Problem | undefined {
  const { cols } = input;
  const total = input.rows * cols;
  const covered = new Uint8Array(total);
  let best: { problem: Problem; d: number } | undefined;
  const consider = (problem: Problem, idx: number) => {
    const d = distance(idx, cols, rect);
    if (!best || d < best.d) best = { problem, d };
  };
  s.cands.forEach((list, i) => {
    if (s.placed[i]) return;
    if (list.length === 0) consider({ clue: i }, input.clues[i]!.r * cols + input.clues[i]!.c);
    for (const cand of list) for (const idx of cand.cells) covered[idx] = 1;
  });
  for (let idx = 0; idx < total; idx++) if (!s.occupied[idx] && !covered[idx]) consider({ cell: idx }, idx);
  return best?.problem;
}

/** I numeri obbligati nello stato (vedi Discard): non lo erano già sulla griglia visibile s. */
function forcedIn(state: State, s: State, input: SolveInput): Discard["forced"] {
  const steps: Discard["forced"] = [];
  const seen = (j: number, rect: Rect) => steps.some((st) => st.clue === j && sameRect(st.rect, rect));
  state.cands.forEach((list, j) => {
    if (!state.placed[j] && list.length === 1 && s.cands[j]!.length > 1) steps.push({ clue: j, rect: list[0]!.rect });
  });
  const total = input.rows * input.cols;
  const owners: number[][] = Array.from({ length: total }, () => []);
  state.cands.forEach((list, j) => {
    if (state.placed[j]) return;
    for (const cand of list) for (const idx of cand.cells) if (owners[idx]![owners[idx]!.length - 1] !== j) owners[idx]!.push(j);
  });
  for (let idx = 0; idx < total; idx++) {
    if (state.occupied[idx] || owners[idx]!.length !== 1) continue;
    const j = owners[idx]![0]!;
    const covering = state.cands[j]!.filter((cand) => cand.cells.includes(idx));
    if (state.cands[j]!.length > 1 && covering.length === 1 && !seen(j, covering[0]!.rect))
      steps.push({ clue: j, rect: covering[0]!.rect, cell: idx });
  }
  return steps;
}

/** Pezzi obbligati al massimo in una catena: oltre, la spiegazione non si segue più. */
export const MAX_CHAIN = 3;

/**
 * Perché la forma cand del numero i è impossibile, guardando solo la griglia: posata, crea
 * subito un problema; oppure (catena) un altro numero può stare solo in un modo, posato
 * anche quello magari un altro ancora, fino al problema. La catena più corta, al massimo
 * MAX_CHAIN pezzi. undefined se non si vede così.
 */
function discardOf(s: State, input: SolveInput, i: number, cand: Candidate, maxChain: number): Discard | undefined {
  const first = cloneState(s);
  place(first, i, cand);
  let level: { state: State; forced: Discard["forced"] }[] = [{ state: first, forced: [] }];
  for (let depth = 0; depth <= maxChain && level.length > 0; depth++) {
    for (const { state, forced } of level) {
      const last = forced[forced.length - 1]?.rect ?? cand.rect;
      const problem = problemNear(state, input, last);
      if (problem) return { rect: cand.rect, forced, problem };
    }
    if (depth === maxChain) break;
    const next: typeof level = [];
    for (const { state, forced } of level) {
      for (const step of forcedIn(state, s, input)) {
        const after = cloneState(state);
        place(after, step.clue, state.cands[step.clue]!.find((c) => sameRect(c.rect, step.rect))!);
        next.push({ state: after, forced: [...forced, step] });
      }
    }
    level = next;
  }
  return undefined;
}

/**
 * Il prossimo pezzo, ragionando come una persona su un numero alla volta: "dove può stare?".
 * Si guarda solo la griglia visibile (i pezzi posati, che devono essere corretti): le forme
 * possibili sono quelle che non toccano pezzi, altri numeri o caselle nere. Un numero si
 * deduce se tutte le sue forme tranne una hanno un problema che si vede (discardOf).
 * Tra i numeri che si deducono si sceglie il più semplice: forma unica, poi problemi
 * immediati, poi catene corte; a parità meno forme da scartare, poi il più vicino a near
 * (l'ultima mossa). Niente regole astratte ("solo lui può coprire la casella", ipotesi con
 * contraddizioni non dette): segnalato dall'utente, le frasi non si capivano e sembravano
 * sbagliate. Le catene più lunghe sono le più costose: dopo maxMs ci si accontenta di
 * quello che si è trovato. undefined se nessun numero si deduce così.
 */
export function nextDeduction(input: SolveInput, given: readonly Rect[], near?: Rect, maxMs = Infinity): Deduction | undefined {
  const deadline = performance.now() + maxMs;
  const s = stateWith(input, given);
  if (isContradiction(s, input.rows * input.cols)) return undefined;
  const nearness = (i: number) => (near ? distance(input.clues[i]!.r * input.cols + input.clues[i]!.c, input.cols, near) : i);
  const open = s.placed.flatMap((rect, i) => (rect ? [] : [i])).sort((a, b) => nearness(a) - nearness(b));

  const singles = open.filter((i) => s.cands[i]!.length === 1);
  if (singles.length > 0) return { clue: singles[0]!, rect: s.cands[singles[0]!]![0]!.rect, kind: "single", discards: [] };

  // Catene sempre più lunghe solo se le più corte non bastano: è anche molto più veloce.
  let best: { found: Deduction; cost: number } | undefined;
  for (let maxChain = 0; maxChain <= MAX_CHAIN && !best; maxChain++) {
    for (const i of open) {
      if (performance.now() > deadline) break;
      const list = s.cands[i]!;
      // Con più forme da scartare non può battere il migliore.
      if (best && list.length - 1 > best.found.discards.length) continue;
      let survivor: Candidate | undefined;
      const discards: Discard[] = [];
      for (const cand of list) {
        const discard = discardOf(s, input, i, cand, maxChain);
        if (discard) discards.push(discard);
        else if (survivor) {
          survivor = undefined;
          break;
        } else survivor = cand;
      }
      if (!survivor || discards.length !== list.length - 1) continue;
      const kind: DeductionKind = discards.some((dis) => dis.forced.length > 0) ? "chain" : "direct";
      // A parità di catena meno forme da scartare, poi il più vicino (open è in ordine).
      if (!best || discards.length < best.cost)
        best = { found: { clue: i, rect: survivor.rect, kind, discards }, cost: discards.length };
    }
  }
  // Una casella che solo questo numero raggiunge e che nessuna forma scartata copre: è il
  // problema di tutte, e basta mostrare quella.
  if (best && best.found.kind !== "single") {
    const found = best.found;
    const rest = s.cands[found.clue]!.filter((cand) => !sameRect(cand.rect, found.rect));
    const survivorCells = s.cands[found.clue]!.find((cand) => sameRect(cand.rect, found.rect))!.cells;
    const only = survivorCells.find(
      (idx) =>
        !s.occupied[idx] &&
        rest.every((cand) => !cand.cells.includes(idx)) &&
        open.every((j) => j === found.clue || !s.cands[j]!.some((cand) => cand.cells.includes(idx))),
    );
    if (only !== undefined) {
      found.only = only;
      found.discards = found.discards.map((dis) => ({ rect: dis.rect, forced: [], problem: { cell: only } }));
    }
  }
  return best?.found;
}

/** Tetto per chiamata di solvableByDeduction: largo, conta che la deduzione esista. */
const SIMULATION_CALL_MS = 2000;

/**
 * Si arriva in fondo con le sole deduzioni dei suggerimenti (nextDeduction), partendo dalla
 * griglia vuota e posando ogni volta il pezzo dedotto? Basta questa partita: posare pezzi
 * giusti non toglie deduzioni (le forme scartate restano scartate, i pezzi obbligati restano
 * obbligati o hanno ormai una forma sola), quindi qualunque pezzo giusto abbia posato il
 * giocatore, la prima deduzione di questa sequenza che gli manca vale ancora. Il gioco al
 * clic ha un tetto più basso (DEDUCTION_MS): su un dispositivo lento può ancora ripiegare.
 */
export function solvableByDeduction(input: SolveInput, solution: readonly Rect[]): boolean {
  const given: Rect[] = [];
  let last: Rect | undefined;
  while (given.length < solution.length) {
    const found = nextDeduction(input, given, last, SIMULATION_CALL_MS);
    if (!found || !solution.some((rect) => sameRect(rect, found.rect))) return false;
    given.push(found.rect);
    last = found.rect;
  }
  return true;
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
