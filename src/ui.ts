import { formatTime, Game, Timer, type Hint, type Reason, type WrongReason } from "./game";
import { partition, type GenerateOptions, type GenerateResult } from "./generator";
import { createRng, randomSeed } from "./rng";
import { runJob, type Job } from "./jobs";
import { parseRecordKey, recordKey, recordWin } from "./records";
import { moveSelection, selectionAt, selectionRect, selectionStart, startSelection, type Selection } from "./selection";
import { completePuzzle, encodePuzzle, type LinkedPuzzle } from "./share";
import {
  CUSTOM,
  parseReady,
  parseRecords,
  parseSavedState,
  parseSettings,
  type SavedState,
  type Theme,
} from "./stored";
import { TUTORIAL } from "./tutorial";
import {
  area,
  availableDifficulties,
  clampSize,
  DIFFICULTIES,
  difficultyLabel,
  difficultyLevel,
  HINT_LIMIT,
  hintsExplained,
  MAX_SIZE,
  MIN_SIZE,
  minSide,
  PRESETS,
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

/** Livelli lenti da generare: mentre si gioca se ne prepara già il prossimo. */
const PREFETCH: Difficulty[] = ["expert", "master"];
/** Puzzle pronti conservati al massimo (uno per griglia e livello). */
const MAX_READY = 6;

/** Cosa si chiede al generatore per una partita. */
interface Choice {
  size: Size;
  difficulty: Difficulty;
  variant: Variant;
}

function variantLabel(v: Variant): string {
  return VARIANTS.find((x) => x.id === v)!.label;
}

/** " · Forme" dopo livello o griglia; niente per il Classico. */
function variantSuffix(v: Variant): string {
  return v !== "classic" ? ` · ${variantLabel(v)}` : "";
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

/**
 * Nome a parole della tinta di una pastiglia (vedi HUES): nei suggerimenti "il 6 verde"
 * distingue due 6 meglio di "l'altro 6" (segnalato dall'utente: non si capiva quale).
 */
const HUE_NAMES: Record<number, string> = {
  25: "rosso",
  55: "arancione",
  95: "giallo",
  150: "verde",
  195: "verde acqua",
  250: "blu",
  285: "indaco",
  320: "viola",
};

type Prep = "" | "di" | "a";

/** Come si chiama un indizio nelle frasi: con articolo e, se la pastiglia è colorata, il colore. */
type Namer = (clue: Clue, prep?: Prep) => string;

/**
 * L'indizio con l'articolo, semplice o con di/a: "il 6 verde", "dell'8", "all'indizio blu".
 * Si apostrofano i numeri che si leggono con una vocale (uno, otto, undici, ottanta…).
 * Niente nome della forma ("il 2 non quadrato" suonava strano): il colore basta.
 */
function clueName(clue: Clue, prep: Prep = "", color?: string): string {
  const { n } = clue;
  const noun = n !== undefined ? String(n) : clue.shape ? "indizio" : "?";
  const vowel = n === undefined ? noun === "indizio" : n === 1 || n === 8 || n === 11 || (n >= 80 && n <= 89);
  const article = vowel ? { "": "l'", di: "dell'", a: "all'" }[prep] : { "": "il ", di: "del ", a: "al " }[prep];
  return `${article}${noun}${color ? ` ${color}` : ""}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Riepilogo del motivo quando il pezzo è posato. */
function reasonText(reason: Reason | undefined, name: Namer): string {
  if (!reason) return "Nessuna deduzione semplice da qui: ecco un pezzo della soluzione.";
  if (reason.kind === "single") return `${capitalize(name(reason.clue))} può stare solo così.`;
  if (reason.only) return `Solo ${name(reason.clue)} arriva alla casella segnata: ecco come.`;
  return `Le altre forme ${name(reason.clue, "di")} creavano un problema: resta questa.`;
}

/**
 * Un passo della spiegazione: la frase e cosa si vede. ghost: la forma che si prova
 * (tratteggiata nella tinta del suo indizio); chain: i pezzi che diventerebbero obbligati,
 * ognuno nella tinta del suo indizio; marks: le caselle segnate di cui parla la frase;
 * subject: l'indizio di cui parla, cerchiato; problems: il problema, l'unica cosa in rosso.
 */
interface Frame {
  text: string;
  ghost?: { rect: Rect; clue: Clue };
  chain: { rect: Rect; clue: Clue }[];
  marks: { r: number; c: number }[];
  subject?: Clue;
  problems: { r: number; c: number }[];
}

/** Un altro indizio nella spiegazione: "l'altro 4 verde" se si chiama come quello che si guarda. */
function otherName(clue: Clue, focus: Clue, name: Namer): string {
  const own = name(clue);
  return clue !== focus && own === name(focus) ? `l'altro ${own.replace(/^(il |l')/, "")}` : own;
}

/**
 * La spiegazione a passi, una cosa per volta (segnalato dall'utente: tutto in una frase con
 * tutto disegnato insieme non si seguiva). Per ogni forma scartata: si prova la forma ("Proviamo
 * il 2 verde qui, nel tratteggio"), poi un passo per ogni pezzo che diventa obbligato, poi il
 * problema. Le figure si accumulano: nel passo del problema si vede tutta la catena. Alla
 * fine la conclusione. Si guarda un indizio solo e tutto si verifica sulla griglia.
 */
function explainFrames(reason: Reason, name: Namer): Frame[] {
  const focus = reason.clue;
  const Focus = capitalize(name(focus));
  if (reason.kind === "single") {
    return [
      { text: `${Focus} può stare in un solo modo: le altre forme toccherebbero altri numeri o pezzi.`, chain: [], marks: [], subject: focus, problems: [] },
    ];
  }
  if (reason.only) {
    const many = reason.discards.length > 1 ? "le altre sue forme non ci arrivano" : "l'altra sua forma non ci arriva";
    return [{ text: `La casella segnata può raggiungerla solo ${name(focus)}, e ${many}.`, chain: [], marks: [reason.only], subject: focus, problems: [] }];
  }
  const total = reason.discards.length;
  const frames: Frame[] = [];
  reason.discards.forEach(({ rect, forced, problem }, k) => {
    const count = total > 1 ? `(${k + 1}/${total}) ` : "";
    const ghost = { rect, clue: focus };
    frames.push({ text: `${count}Proviamo ${name(focus)} qui, nel tratteggio.`, ghost, chain: [], marks: [], subject: focus, problems: [] });
    forced.forEach((f, n) => {
      const who = otherName(f.clue, focus, name);
      const text = f.cell ? `Allora la casella segnata può coprirla solo ${who}, e solo così.` : `Allora ${who} ha un posto solo: questo.`;
      frames.push({
        text: `${count}${text}`,
        ghost,
        chain: forced.slice(0, n + 1).map((g) => ({ rect: g.rect, clue: g.clue })),
        marks: f.cell ? [f.cell] : [],
        subject: f.clue,
        problems: [],
      });
    });
    const chain = forced.map((g) => ({ rect: g.rect, clue: g.clue }));
    const end =
      "clue" in problem
        ? `Ma così ${otherName(problem.clue, focus, name)} non ha più spazio.`
        : "Ma così la casella in rosso non può coprirla più nessuno.";
    frames.push({ text: `${count}${end}`, ghost, chain, marks: [], problems: ["clue" in problem ? problem.clue : problem.cell] });
  });
  const rest = total === 1 ? `Quindi ${name(focus)} va nell'altro modo.` : `Nessuna di queste ${total} forme va: ${name(focus)} può stare in un modo solo.`;
  frames.push({ text: rest, chain: [], marks: [], subject: focus, problems: [] });
  return frames;
}

