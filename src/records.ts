import type { Difficulty, Variant } from "./types";

/** Record di una griglia, un livello e una variante. Tempi in ms. */
export interface RecordEntry {
  wins: number;
  best?: number;
  /** Il miglior tempo senza aiuti. */
  bestClean?: number;
}

export type Records = { [key: string]: RecordEntry };

export interface RecordKey {
  rows: number;
  cols: number;
  difficulty: Difficulty;
  variant: Variant;
}

export function recordKey({ rows, cols, difficulty, variant }: RecordKey): string {
  return `${rows}x${cols}:${difficulty}:${variant}`;
}

export function parseRecordKey(key: string): RecordKey | undefined {
  const match = /^(\d+)x(\d+):(\w+):(\w+)$/.exec(key);
  if (!match) return undefined;
  return { rows: Number(match[1]), cols: Number(match[2]), difficulty: match[3] as Difficulty, variant: match[4] as Variant };
}

/** Registra una vittoria; dice se è un nuovo record, assoluto o senza aiuti. */
export function recordWin(records: Records, key: string, time: number, clean: boolean): { best: boolean; bestClean: boolean } {
  const old = records[key] ?? { wins: 0 };
  const best = old.best === undefined || time < old.best;
  const bestClean = clean && (old.bestClean === undefined || time < old.bestClean);
  records[key] = {
    wins: old.wins + 1,
    best: best ? time : old.best,
    bestClean: bestClean ? time : old.bestClean,
  };
  // Al primo successo non c'è niente da battere: non si festeggia.
  return { best: best && old.wins > 0, bestClean: bestClean && old.bestClean !== undefined };
}
