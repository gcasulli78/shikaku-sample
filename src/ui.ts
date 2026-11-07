import { cellArea, gridArea, gridCell } from "./board";
import { assignHues, tint } from "./colors";
import { formatTime, Game, Timer } from "./game";
import type { GenerateOptions, GenerateResult } from "./generator";
import {
  clueName,
  explainFrames,
  HINT_LABELS,
  HUE_NAMES,
  hintSpots,
  hintText,
  type Namer,
  type ShownHint,
  secondsLeft,
} from "./hint-text";
import { setupKeyboard } from "./keyboard";
import { clueLabel, variantLabel, variantSuffix } from "./labels";
import { startLoader } from "./loader";
import { recordKey, recordWin } from "./records";
import { showRecords } from "./records-dialog";
import { createRunner } from "./runner";
import { moveSelection, type Selection, selectionAt, selectionRect, selectionStart, startSelection } from "./selection";
import { encodePuzzle, type LinkedPuzzle } from "./share";
import { GAME_KEY, READY_KEY, RECORDS_KEY, readStored, removeKey, STORAGE_KEY, writeJson } from "./storage";
import { CUSTOM, parseReady, parseRecords, parseSavedState, parseSettings, type SavedState, type Theme } from "./stored";
import { setupTutorial } from "./tutorial-panel";
import {
  area,
  availableDifficulties,
  CHECK_LIMITS,
  type Clue,
  clampSize,
  DIFFICULTIES,
  type Difficulty,
  difficultyLabel,
  HINT_LIMITS,
  hintsExplained,
  MAX_SIZE,
  MIN_SIZE,
  minSide,
  PRESETS,
  type Size,
  sameRect,
  TIME_LIMITS,
  VARIANTS,
  type Variant,
} from "./types";

/** The puzzle in the link: address#p=code (see share.ts). */
const LINK_PREFIX = "#p=";

/** Levels that are slow to generate: while playing, the next one is already being prepared. */
const PREFETCH: Difficulty[] = ["expert", "master"];
/** Maximum ready puzzles kept (one per grid and level). */
const MAX_READY = 6;

/** What the generator is asked for a game. */
interface Choice {
  size: Size;
  difficulty: Difficulty;
  variant: Variant;
}

/** Every how many ms the explanation moves to the next step (or with a tap on the sentence). */
const FRAME_MS = 3500;

/**
 * The status line: the level highlighted (if any) and the text. Written with DOM nodes, never as
 * HTML: the note also comes from the game saved in localStorage.
 */
