import { describe, expect, it } from "vitest";
import { generate } from "../src/generator";
import { recordKey } from "../src/records";
import { DEFAULT_SETTINGS, parsePuzzle, parseReady, parseRecords, parseSavedState, parseSettings } from "../src/stored";

/** Come si rilegge da localStorage: passando per JSON. */
const roundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("valori salvati in localStorage", () => {
  const puzzle = generate({ rows: 8, cols: 8, difficulty: "medium", seed: 4 });
  const blackPuzzle = generate({ rows: 8, cols: 8, difficulty: "medium", variant: "blocked", seed: 4 });
  const state = {
    puzzle,
    variant: "classic",
    game: { rects: puzzle.solution.slice(0, 2), hintsUsed: 1, helped: true, lastPlacedAt: 5000 },
    elapsed: 12_000,
    note: " · da un link",
  };

  it("un puzzle e una partita salvati tornano uguali", () => {
    expect(parsePuzzle(roundTrip(puzzle))).toEqual(puzzle);
    expect(parsePuzzle(roundTrip(blackPuzzle))).toEqual(blackPuzzle);
    expect(parseSavedState(roundTrip(state))).toEqual(state);
  });

  it("scarta puzzle con livello, dimensioni o indizi non validi", () => {
    const bad = [
      { ...puzzle, difficulty: "nope" },
      { ...puzzle, rows: 3000, cols: 3000 },
      { ...puzzle, rows: 8.5 },
      { ...puzzle, clues: 5 },
      { ...puzzle, clues: [] },
      { ...puzzle, clues: [{ r: 0, c: 0, n: 4 }, { r: 0, c: 0, n: 4 }], solution: puzzle.solution.slice(0, 2) },
      { ...puzzle, clues: puzzle.clues.map((cl, i) => (i === 0 ? { ...cl, shape: "<b>" } : cl)) },
      { ...puzzle, clues: puzzle.clues.map((cl, i) => (i === 0 ? { ...cl, n: 1000 } : cl)) },
      { ...puzzle, solution: puzzle.solution.slice(1) },
      { ...puzzle, solution: puzzle.solution.map((r, i) => (i === 0 ? { ...r, w: 99 } : r)) },
      { ...puzzle, blocked: [-1] },
      { ...blackPuzzle, blocked: [blackPuzzle.clues[0]!.r * 8 + blackPuzzle.clues[0]!.c] },
      "<img src=x>",
      null,
    ];
    for (const v of bad) expect(parsePuzzle(roundTrip(v))).toBeUndefined();
  });

  it("scarta partite salvate rotte", () => {
    for (const v of [
      { ...state, variant: "zzz" },
      { ...state, game: { rects: "x", hintsUsed: 0 } },
      { ...state, game: { rects: [{ r: 7, c: 7, h: 2, w: 1 }], hintsUsed: 0 } },
      { ...state, game: { rects: [], hintsUsed: -1 } },
      { ...state, puzzle: undefined },
    ]) {
      expect(parseSavedState(roundTrip(v))).toBeUndefined();
    }
  });

  it("la nota resta testo; un vecchio salvataggio con lo status HTML perde solo la nota", () => {
    const { note: _, ...old } = state;
    const saved = parseSavedState(roundTrip({ ...old, status: '<img src=x onerror="alert(1)">' }))!;
    expect(saved.note).toBe("");
    expect(saved).not.toHaveProperty("status");
    expect(parseSavedState(roundTrip({ ...state, note: "x".repeat(5000) }))!.note).toHaveLength(200);
  });

  it("impostazioni: i campi che non tornano prendono il valore predefinito", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ sizeId: "<b>", custom: { rows: '<img src=x onerror="1">', cols: 40 }, difficulty: "x", variant: 1, theme: "constructor" })).toEqual({
      ...DEFAULT_SETTINGS,
      custom: { rows: 4, cols: 15 },
    });
    expect(parseSettings({ sizeId: "custom", custom: { rows: 9, cols: 12 }, difficulty: "master", variant: "shapes", theme: "dark" })).toEqual({
      sizeId: "custom",
      custom: { rows: 9, cols: 12 },
      difficulty: "master",
      variant: "shapes",
      theme: "dark",
    });
  });

  it("record: si tengono solo le voci con chiave e valori validi", () => {
    const good = recordKey({ rows: 8, cols: 8, difficulty: "medium", variant: "classic" });
    expect(
      parseRecords({
        [good]: { wins: 2, best: 1000, bestClean: "x" },
        "8x8:nope:classic": { wins: 1 },
        "99x8:medium:classic": { wins: 1 },
        "10x10:hard:shapes": { wins: "<img>" },
      }),
    ).toEqual({ [good]: { wins: 2, best: 1000 } });
    expect(parseRecords([1, 2])).toEqual({});
  });

  it("puzzle pronti: griglia e livello devono essere quelli della chiave", () => {
    const key = recordKey({ rows: 8, cols: 8, difficulty: puzzle.difficulty, variant: "classic" });
    const other = recordKey({ rows: 10, cols: 10, difficulty: puzzle.difficulty, variant: "classic" });
    expect(parseReady(roundTrip({ [key]: puzzle, [other]: puzzle, x: puzzle }))).toEqual({ [key]: puzzle });
  });
});
