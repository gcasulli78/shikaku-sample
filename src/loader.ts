import { gridArea, gridCell } from "./board";
import { HUES, tint } from "./colors";
import { partition } from "./generator";
import { createRng, randomSeed } from "./rng";

/** Dopo quanti ms d'attesa parte l'animazione: prima niente, per non lampeggiare con i puzzle pronti. */
export const LOADER_DELAY = 250;
/** Quanto dura il riempimento di una griglia nell'animazione, in ms. */
export const LOADER_FILL_MS = 1600;

/**
 * L'attesa di un puzzle (scelta dall'utente tra tre proposte): la griglia vuota della nuova
 * misura si ritaglia da sola, un rettangolo colorato alla volta in ordine sparso, come se
 * qualcuno la risolvesse; piena, svanisce e ricomincia con un altro taglio. I tagli sono
 * casuali (partition, come fa il generatore), non c'entrano con la soluzione. Con "riduci
 * movimento" solo la griglia vuota che pulsa piano (style.css). Restituisce lo stop.
 */
export function startLoader(board: HTMLElement, rows: number, cols: number): () => void {
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