interface Status {
  level?: string;
  text: string;
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

export function startApp(): void {
  const settings = readStored(STORAGE_KEY, parseSettings);
  const board = $<HTMLDivElement>("board");
  const sizeSelect = $<HTMLSelectElement>("size");
  const difficultySelect = $<HTMLSelectElement>("difficulty");
  const variantSelect = $<HTMLSelectElement>("variant");
  const legend = $<HTMLParagraphElement>("legend");
  const statusEl = $<HTMLParagraphElement>("status");
  $("version").textContent = `Versione ${__APP_VERSION__}`;
  const newBtn = $<HTMLButtonElement>("new");
  const customBox = $<HTMLDivElement>("custom");
  const rowsInput = $<HTMLInputElement>("rows");
  const colsInput = $<HTMLInputElement>("cols");
  const timerEl = $<HTMLSpanElement>("timer");
  const themeBtn = $<HTMLButtonElement>("theme");
  const settingsBtn = $<HTMLButtonElement>("settings-btn");
  const settingsPanel = $<HTMLElement>("settings");
  const choiceBtn = $<HTMLButtonElement>("choice");
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
  const srEl = $<HTMLParagraphElement>("sr");
  const tutorialBtn = $<HTMLButtonElement>("tutorial-btn");
  const tutorialPanel = $<HTMLElement>("tutorial");
  const tutorialStepEl = $<HTMLParagraphElement>("tutorial-step");
  const tutorialTitle = $<HTMLHeadingElement>("tutorial-title");
  const tutorialText = $<HTMLParagraphElement>("tutorial-text");
  const tutorialDone = $<HTMLParagraphElement>("tutorial-done");
  const tutorialPrev = $<HTMLButtonElement>("tutorial-prev");
  const tutorialNext = $<HTMLButtonElement>("tutorial-next");
  const tutorialExit = $<HTMLButtonElement>("tutorial-exit");

  const timer = new Timer();
  const generateAsync = createRunner<GenerateResult>();
  // A second Worker to prepare in advance: it isn't cancelled by new games.
  const prefetchAsync = createRunner<GenerateResult>();
  // And one for links: a crafted link can keep the solver busy (up to LINK_TIME_MS).
  const linkAsync = createRunner<LinkedPuzzle>();
  const ready = readStored(READY_KEY, parseReady);
  let pending: { key: string; promise: Promise<GenerateResult | undefined> } | undefined;
  // Assigned at the first generation; until then the controls are disabled.
  let game!: Game;
  let difficulty: Difficulty = settings.difficulty;
  let gameVariant: Variant = settings.variant;
  let hues: number[] = [];
  /** The loading animation in progress (startLoader): stops it. */
  let stopLoader: (() => void) | undefined;
  /** Freshly generated game: the numbers come in with an animation (see render). */
  let entering = false;
  /** "il 6 verde": the color of its pill (the gray ones, the "?", stay without). */
  const nameOf: Namer = (clue, prep = "") => {
    const i = game.puzzle.clues.indexOf(clue);
    const grey = clue.n === undefined && !clue.shape;
    return clueName(clue, prep, i < 0 || grey ? undefined : HUE_NAMES[hues[i]!]);
  };
  let solved = false;
  let lastHint: ShownHint | undefined;
  /** Which step the explanation shows (see explainFrames). */
  let explainFrame = 0;
  /** An explanation with several steps is being shown. */
  const explaining = () => !!lastHint && "explain" in lastHint && explainFrames(lastHint.explain, nameOf).length > 1;
  /** The game's status line; after a hint, the reason takes its place. */
  let gameStatus: Status = { text: "" };
  /** The status line note (" · da un link"…), saved with the game. */
  let gameNote = "";
  /** A notice in place of the status line (link copied…), until the next move. */
  let notice: string | undefined;
  /** A move removes the hint's reason and the notices. */
  const clearMessages = () => {
    lastHint = undefined;
    notice = undefined;
  };
  const records = readStored(RECORDS_KEY, parseRecords);
  let request = 0;

  // --- Theme ---
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

  // --- Settings: grid, difficulty, variant and theme in a panel that opens on demand ---
  // The row with the current choice opens the same panel as the gear.
  const toggleSettings = () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsBtn.ariaExpanded = choiceBtn.ariaExpanded = String(!settingsPanel.hidden);
  };
  settingsBtn.addEventListener("click", toggleSettings);
  choiceBtn.addEventListener("click", toggleSettings);
  /** "10×10 · Difficile · Forme": what the menus ask for the next game. */
  const syncChoice = () => {
    const size = sizeSelect.value === CUSTOM ? `${rowsInput.value}×${colsInput.value}` : sizeSelect.selectedOptions[0]?.text;
    const parts = [size, difficultyLabel(difficultySelect.value as Difficulty), variantLabel(variantSelect.value as Variant)];
    choiceBtn.textContent = parts.join(" · ");
  };
  settingsPanel.addEventListener("change", syncChoice);

