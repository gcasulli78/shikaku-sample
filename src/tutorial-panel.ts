/**
 * The "Come si gioca" tutorial: hand-written grids (tutorial.ts), one per rule, played on the real
 * grid. During the tutorial no saving, records or win panel (ui.ts asks with active()); on exit the
 * saved game is resumed, or a new one starts.
 */
import type { GenerateResult } from "./generator";
import { completePuzzle } from "./share";
import { TUTORIAL } from "./tutorial";
import type { Variant } from "./types";

/** The panel's elements and what the tutorial uses from the game (see ui.ts). */
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
  /** Puts a tutorial grid in play, with its status line. */
  start(puzzle: GenerateResult, variant: Variant, options: { status: string; hintCooldown: number }): void;
  /** Saves the real game (with the elapsed time) before entering, if there is one. */
  saveGame(): void;
  /** On exit: the saved game, otherwise a new one. */
  resumeOrNew(): void;
}

export interface Tutorial {
  /** A tutorial grid is being played. */
  active(): boolean;
  /** Closes the panel without touching the game in play (new game, link). */
  leave(): void;
  /** The tutorial grid is solved: says so in the panel. */
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
      // The tutorial is for learning: no cooldown between hinted pieces.
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
    // The real game is saved with the time elapsed so far, to resume it on exit.
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
