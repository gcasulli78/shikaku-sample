import { type Rect, rectFromCorners } from "./types";

/**
 * La selezione mentre si trascina (o si muove il cursore da tastiera), un asse alla volta.
 * Il rettangolo contiene sempre la casella di partenza, che non deve per forza essere un
 * angolo: ogni lato segue il dito finché il dito sta da quella parte e resta fermo quando
 * passa dall'altra, così partendo da un numero in mezzo si allarga da entrambi i lati.
 * Tornando sulla riga (o colonna) di partenza il lato da cui si arriva si richiude; se da
 * lì si prosegue dall'altra parte (si stava attraversando, per esempio andando fino in
 * fondo a sinistra e poi tutto a destra) si riapre fin dove il dito era arrivato.
 */
interface Axis {
  start: number;
  lo: number;
  hi: number;
  /** Dov'era il dito al passo precedente, e da che parte della partenza: -1, 0, 1. */
  last: number;
  side: number;
  /** Il punto più lontano raggiunto dal dito nel giro in corso da quella parte. */
  reach: number;
  /** Il lato richiuso tornando sulla partenza (fin dove arrivava), per riaprirlo attraversando. */
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
    // Di nuovo sulla partenza: si richiude il lato da cui si arriva.
    if (a.side < 0) next.lo = a.start;
    else if (a.side > 0) next.hi = a.start;
    if (a.side !== 0) next.saved = a.reach;
    return next;
  }
  delete next.saved;
  if (side < 0) next.lo = v;
  else next.hi = v;
  // Il lato opposto si riapre fin dove arrivava il dito, se lo si sta attraversando:
  // passando dalla partenza (saved) o di colpo, senza passarci.
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

/** La casella da cui è partita la selezione. */
export function selectionStart({ row, col }: Selection): [number, number] {
  return [row.start, col.start];
}

/** Dove sta adesso il dito (o il cursore). */
export function selectionAt({ row, col }: Selection): [number, number] {
  return [row.last, col.last];
}

/** La selezione con il dito (o il cursore) sulla casella r, c. */
export function moveSelection(sel: Selection, r: number, c: number): Selection {
  const row = move(sel.row, r);
  const col = move(sel.col, c);
  // Fermarsi sulla riga di partenza e spostarsi lungo di essa non è un attraversamento:
  // il lato richiuso resta chiuso (e lo stesso per le colonne).
  if (row.side === 0 && c !== sel.col.last) delete row.saved;
  if (col.side === 0 && r !== sel.row.last) delete col.saved;
  return { row, col };
}

export function selectionRect({ row, col }: Selection): Rect {
  return rectFromCorners(row.lo, col.lo, row.hi, col.hi);
}
