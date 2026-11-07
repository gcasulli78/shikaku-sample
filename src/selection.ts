import { type Rect, rectFromCorners } from "./types";

/**
 * The selection while dragging (or moving the keyboard cursor), one axis at a time. The rectangle
 * always contains the starting cell, which doesn't have to be a corner: each side follows the
 * finger as long as the finger is on that side and stays put when it crosses to the other side, so
 * starting from a number in the middle it grows on both sides. Coming back to the starting row (or
 * column) the side being left closes again; if from there it continues to the other side (it was
 * crossing, for example going all the way to the left and then all the way to the right) it reopens
 * up to where the finger had reached.
 */
interface Axis {
  start: number;
  lo: number;
  hi: number;
  /** Where the finger was at the previous step, and on which side of the start: -1, 0, 1. */
  last: number;
  side: number;
  /** The farthest point reached by the finger in the current sweep on that side. */
  reach: number;
  /** The side closed when coming back to the start (up to where it reached), to reopen it when crossing. */
  saved?: number;
}

export interface Selection {
  row: Axis;
  col: Axis;
}

function axis(start: number): Axis {
  return { start, lo: start, hi: start, last: start, side: 0, reach: start };
}

function move(a: Axis, v: number): Axis {
  const side = Math.sign(v - a.start);
  const reach = side !== a.side ? v : side < 0 ? Math.min(a.reach, v) : Math.max(a.reach, v);
  const next: Axis = { ...a, last: v, side, reach };
  if (side === 0) {
    // Back on the start: the side being left closes again.
    if (a.side < 0) next.lo = a.start;
    else if (a.side > 0) next.hi = a.start;
    if (a.side !== 0) next.saved = a.reach;
    return next;
  }
  delete next.saved;
  if (side < 0) next.lo = v;
  else next.hi = v;
  // The opposite side reopens up to where the finger reached, if it is being crossed: passing
  // through the start (saved) or all at once, without passing through it.
  const other = a.side === 0 ? a.saved : a.side === -side ? a.reach : undefined;
  if (other !== undefined && Math.sign(other - a.start) === -side) {
    if (side < 0) next.hi = other;
    else next.lo = other;
  }
  return next;
}

export function startSelection(r: number, c: number): Selection {
  return { row: axis(r), col: axis(c) };
}

/** The cell the selection started from. */
export function selectionStart({ row, col }: Selection): [number, number] {
  return [row.start, col.start];
}

/** Where the finger (or cursor) is now. */
export function selectionAt({ row, col }: Selection): [number, number] {
  return [row.last, col.last];
}

/** The selection with the finger (or cursor) on cell r, c. */
export function moveSelection(sel: Selection, r: number, c: number): Selection {
  const row = move(sel.row, r);
  const col = move(sel.col, c);
  // Stopping on the starting row and moving along it is not a crossing: the closed side stays
  // closed (and the same for columns).
  if (row.side === 0 && c !== sel.col.last) delete row.saved;
  if (col.side === 0 && r !== sel.row.last) delete col.saved;
  return { row, col };
}

export function selectionRect({ row, col }: Selection): Rect {
  return rectFromCorners(row.lo, col.lo, row.hi, col.hi);
}
