/** Names for the UI: variants and clue descriptions for screen readers. */
import { type Clue, type Shape, VARIANTS, type Variant } from "./types";

export function variantLabel(v: Variant): string {
  return VARIANTS.find((x) => x.id === v)!.label;
}

/** " · Forme" after level or grid; nothing for Classic. */
export function variantSuffix(v: Variant): string {
  return v !== "classic" ? ` · ${variantLabel(v)}` : "";
}

const SHAPE_LABELS: Record<Shape, string> = {
  square: "quadrato",
  oblong: "rettangolo non quadrato",
  wide: "rettangolo orizzontale",
  tall: "rettangolo verticale",
};

/** Clue description for screen readers. */
export function clueLabel(clue: Clue): string {
  const shape = clue.shape ? SHAPE_LABELS[clue.shape] : "forma libera";
  return `${shape}, ${clue.n !== undefined ? `${clue.n} caselle` : "caselle libere"}`;
}
