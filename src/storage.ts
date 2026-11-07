/** Reading and writing localStorage: always in try/catch, the game works without it too. */

export const STORAGE_KEY = "shikaku:settings";
export const READY_KEY = "shikaku:ready";
export const GAME_KEY = "shikaku:game";
export const RECORDS_KEY = "shikaku:records";

/** Value saved in localStorage, checked by parse (see stored.ts); undefined if missing. */
export function readStored<T>(key: string, parse: (raw: unknown) => T): T {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined;
  } catch {
    // Storage unavailable or corrupted JSON: as if there were nothing.
  }
  return parse(raw);
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // As below: without storage there's nothing to remove.
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private browsing, file://): only what was meant to be remembered is lost.
  }
}
