/** Le tinte degli indizi e come darle agli elementi. */
import type { Clue } from "./types";

/** Tinte OKLCH ben distinte tra loro, alla stessa luminosità (vedi --pill-l in style.css). */
export const HUES = [250, 150, 55, 320, 25, 195, 95, 285];

/**
 * La stessa tinta in HSL, per i browser senza oklch() (Safari prima di 15.4, Firefox prima
 * di 113): calcolata convertendo il colore della pastiglia. Vedi @supports in style.css.
 */
export const HSL_HUES: Record<number, number> = { 250: 207, 150: 146, 55: 28, 320: 289, 25: 2, 195: 181, 95: 47, 285: 246 };

/** Dà a un elemento la tinta di un indizio: --h per oklch(), --hh per l'alternativa HSL. */
export function tint(el: HTMLElement, hue: number): void {
  el.style.setProperty("--h", String(hue));
  el.style.setProperty("--hh", String(HSL_HUES[hue] ?? hue));
}

/**
 * Una tinta per indizio, diversa da quelle degli indizi vicini (entro tre caselle), così
 * due pastiglie uguali non stanno accanto. Dipende solo dalla posizione degli indizi, non
 * dalla soluzione: i colori non devono suggerire niente.
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
    // Con tutti i colori già usati vicino si prende il meno usato.
    hues.push(free ?? candidates.reduce((best, h) => ((used.get(h) ?? 0) < (used.get(best) ?? 0) ? h : best)));
  });
  return hues;
}
