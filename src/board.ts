/** Placing elements on the game's CSS grid. */
import type { Rect } from "./types";

/** A grid cell (the dashed lines), without the outer border. */
export function gridCell(r: number, c: number, rows: number, cols: number): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "cell";
  if (c === cols - 1) cell.classList.add("last-col");
  if (r === rows - 1) cell.classList.add("last-row");
  cell.style.gridArea = `${r + 1} / ${c + 1}`;
  return cell;
}

export function gridArea(el: HTMLElement, rect: Rect): void {
  el.style.gridArea = `${rect.r + 1} / ${rect.c + 1} / span ${rect.h} / span ${rect.w}`;
}

export function cellArea(el: HTMLElement, r: number, c: number): void {
  gridArea(el, { r, c, h: 1, w: 1 });
}
