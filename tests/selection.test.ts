import { describe, expect, it } from "vitest";
import { moveSelection, type Selection, selectionRect, startSelection } from "../src/selection";

/** The selection after moving the finger over the given cells, in order. */
function path(start: [number, number], ...cells: [number, number][]): Selection {
  return cells.reduce((sel, [r, c]) => moveSelection(sel, r, c), startSelection(...start));
}

describe("selezione", () => {
  it("da un angolo all'altro, come prima", () => {
    expect(selectionRect(path([0, 0], [1, 1], [2, 3]))).toEqual({ r: 0, c: 0, h: 3, w: 4 });
    expect(selectionRect(path([3, 3], [2, 2], [1, 0]))).toEqual({ r: 1, c: 0, h: 3, w: 4 });
  });

  it("partendo dal numero in mezzo si allarga da entrambi i lati", () => {
    // 2×3 with the 6 at the top center: down to the left, then to the right passing under the 6.
    expect(selectionRect(path([0, 1], [1, 1], [1, 0], [1, 1], [1, 2]))).toEqual({ r: 0, c: 0, h: 2, w: 3 });
    // 1×6 with the number in third place: left all the way, then right (even all at once).
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
    // A horizontal 1×3, with one row too many by mistake and then corrected.
    expect(selectionRect(path([0, 0], [0, 1], [1, 2], [0, 2]))).toEqual({ r: 0, c: 0, h: 1, w: 3 });
    // Stopping on the starting row and moving along it doesn't reopen the closed side.
    expect(selectionRect(path([2, 2], [3, 2], [2, 2], [2, 3], [2, 4], [1, 4]))).toEqual({ r: 1, c: 2, h: 2, w: 3 });
  });
});
