import type { Rect } from "./types";

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
  /** Il lato richiuso tornando sulla partenza, per riaprirlo se si stava attraversando. */
  saved?: { lo?: number; hi?: number };
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
    if (a.side < 0) next.saved = { lo: a.reach };
    if (a.side > 0) next.saved = { hi: a.reach };
    if (a.side < 0) next.lo = a.start;
    if (a.side > 0) next.hi = a.start;
    return next;
  }
  // Attraversando la partenza il lato richiuso si riapre.
  const crossed = a.side === 0 && a.saved;
  if (side < 0) {
    next.lo = v;
    if (crossed && a.saved!.hi !== undefined) next.hi = a.saved!.hi;
    if (a.side > 0) next.hi = a.reach; // attraversata di colpo, senza passare dalla partenza
  } else {
    next.hi = v;
    if (crossed && a.saved!.lo !== undefined) next.lo = a.saved!.lo;
    if (a.side < 0) next.lo = a.reach;
  }
  delete next.saved;
  return next;
}

export function startSelection(r: number, c: number): Selection {
  return { row: axis(r), col: axis(c) };
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
  return { r: row.lo, c: col.lo, h: row.hi - row.lo + 1, w: col.hi - col.lo + 1 };
}
