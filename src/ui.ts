import { formatTime, Game, Timer, type Hint, type Reason, type SavedGame, type WrongReason } from "./game";
import { generate, type GenerateOptions, type GenerateResult } from "./generator";
import { parseRecordKey, recordKey, recordWin, type Records } from "./records";
import { encodePuzzle, puzzleFromCode } from "./share";
import {
  area,
  availableDifficulties,
  clampSize,
  DIFFICULTIES,
  difficultyLabel,
  difficultyLevel,
  MAX_SIZE,
  MIN_SIZE,
  minSide,
  PRESETS,
  rectFromCorners,
  sameRect,
  TIME_LIMITS,
  VARIANTS,
  type Clue,
  type Difficulty,
  type Rect,
  type Shape,
  type Size,
  type Variant,
} from "./types";
import GeneratorWorker from "./worker?worker&inline";

const STORAGE_KEY = "shikaku:settings";
const READY_KEY = "shikaku:ready";
const GAME_KEY = "shikaku:game";
const RECORDS_KEY = "shikaku:records";
/** Il puzzle nel link: indirizzo#p=codice (vedi share.ts). */
const LINK_PREFIX = "#p=";
const CUSTOM = "custom";

/** Livelli lenti da generare: mentre si gioca se ne prepara già il prossimo. */
const PREFETCH: Difficulty[] = ["expert", "master"];
/** Puzzle pronti conservati al massimo (uno per griglia e livello). */
const MAX_READY = 6;

type Theme = "auto" | "light" | "dark";

interface Settings {
  sizeId: string;
  custom: Size;
  difficulty: Difficulty;
  variant: Variant;
  theme: Theme;
}

/** Cosa si chiede al generatore per una partita. */
interface Choice {
  size: Size;
  difficulty: Difficulty;
  variant: Variant;
}

function variantLabel(v: Variant): string {
  return VARIANTS.find((x) => x.id === v)!.label;
}

const SHAPE_LABELS: Record<Shape, string> = {
  square: "quadrato",
  oblong: "rettangolo non quadrato",
  wide: "rettangolo orizzontale",
  tall: "rettangolo verticale",
};

/** Descrizione dell'indizio per i lettori di schermo. */
function clueLabel(clue: Clue): string {
  const shape = clue.shape ? SHAPE_LABELS[clue.shape] : "forma libera";
  return `${shape}, ${clue.n !== undefined ? `${clue.n} caselle` : "caselle libere"}`;
}

/** Aggettivi della forma nei messaggi del suggerimento ("il 6 verticale"). */
const SHAPE_WORDS: Record<Shape, string> = { square: "quadrato", oblong: "non quadrato", wide: "orizzontale", tall: "verticale" };

/**
 * L'indizio con l'articolo, semplice o con di/a: "il 6", "dell'8", "all'indizio quadrato".
 * Si apostrofano i numeri che si leggono con una vocale (uno, otto, undici, ottanta…).
 */
