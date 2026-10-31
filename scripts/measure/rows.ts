import type { Variant } from "../../src/types";

/** Dove finiscono le misure: una riga JSON per puzzle, un file per variante. */
export const OUT_DIR = "measurements";

export interface Row {
  variant: Variant;
  size: string;
  asked: string;
  got: string;
  unique: boolean;
  pieces: number;
  genMs: number;
  simMs: number;
  maxCall: number;
  /** Deduzioni oltre il tetto del gioco (300 ms): lì ripiegherebbero. */
  slow: number;
  /** Pezzi posati senza deduzione ("Nessuna deduzione semplice"). */
  fallbacks: number;
  firstFail: number;
}
