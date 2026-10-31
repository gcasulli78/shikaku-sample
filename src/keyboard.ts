/**
 * Gioco da tastiera: un cursore sulla griglia; Invio (o spazio) fissa un angolo e poi posa
 * con la stessa logica del trascinamento; Esc annulla la selezione, Canc toglie il
 * rettangolo sotto il cursore. Il cursore si vede solo dopo un tasto e sparisce col mouse.
 * Ogni mossa si annuncia ai lettori di schermo.
 */
import { cellArea } from "./board";
import type { Game } from "./game";
import { clueLabel } from "./labels";
import { moveSelection, type Selection, selectionRect, startSelection } from "./selection";
import type { Rect } from "./types";

/** Quello che il cursore usa della partita e dell'interfaccia (vedi ui.ts). */
export interface KeyboardContext {
  board: HTMLElement;
  /** Dove si scrive l'annuncio per i lettori di schermo. */
  sr: HTMLElement;
  /** La partita in gioco (nessuna prima della prima generazione). */
  game(): Game | undefined;
  solved(): boolean;
  /** Posa la selezione come al rilascio del trascinamento. */
  commit(sel: Selection): void;
  /** Toglie un rettangolo posato, come un tocco. */
  remove(rect: Rect): void;
  render(): void;
  showPreview(sel: Selection): void;
  clearPreview(): void;
}

export interface Keyboard {
  /** Ridisegna il cursore (dopo ogni render, che svuota la griglia). */
  render(): void;
  /** Si torna al mouse o al dito: cursore e selezione da tastiera spariscono. */
  release(): void;
}

const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

export function setupKeyboard(ctx: KeyboardContext): Keyboard {
  const { board } = ctx;
  /** Il cursore si vede solo usando la tastiera, finché non si torna al mouse. */
  let active = false;
  let cursor: [number, number] = [0, 0];
  /** La selezione da tastiera, dalla casella dove si è premuto Invio. */
  let selecting: Selection | undefined;
  let cursorEl: HTMLDivElement | undefined;

  const render = () => {
    cursorEl?.remove();
    cursorEl = undefined;
    const game = ctx.game();
    if (!active || !game || ctx.solved()) return;
    const { rows, cols } = game.puzzle;
    cursor = [Math.min(cursor[0], rows - 1), Math.min(cursor[1], cols - 1)];
    cursorEl = document.createElement("div");
    cursorEl.className = "cursor";
    cellArea(cursorEl, ...cursor);
    board.append(cursorEl);
    if (selecting) ctx.showPreview(selecting);
  };

  /** Cosa c'è sotto il cursore, per i lettori di schermo. */
  const announce = (game: Game) => {
    const [r, c] = cursor;
    const clue = game.puzzle.clues.find((cl) => cl.r === r && cl.c === c);
    const rect = game.rectAt(r, c);
    const parts = [`Riga ${r + 1}, colonna ${c + 1}`];
    if (clue) parts.push(`indizio: ${clueLabel(clue)}`);
    parts.push(game.isBlocked(r, c) ? "casella nera" : rect ? `nel rettangolo ${rect.h}×${rect.w}` : "libera");
    if (selecting) {
      const sel = selectionRect(selecting);
      parts.push(`selezione ${sel.h}×${sel.w}, Invio per posarla`);
    }
    ctx.sr.textContent = `${parts.join(", ")}.`;
  };

  board.addEventListener("keydown", (e) => {
    const game = ctx.game();
    if (!game || ctx.solved() || e.ctrlKey || e.metaKey || e.altKey) return;
    const move = MOVES[e.key];
    if (move) {
      const { rows, cols } = game.puzzle;
      if (active)
        cursor = [Math.min(rows - 1, Math.max(0, cursor[0] + move[0])), Math.min(cols - 1, Math.max(0, cursor[1] + move[1]))];
      active = true;
      if (selecting) selecting = moveSelection(selecting, ...cursor);
    } else if (e.key === "Enter" || e.key === " ") {
      active = true;
      if (selecting) {
        const sel = selecting;
        selecting = undefined;
        ctx.commit(sel);
      } else selecting = startSelection(...cursor);
    } else if (e.key === "Escape" && selecting) {
      selecting = undefined;
      ctx.render();
    } else if ((e.key === "Delete" || e.key === "Backspace") && active) {
      const rect = game.rectAt(...cursor);
      if (rect) ctx.remove(rect);
    } else return;
    e.preventDefault();
    if (!selecting) ctx.clearPreview();
    render();
    announce(game);
  });
  board.addEventListener("blur", () => {
    selecting = undefined;
    ctx.clearPreview();
  });

  return {
    render,
    release() {
      if (!active) return;
      active = false;
      selecting = undefined;
      render();
    },
  };
}
