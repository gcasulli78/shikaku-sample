import { describe, expect, it } from "vitest";
import { generate } from "../src/generator";
import { type Deduction, type DeductionKind, grade, nextDeduction } from "../src/grader";
import { candidatesFor, clueIndexMap, type SolveInput } from "../src/solver";
import { availableDifficulties, type Clue, contains, type Difficulty, type Rect, sameRect, type Variant } from "../src/types";

/** Hand-written grid: digits = numbers, "." = empty cell. */
function parse(lines: string[]): { rows: number; cols: number; clues: Clue[] } {
  const clues: Clue[] = [];
  lines.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch !== ".") clues.push({ r, c, n: parseInt(ch, 36) });
    });
  });
  return { rows: lines.length, cols: lines[0]!.length, clues };
}

describe("grade", () => {
  it("forme uniche → Facile", () => {
    // The 2 can't go down (the 4 is there), so it goes right; then the 4 is forced.
    const g = grade(parse(["2.", "4.", ".."]));
    expect(g.solved).toBe(true);
    expect(g.difficulty).toBe("easy");
    expect(g.placed).toEqual([
      { r: 0, c: 0, h: 1, w: 2 },
      { r: 1, c: 0, h: 2, w: 2 },
    ]);
  });

  it("puzzle ambiguo: non risolto", () => {
    expect(grade(parse(["2.", ".2"])).solved).toBe(false);
  });

  it("non posa mai forme diverse dalla soluzione (puzzle generati)", () => {
    for (const difficulty of ["easy", "medium", "hard"] as Difficulty[]) {
      for (let seed = 1; seed <= 15; seed++) {
        const p = generate({ rows: 8, cols: 8, difficulty, seed });
        const g = grade(p);
        expect(g.solved, `${difficulty} seed ${seed}`).toBe(true);
        g.placed.forEach((rect, i) => {
          expect(sameRect(rect!, p.solution[i]!)).toBe(true);
        });
      }
    }
  });

  it("non posa mai forme diverse dalla soluzione (variante Forme)", () => {
    for (const difficulty of ["easy", "hard", "expert"] as Difficulty[]) {
      for (let seed = 1; seed <= 5; seed++) {
        const p = generate({ rows: 8, cols: 8, difficulty, variant: "shapes", seed });
        const g = grade(p);
        expect(g.solved, `${difficulty} seed ${seed}`).toBe(true);
        g.placed.forEach((rect, i) => {
          expect(sameRect(rect!, p.solution[i]!)).toBe(true);
        });
      }
    }
  });

  it("Maestro: corretto, e con le sole regole fino a Esperto non si chiude", () => {
    for (let seed = 1; seed <= 2; seed++) {
      const p = generate({ rows: 8, cols: 8, difficulty: "master", seed, maxCandidates: 1000 });
      const g = grade(p);
      expect(g.difficulty, `seed ${seed}`).toBe("master");
      g.placed.forEach((rect, i) => {
        expect(sameRect(rect!, p.solution[i]!)).toBe(true);
      });
      expect(grade(p, 3).solved, `seed ${seed}`).toBe(false);
    }
  }, 120_000);
});

/** The cells of a rectangle (r * cols + c). */
function cellsOf(rect: Rect, cols: number): number[] {
  return Array.from({ length: rect.h * rect.w }, (_, k) => (rect.r + Math.floor(k / rect.w)) * cols + rect.c + (k % rect.w));
}

/**
 * The explanation re-checked from scratch with only the possible shapes (candidatesFor), without
 * the grader: the discarded shapes are all the other ones of the clue, every piece of the chain is
 * really forced (see Discard), and the problem really exists. That's what the player must be able
 * to verify by looking at the grid. undefined if everything checks out.
 */
