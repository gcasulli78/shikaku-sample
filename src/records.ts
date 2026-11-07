import { type Difficulty, isDifficulty, isVariant, MAX_SIZE, MIN_SIZE, type Variant } from "./types";

/** Record for a grid, a level and a variant. Times in ms. */
export interface RecordEntry {
  wins: number;
  best?: number;
  /** The best time without help. */
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

/** undefined if the key isn't for a 4–15 grid with an existing level and variant. */
export function parseRecordKey(key: string): RecordKey | undefined {
  const match = /^(\d+)x(\d+):(\w+):(\w+)$/.exec(key);
  if (!match) return undefined;
  const [rows, cols] = [Number(match[1]), Number(match[2])];
  const [difficulty, variant] = [match[3], match[4]];
  if (!isDifficulty(difficulty) || !isVariant(variant)) return undefined;
  if (rows < MIN_SIZE || rows > MAX_SIZE || cols < MIN_SIZE || cols > MAX_SIZE) return undefined;
  return { rows, cols, difficulty, variant };
}

/** Records a win; tells whether it's a new record, overall or without help. */
export function recordWin(records: Records, key: string, time: number, clean: boolean): { best: boolean; bestClean: boolean } {
  const old = records[key] ?? { wins: 0 };
  const best = old.best === undefined || time < old.best;
  const bestClean = clean && (old.bestClean === undefined || time < old.bestClean);
  records[key] = {
    wins: old.wins + 1,
    best: best ? time : old.best,
    bestClean: bestClean ? time : old.bestClean,
  };
  // On the first success there's nothing to beat: no celebration.
  return { best: best && old.wins > 0, bestClean: bestClean && old.bestClean !== undefined };
}
