/** The clue hues and how to apply them to elements. */
import type { Clue } from "./types";

/** Clearly distinct OKLCH hues, at the same lightness (see --pill-l in style.css). */
export const HUES = [250, 150, 55, 320, 25, 195, 95, 285];

/**
 * The same hue in HSL, for browsers without oklch() (Safari before 15.4, Firefox before 113):
 * computed by converting the pill color. See @supports in style.css.
 */
export const HSL_HUES: Record<number, number> = { 250: 207, 150: 146, 55: 28, 320: 289, 25: 2, 195: 181, 95: 47, 285: 246 };

/** Gives an element the hue of a clue: --h for oklch(), --hh for the HSL fallback. */
export function tint(el: HTMLElement, hue: number): void {
  el.style.setProperty("--h", String(hue));
  el.style.setProperty("--hh", String(HSL_HUES[hue] ?? hue));
}

/**
 * One hue per clue, different from those of nearby clues (within three cells), so two equal pills
 * never sit side by side. Depends only on the clue positions, not on the solution: the colors must
 * not give anything away.
 */
export function assignHues(clues: Clue[]): number[] {
  const hues: number[] = [];
  const offset = Math.floor(Math.random() * HUES.length);
  clues.forEach((clue, i) => {
    const used = new Map<number, number>();
    for (let j = 0; j < i; j++) {
      const other = clues[j]!;
      if (Math.max(Math.abs(other.r - clue.r), Math.abs(other.c - clue.c)) <= 3)
        used.set(hues[j]!, (used.get(hues[j]!) ?? 0) + 1);
    }
    const candidates = HUES.map((_, k) => HUES[(k + offset + i) % HUES.length]!);
    const free = candidates.find((h) => !used.has(h));
    // When all colors are already used nearby, the least used one is taken.
    hues.push(free ?? candidates.reduce((best, h) => ((used.get(h) ?? 0) < (used.get(best) ?? 0) ? h : best)));
  });
  return hues;
}