/** Ogni quanti ms la spiegazione passa al passo successivo (o con un tocco sulla frase). */
const FRAME_MS = 3500;

/** Cosa chiede la forma di un indizio, per spiegare un rettangolo della forma sbagliata. */
const SHAPE_NEEDS: Record<Shape, string> = {
  square: "un quadrato",
  oblong: "un rettangolo non quadrato",
  wide: "un rettangolo più largo che alto",
  tall: "un rettangolo più alto che largo",
};

/** Perché il rettangolo (evidenziato) è sbagliato, a parole (misplaced: vedi hintText). */
function wrongText(why: Exclude<WrongReason, { kind: "misplaced" }>, rect: Rect, name: Namer): string {
  switch (why.kind) {
    case "empty":
      return "non contiene nessun indizio";
    case "many":
      return `contiene ${why.count} indizi`;
    case "area":
      return `${name(why.clue)} vuole ${why.clue.n} caselle, qui ce ne sono ${area(rect)}`;
    case "shape":
      return `${name(why.clue)} vuole ${SHAPE_NEEDS[why.clue.shape!]}`;
    case "starved":
      return `così ${name(why.clue)} non avrebbe più spazio`;
    case "uncovered":
      return "così la casella evidenziata non la potrebbe coprire nessun indizio";
  }
}

/** "12 s": quanto manca, arrotondato per eccesso. */
function secondsLeft(ms: number): string {
  return `${Math.ceil(ms / 1000)} s`;
}

/** Un suggerimento mostrato (l'attesa non si mostra come suggerimento, ma come avviso). */
type ShownHint = Exclude<Hint, { wait: number }>;

/** "Ne resta 1." / "Suggerimenti finiti." dopo un suggerimento limitato. */
function leftText(left: number): string {
  return left === 0 ? "Suggerimenti finiti." : left === 1 ? "Ne resta 1." : `Ne restano ${left}.`;
}