  // --- Size choice ---
  for (const preset of PRESETS) sizeSelect.add(new Option(preset.label, preset.id));
  sizeSelect.add(new Option("Personalizzata…", CUSTOM));
  for (const input of [rowsInput, colsInput]) {
    input.min = String(MIN_SIZE);
    input.max = String(MAX_SIZE);
  }
  // The settings are already checked by parseSettings.
  sizeSelect.value = settings.sizeId;
  rowsInput.value = String(settings.custom.rows);
  colsInput.value = String(settings.custom.cols);
  for (const d of DIFFICULTIES) difficultySelect.add(new Option(d.label, d.id));
  difficultySelect.value = settings.difficulty;
  for (const v of VARIANTS) variantSelect.add(new Option(v.label, v.id));
  variantSelect.value = settings.variant;

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

  /** Expert and Master can't be offered on small grids: the option is disabled. */
  const syncDifficulties = () => {
    const available = availableDifficulties(chosenSize());
    for (const option of difficultySelect.options) {
      const d = option.value as Difficulty;
      option.disabled = !available.includes(d);
      option.text = option.disabled ? `${difficultyLabel(d)} (da ${minSide(d)}×${minSide(d)})` : difficultyLabel(d);
    }
  };

  // --- Puzzles prepared in advance ---
  const readyKey = ({ size, difficulty, variant }: Choice) => `${size.rows}x${size.cols}:${difficulty}:${variant}`;

  const optionsFor = ({ size, difficulty, variant }: Choice, timeFactor = 1): GenerateOptions => ({
    ...size,
    difficulty,
    variant,
    maxCandidates: 10_000,
    timeLimitMs: timeFactor * TIME_LIMITS[difficulty],
  });

