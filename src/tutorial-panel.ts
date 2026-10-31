/**
 * Il tutorial "Come si gioca": griglie scritte a mano (tutorial.ts), una per regola, giocate
 * sulla griglia vera. Durante il tutorial niente salvataggio, record né riquadro di vittoria
 * (ui.ts lo chiede con active()); uscendo si riprende la partita salvata, o una nuova.
 */
import type { GenerateResult } from "./generator";
import { completePuzzle } from "./share";
import { TUTORIAL } from "./tutorial";
import type { Variant } from "./types";

/** Gli elementi del pannello e quello che il tutorial usa della partita (vedi ui.ts). */
export interface TutorialContext {
  button: HTMLButtonElement;
  panel: HTMLElement;
  stepLabel: HTMLElement;
  title: HTMLElement;
  text: HTMLElement;
  done: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  exit: HTMLButtonElement;
  /** Mette in gioco una griglia del tutorial, con la sua riga di stato. */
  start(puzzle: GenerateResult, variant: Variant, options: { status: string; hintCooldown: number }): void;
  /** Salva la partita vera (col tempo trascorso) prima di entrare, se ce n'è una. */
  saveGame(): void;
  /** All'uscita: la partita salvata, altrimenti una nuova. */
  resumeOrNew(): void;
}

export interface Tutorial {
  /** Si sta giocando una griglia del tutorial. */
  active(): boolean;
  /** Chiude il pannello senza toccare la partita in gioco (nuova partita, link). */
  leave(): void;
  /** La griglia del tutorial è risolta: lo dice nel pannello. */
  solved(): void;
}

export function setupTutorial(ctx: TutorialContext): Tutorial {
  let step: number | undefined;

  const show = (index: number) => {
    const grid = TUTORIAL[index]!;
    step = index;
    const { rows, cols, clues, blocked } = grid;
    ctx.start(completePuzzle({ rows, cols, clues, blocked })!, grid.variant, {
      status: `Come si gioca · ${index + 1} di ${TUTORIAL.length}`,
      // Nel tutorial si impara: nessuna attesa tra un pezzo suggerito e l'altro.
      hintCooldown: 0,
    });
    ctx.stepLabel.textContent = `Passo ${index + 1} di ${TUTORIAL.length}`;
    ctx.title.textContent = grid.title;
    ctx.text.textContent = grid.text;
    ctx.done.hidden = true;
    ctx.prev.disabled = index === 0;
    ctx.next.textContent = index === TUTORIAL.length - 1 ? "Gioca" : "Avanti";
    ctx.panel.hidden = false;
  };

  const leave = () => {
    step = undefined;
    ctx.panel.hidden = true;
  };

  const exit = () => {
    leave();
    ctx.resumeOrNew();
  };

  ctx.button.addEventListener("click", () => {
    // La partita vera si salva col tempo trascorso fin qui, per riprenderla all'uscita.
    if (step === undefined) ctx.saveGame();
    show(0);
  });
  ctx.prev.addEventListener("click", () => show(step! - 1));
  ctx.next.addEventListener("click", () => {
    if (step! < TUTORIAL.length - 1) show(step! + 1);
    else exit();
  });
  ctx.exit.addEventListener("click", exit);

  return {
    active: () => step !== undefined,
    leave,
    solved() {
      const last = step === TUTORIAL.length - 1;
      ctx.done.textContent = last ? "Risolto! Hai visto tutte le regole: buon divertimento." : "Risolto! Passa al prossimo.";
      ctx.done.hidden = false;
    },
  };
}