function explanationHolds(input: SolveInput, given: readonly Rect[], d: Deduction): string | undefined {
  const clueAt = clueIndexMap(input);
  const all = input.clues.map((_, i) => candidatesFor(input, i, clueAt));
  const owner = (rect: Rect) => input.clues.findIndex((cl) => contains(rect, cl.r, cl.c));
  const view = (pieces: { clue: number; rect: Rect }[]) => {
    const taken = new Set(pieces.flatMap((p) => cellsOf(p.rect, input.cols)));
    const done = new Set(pieces.map((p) => p.clue));
    const avail = (i: number) => all[i]!.filter((cand) => !cand.cells.some((idx) => taken.has(idx)));
    const open = input.clues.flatMap((_, i) => (done.has(i) ? [] : [i]));
    return { taken, done, avail, open };
  };
  const base = given.map((rect) => ({ clue: owner(rect), rect }));
  const visible = view(base)
    .avail(d.clue)
    .map((cand) => cand.rect);
  const shown = [d.rect, ...d.discards.map((dis) => dis.rect)];
  if (visible.length !== shown.length || !visible.every((rect) => shown.some((other) => sameRect(rect, other))))
    return "forme diverse";
  if (d.kind === "single") return d.discards.length === 0 ? undefined : "single con forme scartate";
  for (const dis of d.discards) {
    const pieces = [...base, { clue: d.clue, rect: dis.rect }];
    for (const f of dis.forced) {
      const now = view(pieces);
      if (now.done.has(f.clue)) return "catena su un indizio già posato";
      // Forced: a single shape, or the only one reaching cell f.cell, in a single way.
      const ways = f.cell === undefined ? now.avail(f.clue) : now.avail(f.clue).filter((cand) => cand.cells.includes(f.cell!));
      if (
        f.cell !== undefined &&
        (now.taken.has(f.cell) || now.open.some((j) => j !== f.clue && now.avail(j).some((cand) => cand.cells.includes(f.cell!))))
      ) {
        return "casella della catena non solo sua";
      }
      if (ways.length !== 1 || !sameRect(ways[0]!.rect, f.rect)) return "catena non obbligata";
      pieces.push(f);
    }
    const end = view(pieces);
    const { problem } = dis;
    if ("clue" in problem) {
      if (end.done.has(problem.clue) || end.avail(problem.clue).length > 0) return "indizio non senza spazio";
    } else if (
      end.taken.has(problem.cell) ||
      (input.blocked ?? []).includes(problem.cell) ||
      end.open.some((i) => end.avail(i).some((cand) => cand.cells.includes(problem.cell)))
    ) {
      return "casella coperta";
    }
  }
  if (d.only !== undefined) {
    const now = view(base);
    if (now.open.some((i) => i !== d.clue && now.avail(i).some((cand) => cand.cells.includes(d.only!))))
      return "casella non solo sua";
    if (!cellsOf(d.rect, input.cols).includes(d.only)) return "casella fuori dal pezzo";
  }
  return undefined;
}