function hintText(hint: ShownHint, frame: number, name: Namer): string {
  if ("quiet" in hint) {
    const n = hint.removed.length;
    const what = hint.placed ? "Ecco un pezzo." : n === 1 ? "Tolto un rettangolo sbagliato." : `Tolti ${n} rettangoli sbagliati.`;
    return `${what} ${leftText(hint.left)}`;
  }
  if ("removed" in hint) {
    if (hint.wrong.why.kind === "misplaced") {
      // Il motivo non si vede dalla griglia: niente frase, il pezzo giusto.
      const of = name(hint.wrong.why.clue, "di");
      const where = hint.placed ? "ecco dove va" : "dove va te lo mostro al prossimo suggerimento";
      return hint.removed.length === 1
        ? `Tolto un rettangolo sbagliato ${of}: ${where}.`
        : `Tolti ${hint.removed.length} rettangoli sbagliati. Quello evidenziato era ${of}: ${where}.`;
    }
    const why = wrongText(hint.wrong.why, hint.wrong.rect, name);
    return hint.removed.length === 1
      ? `Tolto un rettangolo sbagliato: ${why}.`
      : `Tolti ${hint.removed.length} rettangoli sbagliati. Quello evidenziato: ${why}.`;
  }
  if ("focus" in hint) return `Guarda ${name(hint.focus.clue)}: si può già capire dove va.`;
  if ("explain" in hint) {
    const frames = explainFrames(hint.explain, name);
    return frames[frame % frames.length]!.text;
  }
  if (hint.fix) return `Ecco dove va ${name(hint.fix)}.`;
  return reasonText(hint.reason, name);
}

/** Le caselle da evidenziare per un suggerimento: indizi e casella decisiva (la spiegazione ha le sue). */
function hintSpots(hint: ShownHint): { r: number; c: number }[] {
  if ("quiet" in hint) return [];
  if ("removed" in hint) {
    const { why } = hint.wrong;
    return why.kind === "starved" ? [why.clue] : why.kind === "uncovered" ? [why.cell] : [];
  }
  if ("focus" in hint) return [hint.focus.clue];
  if ("explain" in hint) return [];
  if (!hint.reason) return [];
  return hint.reason.only ? [hint.reason.only, hint.reason.clue] : [hint.reason.clue];
}

const HINT_LABELS = ["Suggerimento", "Perché?", "Mostra il pezzo"];

/**
 * Lavora nel Worker (genera un puzzle o apre un link); se non si può creare (browser
 * vecchi), nel thread principale. Una nuova richiesta annulla quella in corso: il Worker
 * viene ricreato e la vecchia promessa si risolve con undefined. R è il risultato dei
 * lavori che si chiedono a questa istanza.
 */
function createRunner<R>(): (job: Job) => Promise<R | undefined> {
  let worker: Worker | undefined;
  let usable = true;
  let current: { id: number; job: Job; resolve: (r: R | undefined) => void } | undefined;
  let nextId = 0;

  const fallback = (task: NonNullable<typeof current>) => {
    // Lascia al browser il tempo di mostrare "Generazione…" prima di bloccarsi.
    setTimeout(() => task.resolve(current === task ? (runJob(task.job) as R | undefined) : undefined), 30);
  };

  const spawn = () => {
    try {
      worker = new GeneratorWorker();
    } catch {
      usable = false;
      worker = undefined;
      return;
    }
    worker.addEventListener("message", (e: MessageEvent<{ id: number; result: R | undefined }>) => {
      if (current && e.data.id === current.id) {
        const task = current;
        current = undefined;
        task.resolve(e.data.result);
      }
    });
    worker.addEventListener("error", () => {
      usable = false;
      worker?.terminate();
      worker = undefined;
      if (current) fallback(current);
    });
  };

  return (job) =>
    new Promise((resolve) => {
      if (current) {
        current.resolve(undefined);
        current = undefined;
        worker?.terminate();
        worker = undefined;
      }
      const task = { id: ++nextId, job, resolve };
      current = task;
      if (usable && !worker) spawn();
      if (worker) worker.postMessage({ id: task.id, job });
      else fallback(task);
    });
}

/** Valore salvato in localStorage, controllato da parse (vedi stored.ts); undefined se manca. */
function readStored<T>(key: string, parse: (raw: unknown) => T): T {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined;
  } catch {
    // Storage non disponibile o JSON rovinato: come se non ci fosse niente.
  }
  return parse(raw);
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

/**
 * La riga di stato: il livello in evidenza (se c'è) e il testo. Si scrive con nodi DOM,
 * mai come HTML: la nota arriva anche dalla partita salvata in localStorage.
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

/** Tinte OKLCH ben distinte tra loro, alla stessa luminosità (vedi --pill-l in style.css). */
const HUES = [250, 150, 55, 320, 25, 195, 95, 285];

/**
 * La stessa tinta in HSL, per i browser senza oklch() (Safari prima di 15.4, Firefox prima
 * di 113): calcolata convertendo il colore della pastiglia. Vedi @supports in style.css.
 */
const HSL_HUES: Record<number, number> = { 250: 207, 150: 146, 55: 28, 320: 289, 25: 2, 195: 181, 95: 47, 285: 246 };

