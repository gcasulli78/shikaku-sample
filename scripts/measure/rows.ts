import type { Variant } from "../../src/types";

/** Where the measurements go: one JSON line per puzzle, one file per variant. */
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
  /** Deductions over the game's cap (300 ms): there they would fall back. */
  slow: number;
  /** Pieces placed without a deduction ("Nessuna deduzione semplice"). */
  fallbacks: number;
  firstFail: number;
}