describe("nextDeduction", () => {
  it("forma unica", () => {
    // The 2 can't go down (the 4 is there): it has a single shape right from the start.
    expect(nextDeduction(parse(["2.", "4.", ".."]), [])).toEqual({
      clue: 0,
      rect: { r: 0, c: 0, h: 1, w: 2 },
      kind: "single",
      discards: [],
    });
  });

  it("riparte dai pezzi già posati", () => {
    const input = parse(["2.", "4.", ".."]);
    expect(nextDeduction(input, [{ r: 0, c: 0, h: 1, w: 2 }])).toMatchObject({ clue: 1, rect: { r: 1, c: 0, h: 2, w: 2 } });
    expect(
      nextDeduction(input, [
        { r: 0, c: 0, h: 1, w: 2 },
        { r: 1, c: 0, h: 2, w: 2 },
      ]),
    ).toBeUndefined();
  });

  it("casella che raggiunge un solo indizio: basta mostrare quella", () => {
    // The second cell at the top is reached only by the 6, and only with the 2×3 at the top right.
    const input = parse(["...6", "2...", ".4.."]);
    const d = nextDeduction(input, [])!;
    expect(d).toMatchObject({ clue: 0, rect: { r: 0, c: 1, h: 2, w: 3 }, kind: "direct", only: 1 });
    expect(explanationHolds(input, [], d)).toBeUndefined();
  });

  it("ogni forma scartata con il suo problema", () => {
    // The 4 at r1 c1: the other shapes leave a cell uncovered or a number without room.
    const input = parse(["...4", ".4..", "..2.", "3..3"]);
    const d = nextDeduction(input, [])!;
    expect(d).toMatchObject({ rect: { r: 1, c: 0, h: 2, w: 2 }, kind: "direct" });
    expect(d.discards.length).toBeGreaterThan(1);
    expect(explanationHolds(input, [], d)).toBeUndefined();
  });

  it("preferisce l'indizio vicino all'ultima mossa", () => {
    // Four numbers with a single shape, two at the top and two at the bottom: the closest wins.
    const input = parse(["2.", "4.", "..", "..", "4.", "2."]);
    expect(nextDeduction(input, [])?.clue).toBe(0);
    expect(nextDeduction(input, [], { r: 5, c: 1, h: 1, w: 1 })?.clue).toBe(3);
  });

  it("i puzzle segnalati: spiegazioni che si verificano sulla griglia", () => {
    // 8×8 Shapes, 9 already placed. Before: "le caselle che il 7 copre comunque tolgono spazio al
    // 2", but the 7 (1×7 or 7×1) was vertical only because of an unstated step.
    const first = {
      rows: 8,
      cols: 8,
      clues: [
        { r: 0, c: 2, shape: "oblong" as const },
        { r: 0, c: 6, n: 2 },
        { r: 1, c: 0, n: 9, shape: "square" as const },
        { r: 1, c: 4, n: 12 },
        { r: 4, c: 7, n: 7 },
        { r: 5, c: 2, n: 12, shape: "oblong" as const },
        { r: 5, c: 6, shape: "oblong" as const },
        { r: 6, c: 5, n: 2 },
        { r: 6, c: 6, n: 2, shape: "oblong" as const },
        { r: 7, c: 3, n: 6, shape: "oblong" as const },
      ],
    };
    // 8×8 Shapes, 15 already placed. Before: "solo il 6 non quadrato può coprire la casella" r0 c0,
    // but the other 6 covered it too, with a 6×1 strip ruled out by an unstated step.
    const second = {
      rows: 8,
      cols: 8,
      clues: [
        { r: 0, c: 1, n: 6, shape: "oblong" as const },
        { r: 0, c: 5, n: 15 },
        { r: 2, c: 0, n: 6 },
        { r: 3, c: 7 },
        { r: 5, c: 2, n: 3 },
        { r: 6, c: 1, shape: "oblong" as const },
        { r: 6, c: 3, n: 2, shape: "oblong" as const },
        { r: 6, c: 5, shape: "oblong" as const },
        { r: 7, c: 3, n: 5, shape: "oblong" as const },
        { r: 7, c: 7, n: 2, shape: "oblong" as const },
      ],
    };
    // The 2 horizontal? Then the 7 could only be horizontal, and the non-square 12 would be left
    // without room: the step on the 7 is now visible, drawn.
    const given = [{ r: 1, c: 0, h: 3, w: 3 }];
    const d = nextDeduction(first, given)!;
    expect(d).toMatchObject({ clue: 8, rect: { r: 6, c: 6, h: 2, w: 1 }, kind: "chain" });
    expect(d.discards[0]!.forced).toEqual([{ clue: 4, rect: { r: 4, c: 1, h: 1, w: 7 } }]);
    expect(explanationHolds(first, given, d)).toBeUndefined();
    // Here no number can be deduced with chains of forced pieces (not even 8 long): the hint places
    // a piece instead of a sentence that can't be verified.
    expect(nextDeduction(second, [{ r: 0, c: 3, h: 3, w: 5 }])).toBeUndefined();
  });

  it("ogni spiegazione si verifica sulla griglia (puzzle generati)", () => {
    const seen = new Set<DeductionKind>();
    const cases: [number, Difficulty, Variant][] = [
      [8, "easy", "classic"],
      [8, "hard", "classic"],
      [8, "expert", "classic"],
      [8, "master", "blocked"],
      [8, "hard", "shapes"],
      [8, "expert", "shapes"],
    ];
    for (const [size, difficulty, variant] of cases) {
      for (let seed = 1; seed <= 3; seed++) {
        const p = generate({ rows: size, cols: size, difficulty, variant, seed });
        const given: Rect[] = [];
        while (given.length < p.solution.length) {
          const d = nextDeduction(p, given, given[given.length - 1]);
          const label = `${difficulty} ${variant} seed ${seed}`;
          if (!d) {
            // No visible deduction: the hint places a piece of the solution.
            given.push(p.solution.find((sol) => !given.some((g) => sameRect(g, sol)))!);
            continue;
          }
          expect(
            p.solution.some((sol) => sameRect(sol, d.rect)),
            label,
          ).toBe(true);
          expect(explanationHolds(p, given, d), label).toBeUndefined();
          seen.add(d.kind);
          given.push(d.rect);
        }
      }
    }
    expect([...seen].sort()).toEqual(["chain", "direct", "single"]);
  }, 120_000);
});

describe("availableDifficulties", () => {
  it("Esperto da 7, Maestro da 8 (lato minore)", () => {
    expect(availableDifficulties({ rows: 6, cols: 15 })).toEqual(["easy", "medium", "hard"]);
    expect(availableDifficulties({ rows: 7, cols: 7 })).toEqual(["easy", "medium", "hard", "expert"]);
    expect(availableDifficulties({ rows: 15, cols: 8 })).toEqual(["easy", "medium", "hard", "expert", "master"]);
  });
});