/** Dà a un elemento la tinta di un indizio: --h per oklch(), --hh per l'alternativa HSL. */
function tint(el: HTMLElement, hue: number): void {
  el.style.setProperty("--h", String(hue));
  el.style.setProperty("--hh", String(HSL_HUES[hue] ?? hue));
}

/**
 * Una tinta per indizio, diversa da quelle degli indizi vicini (entro tre caselle), così
 * due pastiglie uguali non stanno accanto. Dipende solo dalla posizione degli indizi, non
 * dalla soluzione: i colori non devono suggerire niente.
 */
function assignHues(clues: Clue[]): number[] {
  const hues: number[] = [];
  const offset = Math.floor(Math.random() * HUES.length);
  clues.forEach((clue, i) => {
    const used = new Map<number, number>();
    for (let j = 0; j < i; j++) {
      const other = clues[j]!;
      if (Math.max(Math.abs(other.r - clue.r), Math.abs(other.c - clue.c)) <= 3) used.set(hues[j]!, (used.get(hues[j]!) ?? 0) + 1);
    }
    const candidates = HUES.map((_, k) => HUES[(k + offset + i) % HUES.length]!);
    const free = candidates.find((h) => !used.has(h));
    // Con tutti i colori già usati vicino si prende il meno usato.
    hues.push(free ?? candidates.reduce((best, h) => ((used.get(h) ?? 0) < (used.get(best) ?? 0) ? h : best)));
  });
  return hues;
}

/** Una casella della griglia (le linee tratteggiate), senza il bordo esterno. */
function gridCell(r: number, c: number, rows: number, cols: number): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "cell";
  if (c === cols - 1) cell.classList.add("last-col");
  if (r === rows - 1) cell.classList.add("last-row");
  cell.style.gridArea = `${r + 1} / ${c + 1}`;
  return cell;
}

/** Dopo quanti ms d'attesa parte l'animazione: prima niente, per non lampeggiare con i puzzle pronti. */
const LOADER_DELAY = 250;
/** Quanto dura il riempimento di una griglia nell'animazione, in ms. */
const LOADER_FILL_MS = 1600;

/**
 * L'attesa di un puzzle (scelta dall'utente tra tre proposte): la griglia vuota della nuova
 * misura si ritaglia da sola, un rettangolo colorato alla volta in ordine sparso, come se
 * qualcuno la risolvesse; piena, svanisce e ricomincia con un altro taglio. I tagli sono
 * casuali (partition, come fa il generatore), non c'entrano con la soluzione. Con "riduci
 * movimento" solo la griglia vuota che pulsa piano (style.css). Restituisce lo stop.
 */
function startLoader(board: HTMLElement, rows: number, cols: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rng = createRng(randomSeed());
  const later = (fn: () => void, ms: number) => {
    timer = setTimeout(() => {
      if (!stopped) fn();
    }, ms);
  };
  const round = () => {
    const rects = partition(rows, cols, rng, undefined, true);
    // Ordine sparso (Fisher–Yates): sembra qualcuno che ragiona, non una stampante.
    for (let i = rects.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rects[i], rects[j]] = [rects[j]!, rects[i]!];
    }
    const step = Math.min(180, Math.max(40, LOADER_FILL_MS / rects.length));
    const offset = Math.floor(rng() * HUES.length);
    const pieces: HTMLElement[] = [];
    const add = (k: number) => {
      if (k === rects.length) {
        later(() => {
          for (const el of pieces) el.classList.add("out");
          later(() => {
            for (const el of pieces) el.remove();
            round();
          }, 350);
        }, 500);
        return;
      }
      const el = document.createElement("div");
      el.className = "rect valid loader-piece";
      // Tinte a passo 3 sulle 8: due pezzi di fila non hanno mai lo stesso colore.
      tint(el, HUES[(offset + k * 3) % HUES.length]!);
      gridArea(el, rects[k]!);
      board.append(el);
      pieces.push(el);
      later(() => add(k + 1), step);
    };
    add(0);
  };
  later(() => {
    board.classList.remove("busy");
    board.classList.add("loading");
    board.style.setProperty("--rows", String(rows));
    board.style.setProperty("--cols", String(cols));
    const cells: HTMLElement[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(gridCell(r, c, rows, cols));
    board.replaceChildren(...cells);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) round();
  }, LOADER_DELAY);
  board.ariaBusy = "true";
  return () => {
    stopped = true;
    clearTimeout(timer);
    board.classList.remove("loading");
    board.ariaBusy = null;
  };
}

function gridArea(el: HTMLElement, rect: Rect): void {
  el.style.gridArea = `${rect.r + 1} / ${rect.c + 1} / span ${rect.h} / span ${rect.w}`;
}