function clueName(clue: Clue, prep: "" | "di" | "a" = ""): string {
  const { n } = clue;
  const noun = n !== undefined ? String(n) : clue.shape ? "indizio" : "?";
  const vowel = n === undefined ? noun === "indizio" : n === 1 || n === 8 || n === 11 || (n >= 80 && n <= 89);
  const article = vowel ? { "": "l'", di: "dell'", a: "all'" }[prep] : { "": "il ", di: "del ", a: "al " }[prep];
  return `${article}${noun}${clue.shape ? ` ${SHAPE_WORDS[clue.shape]}` : ""}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Perché il pezzo suggerito è obbligato, a parole. */
function reasonText(reason: Reason | undefined): string {
  if (!reason) return "Nessuna deduzione semplice da qui: ecco un pezzo della soluzione.";
  const name = clueName(reason.clue);
  const of = clueName(reason.clue, "di");
  const text = {
    single: `${name} può stare solo così.`,
    owner: `Solo ${name} può coprire la casella evidenziata: gli resta una sola forma.`,
    sure: `Le caselle che ${clueName(reason.by ?? reason.clue)} copre comunque tolgono spazio ${clueName(reason.clue, "a")}: gli resta una sola forma.`,
    hole: `Le altre forme ${of} lascerebbero caselle o indizi senza copertura.`,
    guess: `Provando le altre forme ${of} si arriva a una contraddizione.`,
    deep: `Provando le altre forme ${of} si arriva a una contraddizione, dopo qualche passo.`,
  }[reason.rule];
  return capitalize(text);
}

/** Cosa chiede la forma di un indizio, per spiegare un rettangolo della forma sbagliata. */
const SHAPE_NEEDS: Record<Shape, string> = {
  square: "un quadrato",
  oblong: "un rettangolo non quadrato",
  wide: "un rettangolo più largo che alto",
  tall: "un rettangolo più alto che largo",
};

/** Perché il rettangolo (evidenziato) è sbagliato, a parole. */
function wrongText(why: WrongReason, rect: Rect): string {
  switch (why.kind) {
    case "empty":
      return "non contiene nessun indizio";
    case "many":
      return `contiene ${why.count} indizi`;
    case "area":
      return `${clueName(why.clue)} vuole ${why.clue.n} caselle, qui ce ne sono ${area(rect)}`;
    case "shape":
      return `${clueName(why.clue)} vuole ${SHAPE_NEEDS[why.clue.shape!]}`;
    case "starved":
      return `così ${clueName(why.clue)} non avrebbe più spazio`;
    case "uncovered":
      return "così la casella evidenziata non la potrebbe coprire nessun indizio";
    case "other":
      return "non fa parte della soluzione";
  }
}

function hintText(hint: Hint): string {
  if ("removed" in hint) {
    const why = wrongText(hint.wrong.why, hint.wrong.rect);
    return hint.removed.length === 1
      ? `Tolto un rettangolo sbagliato: ${why}.`
      : `Tolti ${hint.removed.length} rettangoli sbagliati. Quello evidenziato: ${why}.`;
  }
  if ("focus" in hint) return `Guarda ${clueName(hint.focus.clue)}: si può già capire dove va.`;
  if ("explain" in hint) return reasonText(hint.explain);
  return reasonText(hint.reason);
}

/** Le caselle da evidenziare per un suggerimento: indizi e casella decisiva. */
function hintSpots(hint: Hint): { r: number; c: number }[] {
  if ("removed" in hint) {
    const { why } = hint.wrong;
    return why.kind === "starved" ? [why.clue] : why.kind === "uncovered" ? [why.cell] : [];
  }
  if ("focus" in hint) return [hint.focus.clue];
  const reason = "explain" in hint ? hint.explain : hint.reason;
  return reason ? [reason.cell, reason.clue, reason.by].filter((spot) => spot !== undefined) : [];
}

const HINT_LABELS = ["Suggerimento", "Perché?", "Mostra il pezzo"];

/**
 * Genera nel Worker; se non si può creare (browser vecchi), nel thread principale.
 * Una nuova richiesta annulla quella in corso: il Worker viene ricreato e la vecchia
 * promessa si risolve con undefined.
 */
function createGenerator(): (options: GenerateOptions) => Promise<GenerateResult | undefined> {
  let worker: Worker | undefined;
  let usable = true;
  let current: { id: number; options: GenerateOptions; resolve: (r: GenerateResult | undefined) => void } | undefined;
  let nextId = 0;

  const fallback = (job: NonNullable<typeof current>) => {
    // Lascia al browser il tempo di mostrare "Generazione…" prima di bloccarsi.
    setTimeout(() => job.resolve(current === job ? generate(job.options) : undefined), 30);
  };

  const spawn = () => {
    try {
      worker = new GeneratorWorker();
    } catch {
      usable = false;
      worker = undefined;
      return;
    }
    worker.addEventListener("message", (e: MessageEvent<{ id: number; result: GenerateResult }>) => {
      if (current && e.data.id === current.id) {
        const job = current;
        current = undefined;
        job.resolve(e.data.result);
      }
    });
    worker.addEventListener("error", () => {
      usable = false;
      worker?.terminate();
      worker = undefined;
      if (current) fallback(current);
    });
  };

  return (options) =>
    new Promise((resolve) => {
      if (current) {
        current.resolve(undefined);
        current = undefined;
        worker?.terminate();
        worker = undefined;
      }
      const job = { id: ++nextId, options, resolve };
      current = job;
      if (usable && !worker) spawn();
      if (worker) worker.postMessage({ id: job.id, options });
      else fallback(job);
    });
}

/** Oggetto salvato in localStorage, unito ai valori predefiniti. */
function readJson<T extends object>(key: string, defaults: T): T {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    return typeof saved === "object" && saved !== null ? { ...defaults, ...saved } : defaults;
  } catch {
    return defaults;
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Come sotto: senza storage non c'è niente da togliere.
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage non disponibile (navigazione privata, file://): si perde solo ciò che si voleva ricordare.
  }
}

const DEFAULT_SETTINGS: Settings = {
  sizeId: "8x8",
  custom: { rows: 6, cols: 8 },
  difficulty: "medium",
  variant: "classic",
  theme: "auto",
};

type Ready = Record<string, GenerateResult>;

/** La partita in corso, salvata a ogni mossa per riprenderla riaprendo la pagina. */
interface SavedState {
  puzzle?: GenerateResult;
  variant?: Variant;
  game?: SavedGame;
  elapsed?: number;
  status?: string;
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} mancante`);
  return el as T;
}