  /** Keeps a puzzle for later, only if it is of a slow level and exactly of the requested level. */
  const store = (choice: Choice, puzzle: GenerateResult) => {
    if (!PREFETCH.includes(choice.difficulty) || puzzle.difficulty !== choice.difficulty || !puzzle.logical) return;
    const key = readyKey(choice);
    delete ready[key];
    ready[key] = puzzle;
    const keys = Object.keys(ready);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_READY))) delete ready[old];
    writeJson(READY_KEY, ready);
  };

  /** Prepares in the background the next puzzle of a slow level, if there isn't one already. */
  const prefetch = (choice: Choice) => {
    const key = readyKey(choice);
    if (!PREFETCH.includes(choice.difficulty) || ready[key] || pending?.key === key) return;
    const promise = prefetchAsync({ generate: optionsFor(choice, 2) });
    pending = { key, promise };
    void promise.then((puzzle) => {
      if (pending?.promise === promise) pending = undefined;
      if (puzzle) store(choice, puzzle);
    });
  };

  /** Ready puzzle (even one being prepared), otherwise generated on the spot. Doesn't remove it from the ready ones. */
  const obtain = async (choice: Choice) => {
    const key = readyKey(choice);
    if (!ready[key] && pending?.key === key) await pending.promise;
    return ready[key] ?? generateAsync({ generate: optionsFor(choice) });
  };

  const setStatus = ({ level, text }: Status) => {
    const parts: (Node | string)[] = [];
    if (level) {
      const span = document.createElement("span");
      span.className = "level";
      span.textContent = level;
      parts.push(span);
    }
    parts.push(text);
    statusEl.replaceChildren(...parts);
  };

  const newGame = async () => {
    tutorial.leave();
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

    const id = ++request;
    newBtn.disabled = true;
    board.classList.add("busy");
    stopLoader?.();
    stopLoader = startLoader(board, size.rows, size.cols);
    setStatus({ text: `Generazione di un ${size.rows}×${size.cols} ${difficultyLabel(target).toLowerCase()}…` });
    const puzzle = await obtain(choice);
    if (!puzzle) return;
    if (id !== request) {
      // Meanwhile another game was requested: a good puzzle is kept for later.
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
    entering = true;
    // Time to come in (wave at most 0.7 s + 0.35 s): then normal renders.
    setTimeout(() => (entering = false), 1200);
    startGame(puzzle, variant, { note });
    prefetch(choice);
  };

  /**
   * Puts a puzzle in play: new, from a link, resumed from the save (saved) or from the tutorial
   * (status: the status line in place of level and grid).
   */
  const startGame = (
    puzzle: GenerateResult,
    variant: Variant,
    options: { note?: string; saved?: SavedState; status?: string; hintCooldown?: number } = {},
  ) => {
    const { note = "", saved, hintCooldown } = options;
    request++; // a generation still in progress doesn't replace this game
    newBtn.disabled = false;
    stopLoader?.();
    stopLoader = undefined;
    board.classList.remove("busy");
    const { rows, cols } = puzzle;
    // Hints and checks limited per level; at Master and Shapes Expert the hint doesn't explain. In
    // the tutorial no limits: it teaches precisely through the explanations.
    const tutorial = options.status !== undefined;
    const gameOptions = tutorial
      ? { hintCooldown }
      : {
          hintCooldown,
          hintLimit: HINT_LIMITS[puzzle.difficulty],
          checkLimit: CHECK_LIMITS[puzzle.difficulty],
          quiet: !hintsExplained(variant, puzzle.difficulty),
        };
    game = saved?.game ? Game.restore(puzzle, saved.game, gameOptions) : new Game(puzzle, gameOptions);
    gameVariant = variant;
    difficulty = puzzle.difficulty;
    hues = assignHues(puzzle.clues);
    solved = false;
    clearMessages();
    // The stopwatch starts when the grid is in play (even resumed) and stops only at the win: time
    // with the page open, decided by the user. With the page closed the saved time counts.
    timer.reset(saved?.elapsed ?? 0);
    timer.start();
    legend.hidden = variant !== "shapes";
    board.style.setProperty("--rows", String(rows));
    board.style.setProperty("--cols", String(cols));
    board.ariaLabel = `Griglia ${rows} per ${cols}, ${difficultyLabel(difficulty)}`;
    gameNote = note;
    gameStatus =
      options.status !== undefined
        ? { text: options.status }
        : { level: difficultyLabel(difficulty), text: ` · ${rows}×${cols}${variantSuffix(variant)}${note}` };
    syncChoice();
    save();
    render();
  };

  /** Saves the game in progress; a won game isn't resumed. */
  const save = () => {
    if (tutorial.active()) return;
    if (solved) return removeKey(GAME_KEY);
    const state: SavedState = {
      puzzle: game.puzzle as GenerateResult,
      variant: gameVariant,
      game: game.snapshot(),
      elapsed: timer.elapsed(),
      note: gameNote,
    };
    writeJson(GAME_KEY, state);
  };

  sizeSelect.addEventListener("change", () => {
    syncCustom();
    // newGame syncs the difficulties by itself; with Custom the game starts only on request.
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
    else if (lastHint) statusEl.textContent = hintText(lastHint, explainFrame, nameOf);
    else setStatus(gameStatus);
    statusEl.classList.toggle("stepper", !notice && explaining());

    // Grid lines below the rectangles, numbers above.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = gridCell(r, c, rows, cols);
        if (game.isBlocked(r, c)) cell.classList.add("black");
        board.append(cell);
      }
    }

    game.placed.forEach((rect) => {
      const el = document.createElement("div");
      el.className = "rect";
      gridArea(el, rect);
      const status = game.status(rect);
      if (status !== "open") el.classList.add(status);
      if (status === "valid") tint(el, hues[clues.indexOf(game.cluesIn(rect)[0]!)]!);
      if (lastHint && "placed" in lastHint && lastHint.placed && sameRect(rect, lastHint.placed)) el.classList.add("hinted");
      board.append(el);
    });

    // The hint removed wrong rectangles: shows them while they fade, and the outline of the
    // explained one stays.
    if (lastHint && "removed" in lastHint) {
      for (const rect of lastHint.removed) {
        const el = document.createElement("div");
        el.className = "rect bad removed";
        gridArea(el, rect);
        board.append(el);
      }
      if ("wrong" in lastHint && lastHint.removed.length > 1) {
        const el = document.createElement("div");
        el.className = "hint-mark wrong";
        gridArea(el, lastHint.wrong.rect);
        board.append(el);
      }
    }

    // The hint's reason: the decisive cell and the clues involved flash. The explanation, one step
    // at a time: the tried shape and the pieces it would make forced, dashed in their clue's hue;
    // the cells the sentence talks about, the clue it talks about circled, and the problem in red.
    if (lastHint && "explain" in lastHint) {
      const frames = explainFrames(lastHint.explain, nameOf);
      const frame = frames[explainFrame % frames.length]!;
      const hueOf = (clue: Clue) => hues[clues.indexOf(clue)] ?? 250;
      for (const piece of [...(frame.ghost ? [frame.ghost] : []), ...frame.chain]) {
        const el = document.createElement("div");
        el.className = piece === frame.ghost ? "ghost tried" : "ghost";
        tint(el, hueOf(piece.clue));
        gridArea(el, piece.rect);
        board.append(el);
      }
      for (const spot of frame.marks) {
        const el = document.createElement("div");
        el.className = "hint-mark spot";
        cellArea(el, spot.r, spot.c);
        board.append(el);
      }
      if (frame.subject) {
        const el = document.createElement("div");
        el.className = "hint-mark subject";
        tint(el, hueOf(frame.subject));
        cellArea(el, frame.subject.r, frame.subject.c);
        board.append(el);
      }
      for (const spot of frame.problems) {
        const el = document.createElement("div");
        el.className = clues.includes(spot as Clue) ? "hint-mark problem on-clue" : "hint-mark problem";
        cellArea(el, spot.r, spot.c);
        board.append(el);
      }
    }

    for (const spot of lastHint ? hintSpots(lastHint) : []) {
      const el = document.createElement("div");
      el.className = "hint-mark";
      cellArea(el, spot.r, spot.c);
      board.append(el);
    }

    clues.forEach((clue, i) => {
      const el = document.createElement("div");
      el.className = "clue";
      if (clue.shape) el.classList.add("shaped");
      cellArea(el, clue.r, clue.c);
      el.ariaLabel = clueLabel(clue);
      // The pill's shape tells the constraint; circle with just the number, gray with the "?".
      const pill = document.createElement("span");
      pill.className = `pill ${clue.shape ?? (clue.n === undefined ? "any" : "")}`.trimEnd();
      tint(pill, hues[i]!);
      // Freshly generated game: the numbers come in as a wave, from the top-left corner.
      if (entering) {
        pill.classList.add("enter");
        pill.style.animationDelay = `${Math.min((clue.r + clue.c) * 35, 700)}ms`;
      }
      pill.textContent = clue.n !== undefined ? String(clue.n) : clue.shape ? "" : "?";
      el.append(pill);
      board.append(el);
    });
    board.classList.toggle("solved", solved);
    keys.render();

    undoBtn.disabled = !game.canUndo || solved;
    clearBtn.disabled = game.placed.length === 0 || solved;
    const checksLeft = game.checksLeft;
    checkBtn.textContent =
      checksLeft === undefined ? "Verifica" : checksLeft === 0 ? "Verifiche finite" : `Verifica (${checksLeft})`;
    checkBtn.disabled = solved || game.placed.length === 0 || checksLeft === 0;
    shareBtn.disabled = false;
    renderTimer();
  };

  /** At the third step, until 15 s have passed since the last hinted piece, countdown. */
  const syncHintButton = () => {
    const left = game.hintsLeft;
    if (left !== undefined && (left === 0 || game.hintStage === 0)) {
      // With a limit, at step 0 how many are left (without explanations the step stays 0).
      const label = left === 0 ? "Suggerimenti finiti" : `${HINT_LABELS[0]} (${left})`;
      hintBtn.disabled = solved || left === 0;
      if (hintBtn.textContent !== label) hintBtn.textContent = label;
      return;
    }
    const wait = game.hintStage === 2 ? game.cooldown(timer.elapsed()) : 0;
    const label = wait > 0 ? `${HINT_LABELS[2]} (${secondsLeft(wait)})` : HINT_LABELS[game.hintStage]!;
    hintBtn.disabled = solved || wait > 0;
    // Called by the stopwatch 4 times per second: written only if it changes.
    if (hintBtn.textContent !== label) hintBtn.textContent = label;
  };

  const renderTimer = () => {
    timerEl.textContent = formatTime(timer.elapsed());
    if (game) syncHintButton();
  };
  setInterval(renderTimer, 250);

  const clearPreview = () => {
    preview?.remove();
    preview = undefined;
  };

  const showPreview = (sel: Selection) => {
    const rect = selectionRect(sel);
    const at = selectionAt(sel);
    if (!preview) {
      preview = document.createElement("div");
      preview.className = "preview";
      board.append(preview);
    }
    gridArea(preview, rect);
    // The label goes in the half opposite the finger, so it doesn't end up under it.
    const half = (v: number, from: number, size: number) => (v - from < size / 2 ? "end" : "start");
    preview.style.placeItems = `${half(at[0], rect.r, rect.h)} ${half(at[1], rect.c, rect.w)}`;
    preview.classList.toggle("blocked", game.intent(rect) === "blocked");
    // ✓ when the rectangle matches its clue (useful especially with shapes).
    const label = area(rect) > 1 ? `${rect.h}×${rect.w}=${area(rect)}` : "";
    preview.textContent = game.isValid(rect) ? `${label} ✓` : label;
  };

  /** After every grid change: win, save, draw. */
  const afterMove = () => {
    if (game.isSolved()) {
      solved = true;
      timer.pause();
    }
    if (solved && tutorial.active()) {
      tutorial.solved();
      return render();
    }
    if (solved) {
      const time = timer.elapsed();
      winText.textContent =
        `${difficultyLabel(difficulty)}${variantSuffix(gameVariant)} · tempo ${formatTime(time)}` +
        (game.hintsUsed > 0
          ? ` · ${game.hintsUsed} suggeriment${game.hintsUsed === 1 ? "o" : "i"}`
          : game.helped
            ? " · con qualche aiuto"
            : " · senza aiuti");
      const { rows, cols } = game.puzzle;
      const { best, bestClean } = recordWin(
        records,
        recordKey({ rows, cols, difficulty, variant: gameVariant }),
        time,
        !game.helped,
      );
      writeJson(RECORDS_KEY, records);
      winRecord.hidden = !best && !bestClean;
      winRecord.textContent = bestClean && !best ? "Nuovo record senza aiuti!" : "Nuovo record!";
    }
    save();
    render();
    if (solved) winDialog.showModal();
  };

  // --- Input: dragging with Pointer Events (mouse and touch) ---
  const cellFromPoint = (x: number, y: number): [number, number] => {
    const box = board.getBoundingClientRect();
    const { rows, cols } = game.puzzle;
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((x - box.left) / box.width) * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((y - box.top) / box.height) * rows)));
    return [r, c];
  };

  let drag: { pointerId: number; sel: Selection } | undefined;

  board.addEventListener("pointerdown", (e) => {
    keys.release();
    if (solved || drag || e.button !== 0) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    drag = { pointerId: e.pointerId, sel: startSelection(...cell) };
    board.setPointerCapture(e.pointerId);
    showPreview(drag.sel);
  });

  board.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    const [r, c] = selectionAt(drag.sel);
    if (cell[0] === r && cell[1] === c) return;
    drag.sel = moveSelection(drag.sel, ...cell);
    showPreview(drag.sel);
  });

  /** Places the selection drawn with the mouse, the finger or the keyboard. */
  const commitRect = (sel: Selection) => {
    const rect = selectionRect(sel);
    const intent = game.intent(rect);
    // "blocked" and "none": the grid doesn't change, so the highlighted hint stays.
    if (intent === "remove") game.remove(game.rectAt(...selectionStart(sel))!);
    else if (intent === "place") game.place(rect);
    else return render();

    clearMessages();
    afterMove();
  };

  const endDrag = (e: PointerEvent, commit: boolean) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { sel } = drag;
    drag = undefined;
    if (commit) commitRect(sel);
    else render();
  };
  board.addEventListener("pointerup", (e) => endDrag(e, true));
  board.addEventListener("pointercancel", (e) => endDrag(e, false));

  // --- Keyboard: a cursor on the grid (keyboard.ts) ---
  const keys = setupKeyboard({
    board,
    sr: srEl,
    game: () => game,
    solved: () => solved,
    commit: commitRect,
    remove: (rect) => {
      game.remove(rect);
      clearMessages();
      afterMove();
    },
    render: () => render(),
    showPreview: (sel) => showPreview(sel),
    clearPreview: () => clearPreview(),
  });

  // --- Actions ---
  // Undo can also complete the grid (by putting back a removed piece): it goes through afterMove.
  const undo = () => {
    game.undo();
    clearMessages();
    afterMove();
  };
  undoBtn.addEventListener("click", undo);
  clearBtn.addEventListener("click", () => {
    game.clear();
    clearMessages();
    afterMove();
  });
  hintBtn.addEventListener("click", () => {
    const hint = game.hint(timer.elapsed());
    if (hint && "wait" in hint) {
      // Too early for another piece: the clue and reason already shown stay highlighted.
      notice = `Il prossimo pezzo si può mostrare tra ${secondsLeft(hint.wait)}.`;
      return render();
    }
    clearMessages();
    lastHint = hint;
    explainFrame = 0;
    restartSteps();
    afterMove();
  });
  // The explanation goes through its steps by itself, never during a drag; a tap on the sentence
  // moves right to the next step and restarts the wait.
  let stepTimer: ReturnType<typeof setInterval> | undefined;
  const nextStep = () => {
    if (!explaining() || preview) return;
    explainFrame++;
    render();
  };
  const restartSteps = () => {
    clearInterval(stepTimer);
    stepTimer = setInterval(nextStep, FRAME_MS);
  };
  restartSteps();
  statusEl.addEventListener("click", () => {
    if (!explaining() || notice) return;
    nextStep();
    restartSteps();
  });
  checkBtn.addEventListener("click", () => {
    const wrong = game.check();
    if (wrong === undefined) return;
    clearMessages();
    notice =
      wrong === 0
        ? "Finora è tutto giusto."
        : wrong === 1
          ? "C'è un rettangolo sbagliato."
          : `Ci sono ${wrong} rettangoli sbagliati.`;
    save();
    render();
  });

  // --- Sharing ---
  shareBtn.addEventListener("click", async () => {
    const { rows, cols, clues, blocked } = game.puzzle;
    const url = location.href.split("#")[0] + LINK_PREFIX + encodePuzzle({ rows, cols, clues, blocked, variant: gameVariant });
    // On the phone the share menu, on the computer the copied link.
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: `Shikaku ${rows}×${cols} · ${difficultyLabel(difficulty)}`, url });
        return;
      } catch {
        // Sharing cancelled or failed: the link is copied.
      }
    }
    clearMessages();
    try {
      await navigator.clipboard.writeText(url);
      notice = "Link copiato: chi lo apre gioca questo stesso puzzle.";
    } catch {
      notice = `Link: ${url}`;
    }
    render();
  });

  // --- Records (records-dialog.ts) ---
  recordsBtn.addEventListener("click", () => showRecords(records, recordsBody, recordsDialog));
  document.addEventListener("keydown", (e) => {
    if (!game || solved || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "h" && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      hintBtn.click();
    }
  });

  winDialog.addEventListener("close", () => {
    if (winDialog.returnValue === "new") void newGame();
  });

  // The stopwatch doesn't stop with the tab hidden (decided by the user): hiding it only saves the
  // elapsed time, in case the browser closes the page.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game) save();
  });
  addEventListener("pagehide", () => {
    if (game) save();
  });

  // --- Tutorial: hand-written grids, played on the real grid (tutorial-panel.ts) ---
  const tutorial = setupTutorial({
    button: tutorialBtn,
    panel: tutorialPanel,
    stepLabel: tutorialStepEl,
    title: tutorialTitle,
    text: tutorialText,
    done: tutorialDone,
    prev: tutorialPrev,
    next: tutorialNext,
    exit: tutorialExit,
    start: (puzzle, variant, options) => startGame(puzzle, variant, options),
    saveGame: () => {
      if (game) save();
    },
    resumeOrNew: () => {
      if (!resume()) void newGame();
    },
  });

  /** Resumes the saved game; false if there isn't one. */
  function resume(): boolean {
    const saved = readStored(GAME_KEY, parseSavedState);
    if (!saved) return false;
    // The menus stay as saved in the settings, with the chosen level (not the measured one).
    syncDifficulties();
    try {
      startGame(saved.puzzle, saved.variant, { saved, note: saved.note });
    } catch {
      // A saved game that passes the checks but can't be resumed: a new one starts.
      removeKey(GAME_KEY);
      return false;
    }
    return true;
  }

  // --- Startup: a puzzle from the link, otherwise the saved game, otherwise a new one ---
  /** Aligns the menus with a link's puzzle, so "Nuova partita" offers a similar one. */
  const syncControls = (puzzle: GenerateResult, variant: Variant) => {
    const preset = PRESETS.find((p) => p.size.rows === puzzle.rows && p.size.cols === puzzle.cols);
    sizeSelect.value = preset?.id ?? CUSTOM;
    rowsInput.value = String(puzzle.rows);
    colsInput.value = String(puzzle.cols);
    syncCustom();
    syncDifficulties();
    difficultySelect.value = puzzle.difficulty;
    variantSelect.value = variant;
  };

  let linkRequest = 0;

  /**
   * Opens the link's puzzle in the address, if present ("none" if there is none, "bad" if
   * corrupted, "stale" if meanwhile another link arrived or another game started). Solution and
   * level are computed in the Worker: a crafted link doesn't block the page. The address gets
   * cleaned up: reloading resumes the saved game, not the link from scratch.
   */
  const openLink = async (): Promise<"ok" | "bad" | "none" | "stale"> => {
    if (!location.hash.startsWith(LINK_PREFIX)) return "none";
    const code = location.hash.slice(LINK_PREFIX.length);
    try {
      history.replaceState(null, "", location.href.split("#")[0]);
    } catch {
      // Some browsers with file://: the address keeps the link.
    }
    const id = ++linkRequest;
    const gameId = request;
    if (game) {
      notice = "Apertura del link…";
      render();
    } else setStatus({ text: "Apertura del link…" });
    const linked = await linkAsync({ link: code });
    if (id !== linkRequest || gameId !== request) return "stale";
    if (linked) {
      tutorial.leave();
      syncControls(linked.puzzle, linked.variant);
      startGame(linked.puzzle, linked.variant, { note: " · da un link" });
      return "ok";
    }
    return "bad";
  };
  const warnBadLink = () => {
    if (!game) return;
    notice = "Il link non contiene un puzzle valido.";
    render();
  };
  // A link pasted into the already open tab only changes the part after "#".
  addEventListener("hashchange", () => {
    void openLink().then((link) => link === "bad" && warnBadLink());
  });

  void openLink().then((link) => {
    if (link === "ok" || link === "stale") {
      // The link's puzzle is played, or the one started in the meantime.
    } else if (resume()) {
      if (link === "bad") warnBadLink();
    } else {
      void newGame().then(() => link === "bad" && warnBadLink());
    }
  });
}
