import { describe, expect, it } from "vitest";
import { Game, type Reason } from "../src/game";
import { generate } from "../src/generator";
import { clueName, explainFrames, HUE_NAMES, hintText, leftText, type Namer, otherName } from "../src/hint-text";
import type { Clue } from "../src/types";

/** Come in ui.ts: il colore dalla posizione nell'elenco degli indizi (qui una tinta fissa a turno). */
function namer(clues: Clue[]): Namer {
  const hues = Object.keys(HUE_NAMES).map(Number);
  return (clue, prep = "") => {
    const i = clues.indexOf(clue);
    const grey = clue.n === undefined && !clue.shape;
    return clueName(clue, prep, i < 0 || grey ? undefined : HUE_NAMES[hues[i % hues.length]!]);
  };
}

describe("clueName", () => {
  it("articolo giusto, apostrofo davanti ai numeri che si leggono con una vocale", () => {
    expect(clueName({ r: 0, c: 0, n: 6 })).toBe("il 6");
    expect(clueName({ r: 0, c: 0, n: 8 })).toBe("l'8");
    expect(clueName({ r: 0, c: 0, n: 11 }, "di")).toBe("dell'11");
    expect(clueName({ r: 0, c: 0, n: 1 }, "a")).toBe("all'1");
    expect(clueName({ r: 0, c: 0, n: 12 }, "di")).toBe("del 12");
    expect(clueName({ r: 0, c: 0, shape: "square" }, "a", "blu")).toBe("all'indizio blu");
    expect(clueName({ r: 0, c: 0 })).toBe("il ?");
  });

  it("col colore e mai con il nome della forma ('il 2 non quadrato' suonava strano)", () => {
    expect(clueName({ r: 0, c: 0, n: 2, shape: "oblong" }, "", "verde")).toBe("il 2 verde");
  });

  it("'l'altro' solo se due indizi si chiamano allo stesso modo", () => {
    const a: Clue = { r: 0, c: 0, n: 6 };
    const b: Clue = { r: 3, c: 3, n: 6 };
    const c: Clue = { r: 5, c: 5, n: 4 };
    const name: Namer = (clue) => clueName(clue, "", "verde");
    expect(otherName(b, a, name)).toBe("l'altro 6 verde");
    expect(otherName(c, a, name)).toBe("il 4 verde");
    expect(otherName(a, a, name)).toBe("il 6 verde");
  });
});

describe("suggerimento limitato", () => {
  it("dice cosa ha fatto e quanti ne restano", () => {
    expect(leftText(2)).toBe("Ne restano 2.");
    expect(leftText(1)).toBe("Ne resta 1.");
    expect(leftText(0)).toBe("Suggerimenti finiti.");
    const name: Namer = (clue) => clueName(clue);
    const rect = { r: 0, c: 0, h: 1, w: 2 };
    expect(hintText({ quiet: true, removed: [], placed: rect, left: 1 }, 0, name)).toBe("Ecco un pezzo. Ne resta 1.");
    expect(hintText({ quiet: true, removed: [rect, rect], left: 0 }, 0, name)).toBe(
      "Tolti 2 rettangoli sbagliati. Suggerimenti finiti.",
    );
  });
});

/** Le spiegazioni dei primi suggerimenti su alcune partite vere, dalla griglia vuota. */
function realReasons(): { reason: Reason; clues: Clue[] }[] {
  const found: { reason: Reason; clues: Clue[] }[] = [];
  for (const variant of ["classic", "shapes"] as const) {
    for (let seed = 1; seed <= 6; seed++) {
      const puzzle = generate({ rows: 8, cols: 8, difficulty: "hard", variant, seed });
      const game = new Game(puzzle, { hintCooldown: 0 });
      // Un minuto tra un clic e l'altro; il secondo grado è la spiegazione.
      for (let k = 0, now = 0; k < 30; k++, now += 60_000) {
        const hint = game.hint(now);
        if (!hint) break;
        if ("explain" in hint) found.push({ reason: hint.explain, clues: puzzle.clues });
      }
    }
  }
  return found;
}

describe("explainFrames su partite vere", () => {
  const reasons = realReasons();

  it("ci sono spiegazioni dirette e a catena da controllare", () => {
    expect(reasons.length).toBeGreaterThan(20);
    expect(reasons.some(({ reason }) => reason.kind === "chain")).toBe(true);
  });

  it("una cosa per passo: si prova la forma, poi i pezzi obbligati uno alla volta, poi il problema, alla fine la conclusione", () => {
    for (const { reason, clues } of reasons) {
      const frames = explainFrames(reason, namer(clues));
      if (reason.kind === "single" || reason.only) {
        expect(frames).toHaveLength(1);
        continue;
      }
      const expected = reason.discards.reduce((n, d) => n + 2 + d.forced.length, 0) + 1;
      expect(frames).toHaveLength(expected);
      let k = 0;
      for (const discard of reason.discards) {
        // La forma provata, da sola.
        expect(frames[k]!.text).toMatch(/Proviamo .+ qui, nel tratteggio\.$/);
        expect(frames[k]!.ghost?.rect).toEqual(discard.rect);
        expect(frames[k]!.chain).toHaveLength(0);
        expect(frames[k]!.problems).toHaveLength(0);
        k++;
        // Un pezzo obbligato per passo; i pezzi si accumulano.
        discard.forced.forEach((f, n) => {
          expect(frames[k]!.text).toMatch(/Allora /);
          expect(frames[k]!.chain).toHaveLength(n + 1);
          expect(frames[k]!.subject).toBe(f.clue);
          expect(frames[k]!.problems).toHaveLength(0);
          k++;
        });
        // Il problema, con tutta la catena ancora visibile.
        expect(frames[k]!.text).toMatch(/Ma così /);
        expect(frames[k]!.chain).toHaveLength(discard.forced.length);
        expect(frames[k]!.problems).toHaveLength(1);
        k++;
      }
      expect(frames[k]!.text).toMatch(/^Quindi |^Nessuna di queste/);
      expect(frames[k]!.ghost).toBeUndefined();
    }
  });

  it("le frasi non usano parole vietate dall'utente né il nome delle forme", () => {
    const banned = [/non quadrato/, /contraddizione/, /dopo qualche passo/, /solo lui/, /casella blu/];
    for (const { reason, clues } of reasons) {
      for (const frame of explainFrames(reason, namer(clues))) {
        for (const word of banned) expect(frame.text).not.toMatch(word);
      }
    }
  });
});