const THEME_ICONS: Record<Theme, string> = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};
const THEME_LABELS: Record<Theme, string> = { auto: "Tema: automatico", light: "Tema: chiaro", dark: "Tema: scuro" };
const NEXT_THEME: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };

/** Tonalità ben distinte tra loro. */
const HUES = [205, 145, 30, 280, 350, 175, 55, 245];

function touches(a: Rect, b: Rect): boolean {
  const rowsOverlap = a.r < b.r + b.h && b.r < a.r + a.h;
  const colsOverlap = a.c < b.c + b.w && b.c < a.c + a.w;
  return (
    (rowsOverlap && (a.c + a.w === b.c || b.c + b.w === a.c)) ||
    (colsOverlap && (a.r + a.h === b.r || b.r + b.h === a.r))
  );
}

/**
 * Una tonalità per numero, scelta in modo che i rettangoli confinanti nella soluzione
 * abbiano colori diversi (colorazione greedy del grafo delle adiacenze).
 */
function assignHues(solution: Rect[]): number[] {
  const hues: number[] = [];
  const offset = Math.floor(Math.random() * HUES.length);
  solution.forEach((rect, i) => {
    const used = new Map<number, number>();
    for (let j = 0; j < i; j++) {
      if (touches(rect, solution[j]!)) used.set(hues[j]!, (used.get(hues[j]!) ?? 0) + 1);
    }
    const candidates = HUES.map((_, k) => HUES[(k + offset + i) % HUES.length]!);
    const free = candidates.find((h) => !used.has(h));
    // Con più di 8 vicini già colorati si prende il colore meno usato tra loro.
    hues.push(free ?? candidates.reduce((best, h) => ((used.get(h) ?? 0) < (used.get(best) ?? 0) ? h : best)));
  });
  return hues;
}

function gridArea(el: HTMLElement, rect: Rect): void {
  el.style.gridArea = `${rect.r + 1} / ${rect.c + 1} / span ${rect.h} / span ${rect.w}`;
}

