import { formatTime, Game, Timer, type Hint } from "./game";
import { generate, type GenerateOptions, type GenerateResult } from "./generator";
import {
  area,
  availableDifficulties,
  clampSize,
  DIFFICULTIES,
  difficultyLabel,
  MAX_SIZE,
  MIN_SIZE,
  minSide,
  PRESETS,
  rectFromCorners,
  sameRect,
  TIME_LIMITS,
  type Difficulty,
  type Rect,
  type Size,
} from "./types";
import GeneratorWorker from "./worker?worker&inline";

const STORAGE_KEY = "shikaku:settings";
const READY_KEY = "shikaku:ready";
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
  theme: Theme;
}

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

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage non disponibile (navigazione privata, file://): si perde solo ciò che si voleva ricordare.
  }
}

const DEFAULT_SETTINGS: Settings = { sizeId: "8x8", custom: { rows: 6, cols: 8 }, difficulty: "medium", theme: "auto" };

type Ready = Record<string, GenerateResult>;

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

  const timer = new Timer();
  const generateAsync = createGenerator();
  // Un secondo Worker per preparare in anticipo: non viene annullato dalle partite nuove.
  const prefetchAsync = createGenerator();
  const ready = readJson<Ready>(READY_KEY, {});
  let pending: { key: string; promise: Promise<GenerateResult | undefined> } | undefined;
  // Assegnata alla prima generazione; fino ad allora i comandi sono disattivati.
  let game!: Game;
  let difficulty: Difficulty = settings.difficulty;
  let hues: number[] = [];
  let solved = false;
  let lastHint: Hint | undefined;
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
  const readyKey = (size: Size, d: Difficulty) => `${size.rows}x${size.cols}:${d}`;

  const optionsFor = (size: Size, d: Difficulty, timeFactor = 1): GenerateOptions => ({
    ...size,
    difficulty: d,
    maxCandidates: 10_000,
    timeLimitMs: timeFactor * TIME_LIMITS[d],
  });

  /** Conserva un puzzle per dopo, solo se è di un livello lento e proprio del livello chiesto. */
  const store = (size: Size, d: Difficulty, puzzle: GenerateResult) => {
    if (!PREFETCH.includes(d) || puzzle.difficulty !== d || !puzzle.logical) return;
    const key = readyKey(size, d);
    delete ready[key];
    ready[key] = puzzle;
    const keys = Object.keys(ready);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_READY))) delete ready[old];
    writeJson(READY_KEY, ready);
  };

  /** Prepara in background il prossimo puzzle di un livello lento, se non ce n'è già uno. */
  const prefetch = (size: Size, d: Difficulty) => {
    const key = readyKey(size, d);
    if (!PREFETCH.includes(d) || ready[key] || pending?.key === key) return;
    const promise = prefetchAsync(optionsFor(size, d, 2));
    pending = { key, promise };
    void promise.then((puzzle) => {
      if (pending?.promise === promise) pending = undefined;
      if (puzzle) store(size, d, puzzle);
    });
  };

  /** Puzzle pronto (anche in preparazione), altrimenti generato al momento. Non lo toglie dai pronti. */
  const obtain = async (size: Size, d: Difficulty) => {
    const key = readyKey(size, d);
    if (!ready[key] && pending?.key === key) await pending.promise;
    return ready[key] ?? generateAsync(optionsFor(size, d));
  };

  const setStatus = (html: string) => {
    statusEl.innerHTML = html;
  };

  const newGame = async () => {
    const size = chosenSize();
    syncDifficulties();
    const chosen = difficultySelect.value as Difficulty;
    const available = availableDifficulties(size);
    const target = available.includes(chosen) ? chosen : available[available.length - 1]!;
    settings.sizeId = sizeSelect.value;
    settings.difficulty = chosen;
    if (settings.sizeId === CUSTOM) settings.custom = size;
    writeJson(STORAGE_KEY, settings);

    const id = ++request;
    newBtn.disabled = true;
    board.classList.add("busy");
    setStatus(`Generazione di un ${size.rows}×${size.cols} ${difficultyLabel(target).toLowerCase()}…`);
    const puzzle = await obtain(size, target);
    if (!puzzle) return;
    if (id !== request) {
      // Nel frattempo è stata chiesta un'altra partita: un puzzle buono si tiene per dopo.
      store(size, target, puzzle);
      return;
    }
    const key = readyKey(size, target);
    if (ready[key] === puzzle) {
      delete ready[key];
      writeJson(READY_KEY, ready);
    }
    newBtn.disabled = false;
    board.classList.remove("busy");

    const { rows, cols } = puzzle;
    game = new Game(puzzle);
    difficulty = puzzle.difficulty;
    hues = assignHues(puzzle.solution);
    solved = false;
    lastHint = undefined;
    timer.reset();
    board.style.setProperty("--rows", String(rows));
    board.style.setProperty("--cols", String(cols));
    board.ariaLabel = `Griglia ${rows} per ${cols}, ${difficultyLabel(difficulty)}`;

    let note = "";
    if (chosen !== target) note = ` · ${difficultyLabel(chosen)} disponibile da ${minSide(chosen)}×${minSide(chosen)}`;
    else if (!puzzle.logical) note = " · oltre Maestro: potrebbe servire andare per tentativi";
    else if (difficulty !== chosen) note = ` · non ho trovato un ${difficultyLabel(chosen)} in tempo, eccone uno vicino`;
    setStatus(`<span class="level">${difficultyLabel(difficulty)}</span> · ${rows}×${cols}${note}`);
    render();
    prefetch(size, target);
  };

  sizeSelect.addEventListener("change", () => {
    syncCustom();
    // newGame sincronizza da sé le difficoltà; con Personalizzata la partita parte solo su richiesta.
    if (sizeSelect.value === CUSTOM) syncDifficulties();
    else void newGame();
  });
  difficultySelect.addEventListener("change", () => void newGame());
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

    // Il suggerimento ha tolto rettangoli sbagliati: li mostra mentre svaniscono.
    if (lastHint && "removed" in lastHint) {
      for (const rect of lastHint.removed) {
        const el = document.createElement("div");
        el.className = "rect bad removed";
        gridArea(el, rect);
        board.append(el);
      }
    }

    for (const clue of clues) {
      const num = document.createElement("div");
      num.className = "clue";
      num.style.gridArea = `${clue.r + 1} / ${clue.c + 1}`;
      num.textContent = String(clue.n);
      board.append(num);
    }
    board.classList.toggle("solved", solved);

    undoBtn.disabled = !game.canUndo || solved;
    clearBtn.disabled = game.placed.length === 0 || solved;
    hintBtn.disabled = solved;
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
    preview.textContent = area(rect) > 1 ? `${rect.h}×${rect.w}=${area(rect)}` : "";
  };

  const afterMove = () => {
    if (game.isSolved()) {
      solved = true;
      timer.pause();
      winText.textContent =
        `${difficultyLabel(difficulty)} · tempo ${formatTime(timer.elapsed())}` +
        (game.hintsUsed > 0 ? ` · ${game.hintsUsed} suggeriment${game.hintsUsed === 1 ? "o" : "i"}` : " · senza suggerimenti");
    }
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
    afterMove();
  };
  board.addEventListener("pointerup", (e) => endDrag(e, true));
  board.addEventListener("pointercancel", (e) => endDrag(e, false));

  // --- Azioni ---
  const undo = () => {
    game.undo();
    lastHint = undefined;
    render();
  };
  undoBtn.addEventListener("click", undo);
  clearBtn.addEventListener("click", () => {
    game.clear();
    lastHint = undefined;
    render();
  });
  hintBtn.addEventListener("click", () => {
    firstInput();
    lastHint = game.hint();
    afterMove();
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
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) timer.pause();
    else if (!solved && timer.elapsed() > 0) timer.start();
  });

  void newGame();
}