function cellArea(el: HTMLElement, r: number, c: number): void {
  gridArea(el, { r, c, h: 1, w: 1 });
}

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
  // Un secondo Worker per preparare in anticipo: non viene annullato dalle partite nuove.
  const prefetchAsync = createRunner<GenerateResult>();
  // E uno per i link: un link costruito ad arte può tenere occupato il solver (fino a LINK_TIME_MS).
  const linkAsync = createRunner<LinkedPuzzle>();
  const ready = readStored(READY_KEY, parseReady);
  let pending: { key: string; promise: Promise<GenerateResult | undefined> } | undefined;
  // Assegnata alla prima generazione; fino ad allora i comandi sono disattivati.
  let game!: Game;
  let difficulty: Difficulty = settings.difficulty;
  let gameVariant: Variant = settings.variant;
  let hues: number[] = [];
  /** L'animazione d'attesa in corso (startLoader): la ferma. */
  let stopLoader: (() => void) | undefined;
  /** Partita appena generata: i numeri entrano con un'animazione (vedi render). */
  let entering = false;
  /** "il 6 verde": il colore della sua pastiglia (le grigie, i "?", restano senza). */
  const nameOf: Namer = (clue, prep = "") => {
    const i = game.puzzle.clues.indexOf(clue);
    const grey = clue.n === undefined && !clue.shape;
    return clueName(clue, prep, i < 0 || grey ? undefined : HUE_NAMES[hues[i]!]);
  };
  let solved = false;
  let lastHint: ShownHint | undefined;
  /** Quale passo mostra la spiegazione (vedi explainFrames). */
  let explainFrame = 0;
  /** Si sta mostrando una spiegazione con più passi. */
  const explaining = () => !!lastHint && "explain" in lastHint && explainFrames(lastHint.explain, nameOf).length > 1;
  /** La riga di stato della partita; dopo un suggerimento al suo posto c'è il motivo. */
  let gameStatus: Status = { text: "" };
  /** La nota della riga di stato (" · da un link"…), salvata con la partita. */
  let gameNote = "";
  /** Un avviso al posto della riga di stato (link copiato…), fino alla mossa successiva. */
  let notice: string | undefined;
  /** Una mossa toglie il motivo del suggerimento e gli avvisi. */
  const clearMessages = () => {
    lastHint = undefined;
    notice = undefined;
  };
  const records = readStored(RECORDS_KEY, parseRecords);
  /** Il passo del tutorial in corso: la partita vera resta salvata e si riprende all'uscita. */
  let tutorialStep: number | undefined;
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

  // --- Impostazioni: griglia, difficoltà, variante e tema in un riquadro che si apre a richiesta ---
  // La riga con la scelta attuale apre lo stesso riquadro dell'ingranaggio.
  const toggleSettings = () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsBtn.ariaExpanded = choiceBtn.ariaExpanded = String(!settingsPanel.hidden);
  };
  settingsBtn.addEventListener("click", toggleSettings);
  choiceBtn.addEventListener("click", toggleSettings);
  /** "10×10 · Difficile · Forme": quello che i menu chiedono per la prossima partita. */
  const syncChoice = () => {
    const size = sizeSelect.value === CUSTOM ? `${rowsInput.value}×${colsInput.value}` : sizeSelect.selectedOptions[0]?.text;
    const parts = [size, difficultyLabel(difficultySelect.value as Difficulty), variantLabel(variantSelect.value as Variant)];
    choiceBtn.textContent = parts.join(" · ");
  };
  settingsPanel.addEventListener("change", syncChoice);

  // --- Scelta dimensione ---
  for (const preset of PRESETS) sizeSelect.add(new Option(preset.label, preset.id));
  sizeSelect.add(new Option("Personalizzata…", CUSTOM));
  for (const input of [rowsInput, colsInput]) {
    input.min = String(MIN_SIZE);
    input.max = String(MAX_SIZE);
  }
  // Le impostazioni sono già controllate da parseSettings.
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
    const promise = prefetchAsync({ generate: optionsFor(choice, 2) });
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
    leaveTutorial();
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
    entering = true;
    // Il tempo di entrare (onda al massimo 0,7 s + 0,35 s): poi i render normali.
    setTimeout(() => (entering = false), 1200);
    startGame(puzzle, variant, { note });
    prefetch(choice);
  };

  /**
   * Mette in gioco un puzzle: nuovo, da un link, ripreso dal salvataggio (saved) o del
   * tutorial (status: la riga di stato al posto di livello e griglia).
   */
  const startGame = (
    puzzle: GenerateResult,
    variant: Variant,
    options: { note?: string; saved?: SavedState; status?: string; hintCooldown?: number } = {},
  ) => {
    const { note = "", saved, hintCooldown } = options;
    request++; // una generazione ancora in corso non sostituisce questa partita
    newBtn.disabled = false;
    stopLoader?.();
    stopLoader = undefined;
    board.classList.remove("busy");
    const { rows, cols } = puzzle;
    // Maestro e Forme Esperto: suggerimenti limitati e senza spiegazione (non nel tutorial,
    // che insegna proprio con le spiegazioni).
    const tutorial = options.status !== undefined;
    const hintLimit = tutorial || hintsExplained(variant, puzzle.difficulty) ? undefined : HINT_LIMIT;
    game = saved?.game ? Game.restore(puzzle, saved.game, { hintCooldown, hintLimit }) : new Game(puzzle, { hintCooldown, hintLimit });
    gameVariant = variant;
    difficulty = puzzle.difficulty;
    hues = assignHues(puzzle.clues);
    solved = false;
    clearMessages();
    // Il cronometro parte quando la griglia è in gioco (anche ripresa) e si ferma solo alla
    // vittoria: tempo a pagina aperta, deciso dall'utente. A pagina chiusa conta il salvato.
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

  /** Salva la partita in corso; una partita vinta non si riprende. */
  const save = () => {
    if (tutorialStep !== undefined) return;
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
    else if (lastHint) statusEl.textContent = hintText(lastHint, explainFrame, nameOf);
    else setStatus(gameStatus);
    statusEl.classList.toggle("stepper", !notice && explaining());

    // Linee della griglia sotto i rettangoli, numeri sopra.
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

    // Il suggerimento ha tolto rettangoli sbagliati: li mostra mentre svaniscono, e resta
    // il contorno di quello spiegato.
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

    // Il motivo del suggerimento: la casella decisiva e gli indizi coinvolti lampeggiano.
    // La spiegazione, un passo alla volta: la forma provata e i pezzi che renderebbe
    // obbligati, tratteggiati nella tinta del loro indizio; le caselle di cui parla la frase,
    // l'indizio di cui parla cerchiato, e il problema in rosso.
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
      // La forma della pastiglia dice il vincolo; cerchio con solo il numero, grigia col "?".
      const pill = document.createElement("span");
      pill.className = `pill ${clue.shape ?? (clue.n === undefined ? "any" : "")}`.trimEnd();
      tint(pill, hues[i]!);
      // Partita appena generata: i numeri entrano a onda, dall'angolo in alto a sinistra.
      if (entering) {
        pill.classList.add("enter");
        pill.style.animationDelay = `${Math.min((clue.r + clue.c) * 35, 700)}ms`;
      }
      pill.textContent = clue.n !== undefined ? String(clue.n) : clue.shape ? "" : "?";
      el.append(pill);
      board.append(el);
    });
    board.classList.toggle("solved", solved);
    renderCursor();

    undoBtn.disabled = !game.canUndo || solved;
    clearBtn.disabled = game.placed.length === 0 || solved;
    checkBtn.disabled = solved || game.placed.length === 0;
    shareBtn.disabled = false;
    renderTimer();
  };

  /** Al terzo grado, finché non sono passati 15 s dall'ultimo pezzo suggerito, conto alla rovescia. */
  const syncHintButton = () => {
    const left = game.hintsLeft;
    if (left !== undefined) {
      // Suggerimento limitato: niente gradi, solo quanti ne restano.
      const label = left === 0 ? "Suggerimenti finiti" : `Suggerimento (${left})`;
      hintBtn.disabled = solved || left === 0;
      if (hintBtn.textContent !== label) hintBtn.textContent = label;
      return;
    }
    const wait = game.hintStage === 2 ? game.cooldown(timer.elapsed()) : 0;
    const label = wait > 0 ? `${HINT_LABELS[2]} (${secondsLeft(wait)})` : HINT_LABELS[game.hintStage]!;
    hintBtn.disabled = solved || wait > 0;
    // Chiamata dal cronometro 4 volte al secondo: si scrive solo se cambia.
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
    // La scritta va nella metà opposta a quella del dito, per non finirci sotto.
    const half = (v: number, from: number, size: number) => (v - from < size / 2 ? "end" : "start");
    preview.style.placeItems = `${half(at[0], rect.r, rect.h)} ${half(at[1], rect.c, rect.w)}`;
    preview.classList.toggle("blocked", game.intent(rect) === "blocked");
    // ✓ quando il rettangolo rispetta il suo indizio (utile soprattutto con le forme).
    const label = area(rect) > 1 ? `${rect.h}×${rect.w}=${area(rect)}` : "";
    preview.textContent = game.isValid(rect) ? `${label} ✓` : label;
  };

  /** Dopo ogni cambiamento della griglia: vittoria, salvataggio, disegno. */
  const afterMove = () => {
    if (game.isSolved()) {
      solved = true;
      timer.pause();
    }
    if (solved && tutorialStep !== undefined) {
      const last = tutorialStep === TUTORIAL.length - 1;
      tutorialDone.textContent = last ? "Risolto! Hai visto tutte le regole: buon divertimento." : "Risolto! Passa al prossimo.";
      tutorialDone.hidden = false;
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
      const { best, bestClean } = recordWin(records, recordKey({ rows, cols, difficulty, variant: gameVariant }), time, !game.helped);
      writeJson(RECORDS_KEY, records);
      winRecord.hidden = !best && !bestClean;
      winRecord.textContent = bestClean && !best ? "Nuovo record senza aiuti!" : "Nuovo record!";
    }
    save();
    render();
    if (solved) winDialog.showModal();
  };

  // --- Input: trascinamento con Pointer Events (mouse e touch) ---
  const cellFromPoint = (x: number, y: number): [number, number] => {
    const box = board.getBoundingClientRect();
    const { rows, cols } = game.puzzle;
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((x - box.left) / box.width) * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((y - box.top) / box.height) * rows)));
    return [r, c];
  };

  let drag: { pointerId: number; sel: Selection } | undefined;

  board.addEventListener("pointerdown", (e) => {
    if (keyboard) {
      keyboard = false;
      selecting = undefined;
      renderCursor();
    }
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

  /** Posa la selezione disegnata col mouse, col dito o da tastiera. */
  const commitRect = (sel: Selection) => {
    const rect = selectionRect(sel);
    const intent = game.intent(rect);
    // "blocked" e "none": la griglia non cambia, quindi il suggerimento evidenziato resta.
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

  // --- Tastiera: un cursore sulla griglia; Invio inizia la selezione e poi la posa ---
  /** Il cursore si vede solo usando la tastiera, finché non si torna al mouse. */
  let keyboard = false;
  let cursor: [number, number] = [0, 0];
  /** La selezione da tastiera, dalla casella dove si è premuto Invio. */
  let selecting: Selection | undefined;
  let cursorEl: HTMLDivElement | undefined;

  const renderCursor = () => {
    cursorEl?.remove();
    cursorEl = undefined;
    if (!keyboard || !game || solved) return;
    const { rows, cols } = game.puzzle;
    cursor = [Math.min(cursor[0], rows - 1), Math.min(cursor[1], cols - 1)];
    cursorEl = document.createElement("div");
    cursorEl.className = "cursor";
    cellArea(cursorEl, ...cursor);
    board.append(cursorEl);
    if (selecting) showPreview(selecting);
  };

  /** Cosa c'è sotto il cursore, per i lettori di schermo. */
  const describeCursor = () => {
    const [r, c] = cursor;
    const clue = game.puzzle.clues.find((cl) => cl.r === r && cl.c === c);
    const rect = game.rectAt(r, c);
    const parts = [`Riga ${r + 1}, colonna ${c + 1}`];
    if (clue) parts.push(`indizio: ${clueLabel(clue)}`);
    parts.push(game.isBlocked(r, c) ? "casella nera" : rect ? `nel rettangolo ${rect.h}×${rect.w}` : "libera");
    if (selecting) {
      const sel = selectionRect(selecting);
      parts.push(`selezione ${sel.h}×${sel.w}, Invio per posarla`);
    }
    srEl.textContent = parts.join(", ") + ".";
  };

  const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  board.addEventListener("keydown", (e) => {
    if (!game || solved || e.ctrlKey || e.metaKey || e.altKey) return;
    const move = MOVES[e.key];
    if (move) {
      const { rows, cols } = game.puzzle;
      if (keyboard) cursor = [Math.min(rows - 1, Math.max(0, cursor[0] + move[0])), Math.min(cols - 1, Math.max(0, cursor[1] + move[1]))];
      keyboard = true;
      if (selecting) selecting = moveSelection(selecting, ...cursor);
    } else if (e.key === "Enter" || e.key === " ") {
      keyboard = true;
      if (selecting) {
        const sel = selecting;
        selecting = undefined;
        commitRect(sel);
      } else selecting = startSelection(...cursor);
    } else if (e.key === "Escape" && selecting) {
      selecting = undefined;
      render();
    } else if ((e.key === "Delete" || e.key === "Backspace") && keyboard) {
      const rect = game.rectAt(...cursor);
      if (rect) {
        game.remove(rect);
        clearMessages();
        afterMove();
      }
    } else return;
    e.preventDefault();
    if (!selecting) clearPreview();
    renderCursor();
    describeCursor();
  });
  board.addEventListener("blur", () => {
    selecting = undefined;
    clearPreview();
  });

  // --- Azioni ---
  // Anche Annulla può completare la griglia (rimettendo un pezzo tolto): passa da afterMove.
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
      // Troppo presto per un altro pezzo: restano evidenziati indizio e motivo già mostrati.
      notice = `Il prossimo pezzo si può mostrare tra ${secondsLeft(hint.wait)}.`;
      return render();
    }
    clearMessages();
    lastHint = hint;
    explainFrame = 0;
    restartSteps();
    afterMove();
  });
  // La spiegazione scorre i suoi passi da sola, mai durante un trascinamento; un tocco sulla
  // frase passa subito al passo dopo e fa ripartire l'attesa.
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
    clearMessages();
    notice =
      wrong === 0 ? "Finora è tutto giusto." : wrong === 1 ? "C'è un rettangolo sbagliato." : `Ci sono ${wrong} rettangoli sbagliati.`;
    save();
    render();
  });

  // --- Condividere ---
  shareBtn.addEventListener("click", async () => {
    const { rows, cols, clues, blocked } = game.puzzle;
    const url = location.href.split("#")[0] + LINK_PREFIX + encodePuzzle({ rows, cols, clues, blocked, variant: gameVariant });
    // Sul telefono il menu di condivisione, sul computer il link copiato.
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: `Shikaku ${rows}×${cols} · ${difficultyLabel(difficulty)}`, url });
        return;
      } catch {
        // Condivisione annullata o non riuscita: si copia il link.
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
        for (const text of [`${r}×${c} · ${difficultyLabel(d)}${variantSuffix(v)}`, String(rec.wins), recordTime(rec.best), recordTime(rec.bestClean)]) {
          tr.insertCell().textContent = text;
        }
      }
      recordsBody.replaceChildren(table);
    }
    recordsDialog.showModal();
  });
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

  // Il cronometro non si ferma con la scheda nascosta (deciso dall'utente): nascondendola si
  // salva soltanto il tempo trascorso, nel caso il browser chiuda la pagina.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game) save();
  });
  addEventListener("pagehide", () => {
    if (game) save();
  });

  // --- Tutorial: griglie scritte a mano, giocate sulla griglia vera ---
  const showTutorial = (index: number) => {
    const step = TUTORIAL[index]!;
    tutorialStep = index;
    const { rows, cols, clues, blocked } = step;
    startGame(completePuzzle({ rows, cols, clues, blocked })!, step.variant, {
      status: `Come si gioca · ${index + 1} di ${TUTORIAL.length}`,
      // Nel tutorial si impara: nessuna attesa tra un pezzo suggerito e l'altro.
      hintCooldown: 0,
    });
    tutorialStepEl.textContent = `Passo ${index + 1} di ${TUTORIAL.length}`;
    tutorialTitle.textContent = step.title;
    tutorialText.textContent = step.text;
    tutorialDone.hidden = true;
    tutorialPrev.disabled = index === 0;
    tutorialNext.textContent = index === TUTORIAL.length - 1 ? "Gioca" : "Avanti";
    tutorialPanel.hidden = false;
  };

  /** Chiude il pannello del tutorial (senza toccare la partita in gioco). */
  function leaveTutorial() {
    tutorialStep = undefined;
    tutorialPanel.hidden = true;
  }

  /** Esce dal tutorial e torna alla partita salvata, o a una nuova. */
  const exitTutorial = () => {
    leaveTutorial();
    if (!resume()) void newGame();
  };

  tutorialBtn.addEventListener("click", () => {
    // La partita vera si salva col tempo trascorso fin qui, per riprenderla all'uscita.
    if (game && tutorialStep === undefined) save();
    showTutorial(0);
  });
  tutorialPrev.addEventListener("click", () => showTutorial(tutorialStep! - 1));
  tutorialNext.addEventListener("click", () => {
    if (tutorialStep! < TUTORIAL.length - 1) showTutorial(tutorialStep! + 1);
    else exitTutorial();
  });
  tutorialExit.addEventListener("click", exitTutorial);

  /** Riprende la partita salvata; false se non ce n'è una. */
  function resume(): boolean {
    const saved = readStored(GAME_KEY, parseSavedState);
    if (!saved) return false;
    // I menu restano quelli salvati nelle impostazioni, con il livello scelto (non quello misurato).
    syncDifficulties();
    try {
      startGame(saved.puzzle, saved.variant, { saved, note: saved.note });
    } catch {
      // Una partita salvata che supera i controlli ma non si riesce a riprendere: se ne inizia un'altra.
      removeKey(GAME_KEY);
      return false;
    }
    return true;
  }

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
  };

  let linkRequest = 0;

  /**
   * Apre il puzzle del link nell'indirizzo, se c'è ("none" se non c'è, "bad" se rovinato,
   * "stale" se nel frattempo è arrivato un altro link o è iniziata un'altra partita).
   * Soluzione e livello si calcolano nel Worker: un link costruito ad arte non blocca la pagina.
   * L'indirizzo si ripulisce: ricaricando si riprende la partita salvata, non il link da capo.
   */
  const openLink = async (): Promise<"ok" | "bad" | "none" | "stale"> => {
    if (!location.hash.startsWith(LINK_PREFIX)) return "none";
    const code = location.hash.slice(LINK_PREFIX.length);
    try {
      history.replaceState(null, "", location.href.split("#")[0]);
    } catch {
      // Alcuni browser con file://: l'indirizzo resta col link.
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
      leaveTutorial();
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
  // Un link incollato nella scheda già aperta cambia solo la parte dopo "#".
  addEventListener("hashchange", () => {
    void openLink().then((link) => link === "bad" && warnBadLink());
  });

  void openLink().then((link) => {
    if (link === "ok" || link === "stale") {
      // Si gioca il puzzle del link, o quello iniziato nel frattempo.
    } else if (resume()) {
      if (link === "bad") warnBadLink();
    } else {
      void newGame().then(() => link === "bad" && warnBadLink());
    }
  });
}
