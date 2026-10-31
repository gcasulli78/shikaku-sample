import { describe, expect, it } from "vitest";
import { formatTime, Game, HINT_COOLDOWN, Timer } from "../src/game";
import { generate } from "../src/generator";
import type { Puzzle } from "../src/types";

//  2 . .
//  . . 4    soluzione: il 2 verticale a sinistra, il 4 è il 2×2 a destra
const puzzle: Puzzle = {
  rows: 2,
  cols: 3,
  clues: [
    { r: 0, c: 0, n: 2 },
    { r: 1, c: 2, n: 4 },
  ],
  solution: [
    { r: 0, c: 0, h: 2, w: 1 },
    { r: 0, c: 1, h: 2, w: 2 },
  ],
};

describe("Game", () => {
  it("valida i rettangoli", () => {
    const game = new Game(puzzle);
    expect(game.isValid({ r: 0, c: 0, h: 2, w: 1 })).toBe(true);
    expect(game.isValid({ r: 0, c: 0, h: 1, w: 3 })).toBe(false); // area sbagliata
    expect(game.isValid({ r: 0, c: 1, h: 1, w: 2 })).toBe(false); // nessun numero
    expect(game.isValid({ r: 0, c: 0, h: 2, w: 3 })).toBe(false); // due numeri
  });

  it("rifiuta i rettangoli sovrapposti senza toccare quelli esistenti", () => {
    const game = new Game(puzzle);
    expect(game.place({ r: 0, c: 0, h: 1, w: 2 })).toBe(true);
    expect(game.canPlace({ r: 0, c: 0, h: 2, w: 1 })).toBe(false);
    expect(game.place({ r: 0, c: 0, h: 2, w: 1 })).toBe(false);
    expect(game.place({ r: 0, c: 0, h: 1, w: 2 })).toBe(false); // anche identico
    expect(game.placed).toEqual([{ r: 0, c: 0, h: 1, w: 2 }]);
    game.undo(); // il rifiuto non entra nella cronologia
    expect(game.placed).toHaveLength(0);
    expect(game.canUndo).toBe(false);
  });

  it("intent: tap toglie o chiude un 1, trascinamento posa solo se libero", () => {
    const ones: Puzzle = { rows: 1, cols: 3, clues: [{ r: 0, c: 0, n: 1 }, { r: 0, c: 2, n: 2 }], solution: [] };
    const game = new Game(ones);
    expect(game.intent({ r: 0, c: 0, h: 1, w: 1 })).toBe("place"); // c'è il numero 1
    expect(game.intent({ r: 0, c: 1, h: 1, w: 1 })).toBe("none"); // casella libera qualsiasi
    game.place({ r: 0, c: 1, h: 1, w: 2 });
    expect(game.intent({ r: 0, c: 2, h: 1, w: 1 })).toBe("remove");
    expect(game.intent({ r: 0, c: 0, h: 1, w: 2 })).toBe("blocked");
  });

  it("status: valido, sicuramente sbagliato o ancora aperto", () => {
    const game = new Game(puzzle);
    expect(game.status({ r: 0, c: 0, h: 2, w: 1 })).toBe("valid");
    expect(game.status({ r: 0, c: 0, h: 2, w: 3 })).toBe("bad"); // due numeri
    expect(game.status({ r: 0, c: 0, h: 1, w: 3 })).toBe("bad"); // più grande del 2
    expect(game.status({ r: 0, c: 0, h: 1, w: 1 })).toBe("open"); // più piccolo: si può allargare
    expect(game.status({ r: 0, c: 1, h: 1, w: 1 })).toBe("open"); // nessun numero
  });

  it("Forme: validità, errori certi e tap secondo forma e area dell'indizio", () => {
    //  □ . ?      □ = quadrato di area qualsiasi, ▭4 = rettangolo non quadrato di 4
    //  ▭ . .
    const shapes: Puzzle = {
      rows: 2,
      cols: 3,
      clues: [
        { r: 0, c: 0, shape: "square" },
        { r: 0, c: 2 },
        { r: 1, c: 0, n: 4, shape: "oblong" },
      ],
      solution: [],
    };
    const game = new Game(shapes);
    expect(game.isValid({ r: 0, c: 0, h: 1, w: 1 })).toBe(true); // □ 1×1
    expect(game.isValid({ r: 0, c: 0, h: 1, w: 2 })).toBe(false); // □ ma non quadrato
    expect(game.status({ r: 0, c: 0, h: 1, w: 2 })).toBe("open"); // può ancora diventare 2×2
    expect(game.isValid({ r: 1, c: 0, h: 1, w: 3 })).toBe(false); // area 3, non 4
    expect(game.status({ r: 1, c: 0, h: 1, w: 3 })).toBe("open");
    expect(game.status({ r: 0, c: 0, h: 2, w: 2 })).toBe("bad"); // due indizi
    expect(game.isValid({ r: 0, c: 1, h: 2, w: 2 })).toBe(true); // ? accetta tutto
    expect(game.intent({ r: 0, c: 0, h: 1, w: 1 })).toBe("place"); // □ ammette 1×1
    expect(game.intent({ r: 0, c: 2, h: 1, w: 1 })).toBe("place"); // ? ammette 1×1
    expect(game.intent({ r: 1, c: 0, h: 1, w: 1 })).toBe("none"); // ▭4 no
  });

  it("Forme: orientamento sbagliato è un errore certo, e niente 1×1", () => {
    //  ▭6 orizzontale nell'angolo di una griglia 3×6
    const wide6: Puzzle = { rows: 3, cols: 6, clues: [{ r: 0, c: 0, n: 6, shape: "wide" }], solution: [] };
    const game = new Game(wide6);
    expect(game.status({ r: 0, c: 0, h: 2, w: 3 })).toBe("valid");
    expect(game.status({ r: 0, c: 0, h: 1, w: 6 })).toBe("valid");
    expect(game.status({ r: 0, c: 0, h: 3, w: 2 })).toBe("bad"); // verticale
    expect(game.status({ r: 0, c: 0, h: 2, w: 2 })).toBe("open"); // può ancora allargarsi
    expect(game.intent({ r: 0, c: 0, h: 1, w: 1 })).toBe("none");
    const tall: Puzzle = { rows: 3, cols: 3, clues: [{ r: 0, c: 0, shape: "tall" }], solution: [] };
    expect(new Game(tall).isValid({ r: 0, c: 0, h: 3, w: 1 })).toBe(true);
    expect(new Game(tall).isValid({ r: 0, c: 0, h: 1, w: 3 })).toBe(false);
  });

  it("Forme: area giusta ma forma sbagliata è un errore certo", () => {
    const square4: Puzzle = { rows: 2, cols: 4, clues: [{ r: 0, c: 0, n: 4, shape: "square" }], solution: [] };
    expect(new Game(square4).status({ r: 0, c: 0, h: 1, w: 4 })).toBe("bad");
    expect(new Game(square4).status({ r: 0, c: 0, h: 2, w: 2 })).toBe("valid");
  });

  it("dopo aver tolto un rettangolo lo spazio torna libero", () => {
    const game = new Game(puzzle);
    game.place({ r: 0, c: 0, h: 1, w: 2 });
    game.remove({ r: 0, c: 0, h: 1, w: 2 });
    expect(game.place({ r: 0, c: 0, h: 2, w: 1 })).toBe(true);
    expect(game.placed).toEqual([{ r: 0, c: 0, h: 2, w: 1 }]);
  });

  it("annulla anche dopo cancella", () => {
    const game = new Game(puzzle);
    game.place({ r: 0, c: 0, h: 2, w: 1 });
    game.place({ r: 0, c: 1, h: 1, w: 2 });
    game.clear();
    expect(game.placed).toHaveLength(0);
    game.undo();
    expect(game.placed).toHaveLength(2);
    game.undo();
    expect(game.placed).toEqual([{ r: 0, c: 0, h: 2, w: 1 }]);
    game.undo();
    expect(game.placed).toHaveLength(0);
    expect(game.canUndo).toBe(false);
  });

  it("il suggerimento toglie prima tutti i rettangoli sbagliati, senza posarne, e spiega il primo", () => {
    const game = new Game(puzzle);
    game.place({ r: 0, c: 0, h: 2, w: 1 }); // giusto
    game.place({ r: 0, c: 1, h: 1, w: 1 }); // sbagliato
    game.place({ r: 1, c: 1, h: 1, w: 2 }); // sbagliato
    expect(game.hint(0)).toEqual({
      removed: [
        { r: 0, c: 1, h: 1, w: 1 },
        { r: 1, c: 1, h: 1, w: 2 },
      ],
      wrong: { rect: { r: 0, c: 1, h: 1, w: 1 }, why: { kind: "empty" } },
    });
    expect(game.placed).toEqual([{ r: 0, c: 0, h: 2, w: 1 }]);
    expect(game.hintsUsed).toBe(1);
    game.undo(); // Annulla rimette i rettangoli tolti dal suggerimento
    expect(game.placed).toHaveLength(3);
  });

  describe("rettangolo sbagliato senza motivo visibile: il suggerimento mostra il pezzo giusto", () => {
    //  2 . . .
    //  . 6 . .     il 4 in colonna non toglie subito spazio a nessuno: sbagliato solo
    //  2 . . 4     seguendo altri passi. Soluzione del 4: il 2×2 in basso a destra.
    //  2 . . .
    const misplaced: Puzzle = {
      rows: 4,
      cols: 4,
      clues: [
        { r: 0, c: 0, n: 2 },
        { r: 1, c: 1, n: 6 },
        { r: 2, c: 0, n: 2 },
        { r: 2, c: 3, n: 4 },
        { r: 3, c: 0, n: 2 },
      ],
      solution: [
        { r: 0, c: 0, h: 2, w: 1 },
        { r: 0, c: 1, h: 2, w: 3 },
        { r: 2, c: 0, h: 1, w: 2 },
        { r: 2, c: 2, h: 2, w: 2 },
        { r: 3, c: 0, h: 1, w: 2 },
      ],
    };
    const column = { r: 0, c: 3, h: 4, w: 1 };
    const four = { r: 2, c: 2, h: 2, w: 2 };
    const why = { kind: "misplaced", clue: { r: 2, c: 3, n: 4 } };

    it("toglie il rettangolo e posa quello giusto", () => {
      const game = new Game(misplaced);
      game.place(column);
      expect(game.whyWrong(column)).toEqual(why);
      expect(game.hint(0)).toEqual({ removed: [column], wrong: { rect: column, why }, placed: four });
      expect(game.placed).toEqual([four]);
    });

    it("durante l'attesa lo posa al suggerimento dopo", () => {
      const game = new Game(misplaced);
      game.hint(0);
      game.hint(0);
      expect(game.hint(0)).toMatchObject({ placed: {} }); // un pezzo suggerito: parte l'attesa
      game.undo(); // l'attesa resta, la griglia torna vuota
      game.place(column);
      expect(game.hint(1000)).toEqual({ removed: [column], wrong: { rect: column, why } });
      expect(game.hintStage).toBe(2);
      expect(game.hint(2000)).toEqual({ wait: HINT_COOLDOWN - 2000 });
      expect(game.hint(HINT_COOLDOWN)).toEqual({ placed: four, fix: why.clue });
    });
  });

  it("perché un rettangolo è sbagliato", () => {
    const game = new Game(puzzle);
    expect(game.whyWrong({ r: 0, c: 1, h: 1, w: 1 })).toEqual({ kind: "empty" });
    expect(game.whyWrong({ r: 0, c: 0, h: 2, w: 3 })).toEqual({ kind: "many", count: 2 });
    expect(game.whyWrong({ r: 0, c: 0, h: 1, w: 3 })).toEqual({ kind: "area", clue: { r: 0, c: 0, n: 2 } });
    // Il 2 in orizzontale rispetta l'indizio, ma il 4 non ha più spazio.
    expect(game.whyWrong({ r: 0, c: 0, h: 1, w: 2 })).toEqual({ kind: "starved", clue: { r: 1, c: 2, n: 4 } });
    //  ? . 1     il ? in un 1×1 lascia scoperta la casella in mezzo
    const open = new Game({
      rows: 1,
      cols: 3,
      clues: [{ r: 0, c: 0 }, { r: 0, c: 2, n: 1 }],
      solution: [
        { r: 0, c: 0, h: 1, w: 2 },
        { r: 0, c: 2, h: 1, w: 1 },
      ],
    });
    expect(open.whyWrong({ r: 0, c: 0, h: 1, w: 1 })).toEqual({ kind: "uncovered", cell: { r: 0, c: 1 } });
    const square = new Game({ rows: 1, cols: 2, clues: [{ r: 0, c: 0, shape: "square" }], solution: [] });
    expect(square.whyWrong({ r: 0, c: 0, h: 1, w: 2 })).toEqual({ kind: "shape", clue: { r: 0, c: 0, shape: "square" } });
  });

  it("senza errori il suggerimento procede a gradi: indizio, motivo, pezzo", () => {
    const game = new Game(puzzle);
    game.place({ r: 0, c: 0, h: 1, w: 3 }); // sbagliato, copre entrambe le soluzioni
    expect(game.hint(0)).toMatchObject({ removed: [{ r: 0, c: 0, h: 1, w: 3 }] });
    expect(game.placed).toHaveLength(0);
    // Prima il 4, anche se nella soluzione viene dopo: in 2×3 può essere solo il 2×2.
    const reason = { kind: "single", clue: { r: 1, c: 2, n: 4 }, discards: [] };
    expect(game.hint(0)).toEqual({ focus: reason });
    expect(game.hintStage).toBe(1);
    expect(game.hint(0)).toEqual({ explain: reason });
    expect(game.hintStage).toBe(2);
    expect(game.placed).toHaveLength(0);
    expect(game.hint(0)).toEqual({ placed: { r: 0, c: 1, h: 2, w: 2 }, reason });
    expect(game.hintStage).toBe(0);
    expect(game.hintsUsed).toBe(2); // l'errore tolto e il pezzo posato
    // Una mossa azzera i gradi.
    expect(game.hint(0)).toMatchObject({ focus: { clue: { r: 0, c: 0, n: 2 } } });
    game.undo();
    expect(game.hintStage).toBe(0);
  });

  it("tra due pezzi suggeriti servono 15 s; indizio e motivo restano sempre disponibili", () => {
    const game = new Game(puzzle);
    expect(game.hint(0)).toMatchObject({ focus: {} });
    expect(game.hint(0)).toMatchObject({ explain: {} });
    expect(game.hint(1000)).toMatchObject({ placed: { r: 0, c: 1, h: 2, w: 2 } });
    expect(game.cooldown(1000)).toBe(HINT_COOLDOWN);
    expect(game.hint(2000)).toMatchObject({ focus: {} });
    expect(game.hint(3000)).toMatchObject({ explain: {} });
    expect(game.hint(10_000)).toEqual({ wait: 6000 });
    expect(game.placed).toHaveLength(1);
    // L'attesa sopravvive al salvataggio.
    const resumed = Game.restore(puzzle, JSON.parse(JSON.stringify(game.snapshot())));
    expect(resumed.cooldown(10_000)).toBe(6000);
    expect(game.hint(16_000)).toMatchObject({ placed: { r: 0, c: 0, h: 2, w: 1 } });
    // Senza attesa (tutorial).
    const tutorial = new Game(puzzle, { hintCooldown: 0 });
    for (let i = 0; i < 6; i++) tutorial.hint(0);
    expect(tutorial.isSolved()).toBe(true);
  });

  it("verifica: quanti errori, senza dire quali; conta come aiuto", () => {
    const game = new Game(puzzle);
    expect(game.helped).toBe(false);
    game.place({ r: 0, c: 0, h: 2, w: 1 });
    expect(game.check()).toBe(0);
    game.place({ r: 0, c: 1, h: 1, w: 2 });
    expect(game.check()).toBe(1);
    expect(game.placed).toHaveLength(2);
    expect(game.helped).toBe(true);
    expect(game.hintsUsed).toBe(0);
  });

  it("una partita salvata riprende rettangoli e aiuti, senza sovrapposizioni", () => {
    const game = new Game(puzzle);
    game.place({ r: 0, c: 0, h: 2, w: 1 });
    while (game.placed.length < 2) game.hint(0);
    const saved = JSON.parse(JSON.stringify(game.snapshot()));
    const resumed = Game.restore(puzzle, saved);
    expect(resumed.placed).toEqual(game.placed);
    expect(resumed.hintsUsed).toBe(1);
    expect(resumed.helped).toBe(true);
    expect(resumed.isSolved()).toBe(true);
    const broken = Game.restore(puzzle, { rects: [{ r: 0, c: 0, h: 1, w: 2 }, { r: 0, c: 1, h: 2, w: 1 }], hintsUsed: 0 });
    expect(broken.placed).toEqual([{ r: 0, c: 0, h: 1, w: 2 }]);
    expect(broken.helped).toBe(false);
  });

  it("caselle nere: non si coprono e non servono per vincere", () => {
    //  4 . 1
    //  . . #
    const game = new Game({
      rows: 2,
      cols: 3,
      clues: [
        { r: 0, c: 0, n: 4 },
        { r: 0, c: 2, n: 1 },
      ],
      blocked: [5],
      solution: [
        { r: 0, c: 0, h: 2, w: 2 },
        { r: 0, c: 2, h: 1, w: 1 },
      ],
    });
    expect(game.isBlocked(1, 2)).toBe(true);
    expect(game.intent({ r: 0, c: 1, h: 2, w: 2 })).toBe("blocked");
    expect(game.place({ r: 0, c: 0, h: 2, w: 2 })).toBe(true);
    expect(game.intent({ r: 0, c: 2, h: 1, w: 1 })).toBe("place");
    game.place({ r: 0, c: 2, h: 1, w: 1 });
    expect(game.isSolved()).toBe(true);
  });

  it("vittoria solo con griglia completa e corretta", () => {
    const game = new Game(puzzle);
    expect(game.isSolved()).toBe(false);
    game.place({ r: 0, c: 0, h: 2, w: 1 });
    expect(game.isSolved()).toBe(false);
    game.place({ r: 0, c: 1, h: 1, w: 2 }); // copre parte, area 2 senza numero
    game.place({ r: 1, c: 1, h: 1, w: 2 });
    expect(game.isSolved()).toBe(false);
    game.remove({ r: 0, c: 1, h: 1, w: 2 });
    game.remove({ r: 1, c: 1, h: 1, w: 2 });
    game.place({ r: 0, c: 1, h: 2, w: 2 });
    expect(game.isSolved()).toBe(true);
  });

  it("risolvere a suon di suggerimenti vince sempre, ogni volta per deduzione", () => {
    for (const variant of ["classic", "shapes"] as const) {
      const game = new Game(generate({ rows: 10, cols: 10, seed: 7, variant }));
      // Un minuto tra un clic e l'altro: l'attesa tra due pezzi non scatta mai.
      let now = 0;
      for (let hint = game.hint(now); hint; hint = game.hint((now += 60_000))) {
        expect("wait" in hint, variant).toBe(false);
        expect("placed" in hint && !("removed" in hint) ? hint.reason : true, variant).toBeTruthy();
      }
      expect(game.isSolved()).toBe(true);
    }
  });

  it("senza deduzioni possibili il suggerimento posa un pezzo della soluzione, senza motivo", () => {
    //  2 .      ambiguo: il 2 in orizzontale o in verticale
    //  . 2
    const ambiguous: Puzzle = {
      rows: 2,
      cols: 2,
      clues: [
        { r: 0, c: 0, n: 2 },
        { r: 1, c: 1, n: 2 },
      ],
      solution: [
        { r: 0, c: 0, h: 1, w: 2 },
        { r: 1, c: 0, h: 1, w: 2 },
      ],
    };
    expect(new Game(ambiguous).hint(0)).toEqual({ placed: { r: 0, c: 0, h: 1, w: 2 } });
  });

  describe("suggerimento limitato (Maestro, Forme Esperto)", () => {
    it("senza gradi né attesa: toglie gli errori o posa un pezzo, al massimo hintLimit volte", () => {
      const game = new Game(puzzle, { hintLimit: 2 });
      expect(game.hintsLeft).toBe(2);
      game.place({ r: 0, c: 1, h: 1, w: 2 }); // sbagliato
      expect(game.hint(0)).toEqual({ quiet: true, removed: [{ r: 0, c: 1, h: 1, w: 2 }], left: 1 });
      expect(game.placed).toHaveLength(0);
      // Subito un pezzo, senza indizio da guardare né motivo, e senza attesa.
      const second = game.hint(0);
      expect(second).toMatchObject({ quiet: true, removed: [], left: 0 });
      expect(game.placed).toHaveLength(1);
      expect(puzzle.solution).toContainEqual(game.placed[0]);
      expect(game.hint(1)).toBeUndefined();
      expect(game.placed).toHaveLength(1);
      expect(game.helped).toBe(true);
    });

    it("il conto sopravvive al salvataggio", () => {
      const game = new Game(puzzle, { hintLimit: 2 });
      game.hint(0);
      expect(Game.restore(puzzle, game.snapshot(), { hintLimit: 2 }).hintsLeft).toBe(1);
    });

    it("senza limite il suggerimento resta a gradi", () => {
      expect(new Game(puzzle).hintsLeft).toBeUndefined();
    });
  });
});

describe("Timer", () => {
  it("conta solo il tempo non in pausa", () => {
    let now = 0;
    const timer = new Timer(() => now);
    timer.start();
    now = 5000;
    timer.pause();
    now = 9000;
    expect(timer.elapsed()).toBe(5000);
    timer.start();
    now = 12000;
    expect(timer.elapsed()).toBe(8000);
    timer.reset();
    expect(timer.elapsed()).toBe(0);
    expect(timer.running).toBe(false);
    timer.reset(42_000); // partita ripresa
    expect(timer.elapsed()).toBe(42_000);
    timer.start();
    now = 15000;
    expect(timer.elapsed()).toBe(45_000);
  });

  it("formatta mm:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65_400)).toBe("1:05");
  });
});
