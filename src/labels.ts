/** Nomi per l'interfaccia: varianti e descrizione degli indizi per i lettori di schermo. */
import { type Clue, type Shape, VARIANTS, type Variant } from "./types";

export function variantLabel(v: Variant): string {
  return VARIANTS.find((x) => x.id === v)!.label;
}

/** " · Forme" dopo livello o griglia; niente per il Classico. */
export function variantSuffix(v: Variant): string {
  return v !== "classic" ? ` · ${variantLabel(v)}` : "";
}

const SHAPE_LABELS: Record<Shape, string> = {
  square: "quadrato",
  oblong: "rettangolo non quadrato",
  wide: "rettangolo orizzontale",
  tall: "rettangolo verticale",
};

/** Descrizione dell'indizio per i lettori di schermo. */
export function clueLabel(clue: Clue): string {
  const shape = clue.shape ? SHAPE_LABELS[clue.shape] : "forma libera";
  return `${shape}, ${clue.n !== undefined ? `${clue.n} caselle` : "caselle libere"}`;
}