export function startApp(): void {
  const settings = readJson(STORAGE_KEY, DEFAULT_SETTINGS);
  const board = $<HTMLDivElement>("board");
  const sizeSelect = $<HTMLSelectElement>("size");
  const difficultySelect = $<HTMLSelectElement>("difficulty");
  const variantSelect = $<HTMLSelectElement>("variant");
  const legend = $<HTMLParagraphElement>("legend");
  const statusEl = $<HTMLParagraphElement>("status");
  const newBtn = $<HTMLButtonElement>("new");
  const customBox = $<HTMLDivElement>("custom");
  const rowsInput = $<HTMLInputElement>("rows");
  const colsInput = $<HTMLInputElement>("cols");
  const timerEl = $<HTMLSpanElement>("timer");
  const themeBtn = $<HTMLButtonElement>("theme");
  const undoBtn = $<HTMLButtonElement>("undo");
  const clearBtn = $<HTMLButtonElement>("clear");
  const hintBtn = $<HTMLButtonElement>("hint");
  const winDialog = $<HTMLDialogElement>("win");
  const winText = $<HTMLParagraphElement>("win-text");
  const winRecord = $<HTMLParagraphElement>("win-record");
  const shareBtn = $<HTMLButtonElement>("share");
  const checkBtn = $<HTMLButtonElement>("check");
  const recordsBtn = $<HTMLButtonElement>("records-btn");
  const recordsDialog = $<HTMLDialogElement>("records");
  const recordsBody = $<HTMLDivElement>("records-body");

  const timer = new Timer();
  const generateAsync = createGenerator();
  // Un secondo Worker per preparare in anticipo: non viene annullato dalle partite nuove.
  const prefetchAsync = createGenerator();
  const ready = readJson<Ready>(READY_KEY, {});
  let pending: { key: string; promise: Promise<GenerateResult | undefined> } | undefined;
  // Assegnata alla prima generazione; fino ad allora i comandi sono disattivati.
  let game!: Game;
  let difficulty: Difficulty = settings.difficulty;
  let gameVariant: Variant = settings.variant;
  let hues: number[] = [];
  let solved = false;
  let lastHint: Hint | undefined;
  /** La riga di stato della partita; dopo un suggerimento al suo posto c'è il motivo. */
  let gameStatus = "";
  /** Un avviso al posto della riga di stato (link copiato…), fino alla mossa successiva. */
  let notice: string | undefined;
  const records = readJson<Records>(RECORDS_KEY, {});
  let request = 0;

  // --- Tema ---
  const applyTheme = () => {
    if (settings.theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
    themeBtn.innerHTML = THEME_ICONS[settings.theme];
    themeBtn.title = themeBtn.ariaLabel = THEME_LABELS[settings.theme];
  };
  themeBtn.addEventListener("click", () => {
    settings.theme = NEXT_THEME[settings.theme];
    writeJson(STORAGE_KEY, settings);
    applyTheme();
  });
  applyTheme();

  // --- Scelta dimensione ---
  for (const preset of PRESETS) sizeSelect.add(new Option(preset.label, preset.id));
  sizeSelect.add(new Option("Personalizzata…", CUSTOM));
  for (const input of [rowsInput, colsInput]) {
    input.min = String(MIN_SIZE);
    input.max = String(MAX_SIZE);
  }
  sizeSelect.value = PRESETS.some((p) => p.id === settings.sizeId) || settings.sizeId === CUSTOM ? settings.sizeId : "8x8";
  rowsInput.value = String(clampSize(settings.custom.rows));
  colsInput.value = String(clampSize(settings.custom.cols));
  for (const d of DIFFICULTIES) difficultySelect.add(new Option(d.label, d.id));
  difficultySelect.value = DIFFICULTIES.some((d) => d.id === settings.difficulty) ? settings.difficulty : "medium";
  for (const v of VARIANTS) variantSelect.add(new Option(v.label, v.id));
  variantSelect.value = VARIANTS.some((v) => v.id === settings.variant) ? settings.variant : "classic";

  const syncCustom = () => {
    customBox.hidden = sizeSelect.value !== CUSTOM;
  };
  syncCustom();

  const chosenSize = (): Size => {
    const preset = PRESETS.find((p) => p.id === sizeSelect.value);
    if (preset) return preset.size;
    const size = { rows: clampSize(rowsInput.valueAsNumber), cols: clampSize(colsInput.valueAsNumber) };
    rowsInput.value = String(size.rows);
    colsInput.value = String(size.cols);
    return size;
  };

  /** Esperto e Maestro non sono proponibili sulle griglie piccole: l'opzione si disattiva. */
  const syncDifficulties = () => {
    const available = availableDifficulties(chosenSize());
    for (const option of difficultySelect.options) {
      const d = option.value as Difficulty;
      option.disabled = !available.includes(d);
      option.text = option.disabled ? `${difficultyLabel(d)} (da ${minSide(d)}×${minSide(d)})` : difficultyLabel(d);
    }
  };

  // --- Puzzle pronti in anticipo ---
  const readyKey = ({ size, difficulty, variant }: Choice) => `${size.rows}x${size.cols}:${difficulty}:${variant}`;

  const optionsFor = ({ size, difficulty, variant }: Choice, timeFactor = 1): GenerateOptions => ({
    ...size,
    difficulty,
    variant,
    maxCandidates: 10_000,
    timeLimitMs: timeFactor * TIME_LIMITS[difficulty],
  });

  /** Conserva un puzzle per dopo, solo se è di un livello lento e proprio del livello chiesto. */
  const store = (choice: Choice, puzzle: GenerateResult) => {
    if (!PREFETCH.includes(choice.difficulty) || puzzle.difficulty !== choice.difficulty || !puzzle.logical) return;
    const key = readyKey(choice);
    delete ready[key];
    ready[key] = puzzle;
    const keys = Object.keys(ready);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_READY))) delete ready[old];
    writeJson(READY_KEY, ready);
  };

  /** Prepara in background il prossimo puzzle di un livello lento, se non ce n'è già uno. */
  const prefetch = (choice: Choice) => {
    const key = readyKey(choice);
    if (!PREFETCH.includes(choice.difficulty) || ready[key] || pending?.key === key) return;
    const promise = prefetchAsync(optionsFor(choice, 2));
    pending = { key, promise };
    void promise.then((puzzle) => {
      if (pending?.promise === promise) pending = undefined;
      if (puzzle) store(choice, puzzle);
    });
  };

  /** Puzzle pronto (anche in preparazione), altrimenti generato al momento. Non lo toglie dai pronti. */
  const obtain = async (choice: Choice) => {
    const key = readyKey(choice);
    if (!ready[key] && pending?.key === key) await pending.promise;
    return ready[key] ?? generateAsync(optionsFor(choice));
  };

  const syncLegend = () => {
    legend.hidden = variantSelect.value !== "shapes";
  };
  syncLegend();

  const setStatus = (html: string) => {
    statusEl.innerHTML = html;
  };

  const newGame = async () => {
    const size = chosenSize();
    syncDifficulties();
    const chosen = difficultySelect.value as Difficulty;
    const available = availableDifficulties(size);
    const target = available.includes(chosen) ? chosen : available[available.length - 1]!;
    const variant = variantSelect.value as Variant;
    const choice: Choice = { size, difficulty: target, variant };
    settings.sizeId = sizeSelect.value;
    settings.difficulty = chosen;
    settings.variant = variant;
    if (settings.sizeId === CUSTOM) settings.custom = size;
    writeJson(STORAGE_KEY, settings);
    syncLegend();

    const id = ++request;
    newBtn.disabled = true;
    board.classList.add("busy");
    setStatus(`Generazione di un ${size.rows}×${size.cols} ${difficultyLabel(target).toLowerCase()}…`);
    const puzzle = await obtain(choice);
    if (!puzzle) return;
    if (id !== request) {
      // Nel frattempo è stata chiesta un'altra partita: un puzzle buono si tiene per dopo.
      store(choice, puzzle);
      return;
    }
    const key = readyKey(choice);
    if (ready[key] === puzzle) {
      delete ready[key];
      writeJson(READY_KEY, ready);
    }
    let note = "";
    if (chosen !== target) note = ` · ${difficultyLabel(chosen)} disponibile da ${minSide(chosen)}×${minSide(chosen)}`;
    else if (!puzzle.logical) note = " · oltre Maestro: potrebbe servire andare per tentativi";
    else if (puzzle.difficulty !== chosen) note = ` · non ho trovato un ${difficultyLabel(chosen)} in tempo, eccone uno vicino`;
    startGame(puzzle, variant, note);
    prefetch(choice);
  };

  /** Mette in gioco un puzzle: nuovo, da un link, o ripreso dal salvataggio (saved). */
  const startGame = (puzzle: GenerateResult, variant: Variant, note: string, saved?: SavedState) => {
    request++; // una generazione ancora in corso non sostituisce questa partita
    newBtn.disabled = false;
    board.classList.remove("busy");
    const { rows, cols } = puzzle;
    game = saved?.game ? Game.restore(puzzle, saved.game) : new Game(puzzle);
    gameVariant = variant;
    difficulty = puzzle.difficulty;
    hues = assignHues(puzzle.solution);
    solved = false;
    lastHint = undefined;
    notice = undefined;
    timer.reset(saved?.elapsed ?? 0);
    board.style.setProperty("--rows", String(rows));
    board.style.setProperty("--cols", String(cols));
    board.ariaLabel = `Griglia ${rows} per ${cols}, ${difficultyLabel(difficulty)}`;
    const variantNote = variant === "shapes" ? ` · ${variantLabel(variant)}` : "";
    gameStatus = saved?.status ?? `<span class="level">${difficultyLabel(difficulty)}</span> · ${rows}×${cols}${variantNote}${note}`;
    save();
    render();
  };

  /** Salva la partita in corso; una partita vinta non si riprende. */
  const save = () => {
    if (solved) return removeKey(GAME_KEY);
    const state: SavedState = {
      puzzle: game.puzzle as GenerateResult,
      variant: gameVariant,
      game: game.snapshot(),
      elapsed: timer.elapsed(),
      status: gameStatus,
    };
    writeJson(GAME_KEY, state);
  };

  sizeSelect.addEventListener("change", () => {
    syncCustom();
    // newGame sincronizza da sé le difficoltà; con Personalizzata la partita parte solo su richiesta.
    if (sizeSelect.value === CUSTOM) syncDifficulties();
    else void newGame();
  });
  difficultySelect.addEventListener("change", () => void newGame());
  variantSelect.addEventListener("change", () => void newGame());
  for (const input of [rowsInput, colsInput]) {
    input.addEventListener("change", () => {
      input.value = String(clampSize(input.valueAsNumber));
      syncDifficulties();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void newGame();
    });
  }
  newBtn.addEventListener("click", () => void newGame());

  // --- Rendering ---
  let preview: HTMLDivElement | undefined;

  const render = () => {
    const { rows, cols, clues } = game.puzzle;
    board.replaceChildren();
    preview = undefined;
    if (notice) statusEl.textContent = notice;
    else if (lastHint) statusEl.textContent = hintText(lastHint);
    else setStatus(gameStatus);

    // Linee della griglia sotto i rettangoli, numeri sopra.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        if (c === cols - 1) cell.classList.add("last-col");
        if (r === rows - 1) cell.classList.add("last-row");
        cell.style.gridArea = `${r + 1} / ${c + 1}`;
        board.append(cell);
      }
    }

    game.placed.forEach((rect) => {
      const el = document.createElement("div");
      el.className = "rect";
      gridArea(el, rect);
      const status = game.status(rect);
      if (status !== "open") el.classList.add(status);
      if (status === "valid") el.style.setProperty("--h", String(hues[clues.indexOf(game.cluesIn(rect)[0]!)]));
      if (lastHint && "placed" in lastHint && sameRect(rect, lastHint.placed)) el.classList.add("hinted");
      board.append(el);
    });

    // Il suggerimento ha tolto rettangoli sbagliati: li mostra mentre svaniscono, e resta
    // il contorno di quello spiegato.
    if (lastHint && "removed" in lastHint) {
      for (const rect of lastHint.removed) {
        const el = document.createElement("div");
        el.className = "rect bad removed";
        gridArea(el, rect);
        board.append(el);
      }
      if (lastHint.removed.length > 1) {
        const el = document.createElement("div");
        el.className = "hint-mark wrong";
        gridArea(el, lastHint.wrong.rect);
        board.append(el);
      }
    }

    // Il motivo del suggerimento: la casella decisiva e gli indizi coinvolti lampeggiano.
    for (const spot of lastHint ? hintSpots(lastHint) : []) {
      const el = document.createElement("div");
      el.className = "hint-mark";
      el.style.gridArea = `${spot.r + 1} / ${spot.c + 1}`;
      board.append(el);
    }

    for (const clue of clues) {
      const el = document.createElement("div");
      el.className = "clue";
      if (clue.shape) el.classList.add(clue.shape);
      if (clue.n === undefined) el.classList.add("open");
      el.style.gridArea = `${clue.r + 1} / ${clue.c + 1}`;
      // "?" solo quando non c'è né numero né forma.
      el.textContent = clue.n !== undefined ? String(clue.n) : clue.shape ? "" : "?";
      el.ariaLabel = clueLabel(clue);
      board.append(el);
    }
    board.classList.toggle("solved", solved);

    undoBtn.disabled = !game.canUndo || solved;
    clearBtn.disabled = game.placed.length === 0 || solved;
    hintBtn.disabled = solved;
    hintBtn.textContent = HINT_LABELS[game.hintStage]!;
    checkBtn.disabled = solved || game.placed.length === 0;
    shareBtn.disabled = false;
    renderTimer();
  };

  const renderTimer = () => {
    timerEl.textContent = formatTime(timer.elapsed());
  };
  setInterval(renderTimer, 250);

  const showPreview = (rect: Rect) => {
    if (!preview) {
      preview = document.createElement("div");
      preview.className = "preview";
      board.append(preview);
    }
    gridArea(preview, rect);
    preview.classList.toggle("blocked", game.intent(rect) === "blocked");
    // ✓ quando il rettangolo rispetta il suo indizio (utile soprattutto con le forme).
    const label = area(rect) > 1 ? `${rect.h}×${rect.w}=${area(rect)}` : "";
    preview.textContent = game.isValid(rect) ? `${label} ✓` : label;
  };

  const afterMove = () => {
    if (game.isSolved()) {
      solved = true;
      timer.pause();
      const variant = gameVariant === "shapes" ? ` · ${variantLabel(gameVariant)}` : "";
      const time = timer.elapsed();
      winText.textContent =
        `${difficultyLabel(difficulty)}${variant} · tempo ${formatTime(time)}` +
        (game.hintsUsed > 0
          ? ` · ${game.hintsUsed} suggeriment${game.hintsUsed === 1 ? "o" : "i"}`
          : game.helped
            ? " · con qualche aiuto"
            : " · senza aiuti");
      const { rows, cols } = game.puzzle;
      const { best, bestClean } = recordWin(records, recordKey({ rows, cols, difficulty, variant: gameVariant }), time, !game.helped);
      writeJson(RECORDS_KEY, records);
      winRecord.hidden = !best && !bestClean;
      winRecord.textContent = bestClean && !best ? "Nuovo record senza aiuti!" : "Nuovo record!";
    }
    save();
    render();
    if (solved) winDialog.showModal();
  };

  const firstInput = () => {
    if (!solved) timer.start();
  };

  // --- Input: trascinamento con Pointer Events (mouse e touch) ---
  const cellFromPoint = (x: number, y: number): [number, number] => {
    const box = board.getBoundingClientRect();
    const { rows, cols } = game.puzzle;
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((x - box.left) / box.width) * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((y - box.top) / box.height) * rows)));
    return [r, c];
  };

  let drag: { pointerId: number; start: [number, number]; end: [number, number] } | undefined;

  board.addEventListener("pointerdown", (e) => {
    if (solved || drag || e.button !== 0) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    drag = { pointerId: e.pointerId, start: cell, end: cell };
    board.setPointerCapture(e.pointerId);
    showPreview(rectFromCorners(...cell, ...cell));
  });

  board.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (cell[0] === drag.end[0] && cell[1] === drag.end[1]) return;
    drag.end = cell;
    showPreview(rectFromCorners(...drag.start, ...cell));
  });

  const endDrag = (e: PointerEvent, commit: boolean) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { start, end } = drag;
    drag = undefined;
    if (!commit) return render();

    const rect = rectFromCorners(...start, ...end);
    const intent = game.intent(rect);
    // "blocked" e "none": la griglia non cambia, quindi né cronometro né suggerimento evidenziato.
    if (intent === "remove") game.remove(game.rectAt(...start)!);
    else if (intent === "place") game.place(rect);
    else return render();

    firstInput();
    lastHint = undefined;
    notice = undefined;
    afterMove();
  };
  board.addEventListener("pointerup", (e) => endDrag(e, true));
  board.addEventListener("pointercancel", (e) => endDrag(e, false));

  // --- Azioni ---
  const undo = () => {
    game.undo();
    lastHint = undefined;
    notice = undefined;
    save();
    render();
  };
  undoBtn.addEventListener("click", undo);
  clearBtn.addEventListener("click", () => {
    game.clear();
    lastHint = undefined;
    notice = undefined;
    save();
    render();
  });
  hintBtn.addEventListener("click", () => {
    firstInput();
    lastHint = game.hint();
    notice = undefined;
    afterMove();
  });
  checkBtn.addEventListener("click", () => {
    const wrong = game.check();
    notice =
      wrong === 0 ? "Finora è tutto giusto." : wrong === 1 ? "C'è un rettangolo sbagliato." : `Ci sono ${wrong} rettangoli sbagliati.`;
    lastHint = undefined;
    save();
    render();
  });

  // --- Condividere ---
  shareBtn.addEventListener("click", async () => {
    const { rows, cols, clues } = game.puzzle;
    const url = location.href.split("#")[0] + LINK_PREFIX + encodePuzzle({ rows, cols, clues, variant: gameVariant });
    // Sul telefono il menu di condivisione, sul computer il link copiato.
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: `Shikaku ${rows}×${cols} · ${difficultyLabel(difficulty)}`, url });
        return;
      } catch {
        // Condivisione annullata o non riuscita: si copia il link.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      notice = "Link copiato: chi lo apre gioca questo stesso puzzle.";
    } catch {
      notice = `Link: ${url}`;
    }
    render();
  });

  // --- Record ---
  const recordTime = (ms: number | undefined) => (ms === undefined ? "—" : formatTime(ms));
  recordsBtn.addEventListener("click", () => {
    const rows = Object.entries(records)
      .flatMap(([key, rec]) => {
        const parsed = parseRecordKey(key);
        return parsed ? [{ ...parsed, rec }] : [];
      })
      .sort(
        (a, b) =>
          a.variant.localeCompare(b.variant) ||
          a.rows * a.cols - b.rows * b.cols ||
          a.rows - b.rows ||
          difficultyLevel(a.difficulty) - difficultyLevel(b.difficulty),
      );
    if (rows.length === 0) {
      recordsBody.textContent = "Ancora nessuna partita vinta.";
    } else {
      const table = document.createElement("table");
      table.innerHTML = "<thead><tr><th>Partita</th><th>Vinte</th><th>Migliore</th><th>Senza aiuti</th></tr></thead>";
      const body = table.createTBody();
      for (const { rows: r, cols: c, difficulty: d, variant: v, rec } of rows) {
        const tr = body.insertRow();
        const variant = v === "shapes" ? ` · ${variantLabel(v)}` : "";
        for (const text of [`${r}×${c} · ${difficultyLabel(d)}${variant}`, String(rec.wins), recordTime(rec.best), recordTime(rec.bestClean)]) {
          tr.insertCell().textContent = text;
        }
      }
      recordsBody.replaceChildren(table);
    }
    recordsDialog.showModal();
  });
  document.addEventListener("keydown", (e) => {
    if (!game || solved || e.target instanceof HTMLInputElement) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    }
  });

  winDialog.addEventListener("close", () => {
    if (winDialog.returnValue === "new") void newGame();
  });

  // Il cronometro si ferma con la scheda nascosta e riparte al ritorno.
  // Nascondendo la scheda si salva anche il tempo trascorso.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      timer.pause();
      if (game) save();
    } else if (!solved && timer.elapsed() > 0) timer.start();
  });
  addEventListener("pagehide", () => {
    if (game) save();
  });

  // --- Avvio: un puzzle dal link, altrimenti la partita salvata, altrimenti una nuova ---
  /** Allinea i menu al puzzle di un link, così "Nuova partita" ne propone uno simile. */
  const syncControls = (puzzle: GenerateResult, variant: Variant) => {
    const preset = PRESETS.find((p) => p.size.rows === puzzle.rows && p.size.cols === puzzle.cols);
    sizeSelect.value = preset?.id ?? CUSTOM;
    rowsInput.value = String(puzzle.rows);
    colsInput.value = String(puzzle.cols);
    syncCustom();
    syncDifficulties();
    difficultySelect.value = puzzle.difficulty;
    variantSelect.value = variant;
    syncLegend();
  };

  /**
   * Apre il puzzle del link nell'indirizzo, se c'è; true se valido. L'indirizzo si ripulisce:
   * ricaricando si riprende la partita salvata, non si riapre il link da capo.
   */
  const openLink = (): boolean => {
    if (!location.hash.startsWith(LINK_PREFIX)) return false;
    const linked = puzzleFromCode(location.hash.slice(LINK_PREFIX.length));
    try {
      history.replaceState(null, "", location.href.split("#")[0]);
    } catch {
      // Alcuni browser con file://: l'indirizzo resta col link.
    }
    if (linked) {
      syncControls(linked.puzzle, linked.variant);
      startGame(linked.puzzle, linked.variant, " · da un link");
      return true;
    }
    if (game) {
      notice = "Il link non contiene un puzzle valido.";
      render();
    }
    return false;
  };
  // Un link incollato nella scheda già aperta cambia solo la parte dopo "#".
  addEventListener("hashchange", openLink);

  const saved = readJson<SavedState>(GAME_KEY, {});
  const hadLink = location.hash.startsWith(LINK_PREFIX);
  const linkOpened = openLink();
  const warnBadLink = () => {
    if (!hadLink || !game) return;
    notice = "Il link non contiene un puzzle valido.";
    render();
  };
  if (linkOpened) {
    // Si gioca il puzzle del link.
  } else if (saved.puzzle && saved.variant && saved.game) {
    // I menu restano quelli salvati nelle impostazioni, con il livello scelto (non quello misurato).
    syncDifficulties();
    startGame(saved.puzzle, saved.variant, "", saved);
    warnBadLink();
  } else {
    void newGame().then(warnBadLink);
  }
}
