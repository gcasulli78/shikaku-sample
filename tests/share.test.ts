import { describe, expect, it } from "vitest";
import { generate } from "../src/generator";
import { recordKey, parseRecordKey, recordWin, type Records } from "../src/records";
import { decodePuzzle, encodePuzzle, LINK_TIME_MS, puzzleFromCode } from "../src/share";

describe("link condivisibile", () => {
  it("codifica e decodifica gli indizi, con forme e aree aperte", () => {
    for (const variant of ["classic", "shapes"] as const) {
      const p = generate({ rows: 15, cols: 15, difficulty: "hard", variant, seed: 3 });
      const code = encodePuzzle({ ...p, variant });
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(code.length).toBeLessThan(400);
      expect(decodePuzzle(code)).toEqual({ rows: 15, cols: 15, clues: p.clues, variant });
    }
  });

  it("Caselle nere: anche le caselle nere nel link", () => {
    const p = generate({ rows: 10, cols: 10, difficulty: "medium", variant: "blocked", seed: 2 });
    const linked = puzzleFromCode(encodePuzzle({ ...p, variant: "blocked" }))!;
    expect(linked.variant).toBe("blocked");
    expect(linked.puzzle.blocked).toEqual(p.blocked);
    expect(linked.puzzle.solution).toEqual(p.solution);
  });

  it("dal codice si ricostruiscono soluzione e livello", () => {
    const p = generate({ rows: 8, cols: 12, difficulty: "expert", variant: "shapes", seed: 5 });
    const linked = puzzleFromCode(encodePuzzle({ ...p, variant: "shapes" }))!;
    expect(linked.variant).toBe("shapes");
    expect(linked.puzzle.solution).toEqual(p.solution);
    expect(linked.puzzle.difficulty).toBe(p.difficulty);
    expect(linked.puzzle.logical).toBe(p.logical);
  });

  it("rifiuta codici rovinati o puzzle senza soluzione unica", () => {
    expect(decodePuzzle("")).toBeUndefined();
    expect(decodePuzzle("!!!")).toBeUndefined();
    const p = generate({ rows: 5, cols: 5, seed: 1 });
    const code = encodePuzzle({ ...p, variant: "classic" });
    expect(decodePuzzle(code.slice(0, -1))).toBeUndefined(); // ultimo indizio troncato
    // Senza il primo indizio le aree non coprono più la griglia.
    expect(puzzleFromCode(encodePuzzle({ ...p, clues: p.clues.slice(1), variant: "classic" }))).toBeUndefined();
    // Un numero più grande della griglia.
    expect(decodePuzzle(encodePuzzle({ rows: 4, cols: 4, clues: [{ r: 0, c: 0, n: 255 }], variant: "classic" }))).toBeUndefined();
  });

  it("un link costruito per far esplodere il solver si rifiuta entro il tempo limite", () => {
    // 12 indizi senza numero su un 15×15: prima teneva il solver occupato 36 s.
    const code = "AQEPD3wBLgBZAJsBvwCYABwBMgBbAD8B0wBFAA";
    expect(decodePuzzle(code)).toBeDefined();
    const start = performance.now();
    expect(puzzleFromCode(code)).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(LINK_TIME_MS + 1000);
  });
});

describe("record", () => {
  it("chiave leggibile e reversibile", () => {
    const key = recordKey({ rows: 8, cols: 15, difficulty: "expert", variant: "shapes" });
    expect(parseRecordKey(key)).toEqual({ rows: 8, cols: 15, difficulty: "expert", variant: "shapes" });
    expect(parseRecordKey("rotto")).toBeUndefined();
    expect(parseRecordKey("8x8:nope:classic")).toBeUndefined();
    expect(parseRecordKey("8x8:medium:zzz")).toBeUndefined();
    expect(parseRecordKey("3000x8:medium:classic")).toBeUndefined();
  });

  it("conta le vittorie e festeggia solo i record battuti", () => {
    const records: Records = {};
    expect(recordWin(records, "k", 60_000, false)).toEqual({ best: false, bestClean: false }); // prima vittoria
    expect(recordWin(records, "k", 70_000, true)).toEqual({ best: false, bestClean: false }); // primo senza aiuti
    expect(recordWin(records, "k", 50_000, false)).toEqual({ best: true, bestClean: false });
    expect(recordWin(records, "k", 40_000, true)).toEqual({ best: true, bestClean: true });
    expect(records.k).toEqual({ wins: 4, best: 40_000, bestClean: 40_000 });
  });
});
