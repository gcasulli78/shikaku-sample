import { describe, expect, it } from "vitest";
import { formatTime, Game, Timer } from "../src/game";
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

  it("il suggerimento toglie prima tutti i rettangoli sbagliati, senza posarne", () => {
    const game = new Game(puzzle);
    game.place({ r: 0, c: 0, h: 2, w: 1 }); // giusto
    game.place({ r: 0, c: 1, h: 1, w: 1 }); // sbagliato
    game.place({ r: 1, c: 1, h: 1, w: 2 }); // sbagliato
    expect(game.hint()).toEqual({
      removed: [
        { r: 0, c: 1, h: 1, w: 1 },
        { r: 1, c: 1, h: 1, w: 2 },
      ],
    });
    expect(game.placed).toEqual([{ r: 0, c: 0, h: 2, w: 1 }]);
    expect(game.hintsUsed).toBe(1);
    game.undo(); // Annulla rimette i rettangoli tolti dal suggerimento
    expect(game.placed).toHaveLength(3);
  });

  it("senza errori il suggerimento posa un pezzo della soluzione", () => {
    const game = new Game(puzzle);
    game.place({ r: 0, c: 0, h: 1, w: 3 }); // sbagliato, copre entrambe le soluzioni
    expect(game.hint()).toEqual({ removed: [{ r: 0, c: 0, h: 1, w: 3 }] });
    expect(game.placed).toHaveLength(0);
    expect(game.hint()).toEqual({ placed: { r: 0, c: 0, h: 2, w: 1 } });
    expect(game.hint()).toEqual({ placed: { r: 0, c: 1, h: 2, w: 2 } });
    expect(game.hintsUsed).toBe(3);
    expect(game.hint()).toBeUndefined();
    expect(game.hintsUsed).toBe(3);
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

  it("risolvere a suon di suggerimenti vince sempre", () => {
    const game = new Game(generate({ rows: 10, cols: 10, seed: 7 }));
    while (game.hint());
    expect(game.isSolved()).toBe(true);
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
  });

  it("formatta mm:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65_400)).toBe("1:05");
  });
});
