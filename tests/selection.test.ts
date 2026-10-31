import { describe, expect, it } from "vitest";
import { moveSelection, type Selection, selectionRect, startSelection } from "../src/selection";

/** La selezione dopo aver passato il dito sulle caselle date, in ordine. */
function path(start: [number, number], ...cells: [number, number][]): Selection {
  return cells.reduce((sel, [r, c]) => moveSelection(sel, r, c), startSelection(...start));
}

describe("selezione", () => {
  it("da un angolo all'altro, come prima", () => {
    expect(selectionRect(path([0, 0], [1, 1], [2, 3]))).toEqual({ r: 0, c: 0, h: 3, w: 4 });
    expect(selectionRect(path([3, 3], [2, 2], [1, 0]))).toEqual({ r: 1, c: 0, h: 3, w: 4 });
  });

  it("partendo dal numero in mezzo si allarga da entrambi i lati", () => {
    // 2×3 con il 6 in alto al centro: giù a sinistra, poi a destra passando sotto il 6.
    expect(selectionRect(path([0, 1], [1, 1], [1, 0], [1, 1], [1, 2]))).toEqual({ r: 0, c: 0, h: 2, w: 3 });
    // 1×6 con il numero al terzo posto: a sinistra fino in fondo, poi a destra (anche di colpo).
    expect(selectionRect(path([0, 2], [0, 1], [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]))).toEqual({
      r: 0,
      c: 0,
      h: 1,
      w: 6,
    });
    expect(selectionRect(path([0, 2], [0, 0], [0, 5]))).toEqual({ r: 0, c: 0, h: 1, w: 6 });
    expect(selectionRect(path([0, 2], [0, 0], [0, 1], [0, 4]))).toEqual({ r: 0, c: 0, h: 1, w: 5 });
  });

  it("un lato segue il dito finché il dito è da quella parte, anche stringendosi", () => {
    expect(selectionRect(path([0, 2], [0, 0], [0, 4], [0, 3]))).toEqual({ r: 0, c: 0, h: 1, w: 4 });
  });

  it("tornando sulla riga di partenza il lato si richiude", () => {
    // Un 1×3 in orizzontale, con una riga di troppo per sbaglio e poi corretta.
    expect(selectionRect(path([0, 0], [0, 1], [1, 2], [0, 2]))).toEqual({ r: 0, c: 0, h: 1, w: 3 });
    // Fermarsi sulla riga di partenza e muoversi lungo di essa non riapre il lato chiuso.
    expect(selectionRect(path([2, 2], [3, 2], [2, 2], [2, 3], [2, 4], [1, 4]))).toEqual({ r: 1, c: 2, h: 2, w: 3 });
  });
});
