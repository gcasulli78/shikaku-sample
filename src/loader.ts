import { gridArea, gridCell } from "./board";
import { HUES, tint } from "./colors";
import { partition } from "./generator";
import { createRng, randomSeed } from "./rng";

/** After how many ms of waiting the animation starts: nothing before, so it doesn't flash with ready puzzles. */
export const LOADER_DELAY = 250;
/** How long filling a grid takes in the animation, in ms. */
export const LOADER_FILL_MS = 1600;

/**
 * Waiting for a puzzle (chosen by the user among three proposals): the empty grid of the new size
 * cuts itself up, one colored rectangle at a time in scattered order, as if someone were solving
 * it; once full, it fades out and starts again with another cut. The cuts are random (partition, as
 * the generator does) and have nothing to do with the solution. With "reduce motion" only the empty
 * grid gently pulsing (style.css). Returns the stop function.
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
    // Scattered order (Fisher–Yates): it looks like someone reasoning, not a printer.
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
      // Hues in steps of 3 out of 8: two consecutive pieces never have the same color.
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
