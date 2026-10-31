/** Lettura e scrittura in localStorage: sempre in try/catch, il gioco funziona anche senza. */

export const STORAGE_KEY = "shikaku:settings";
export const READY_KEY = "shikaku:ready";
export const GAME_KEY = "shikaku:game";
export const RECORDS_KEY = "shikaku:records";

/** Valore salvato in localStorage, controllato da parse (vedi stored.ts); undefined se manca. */
export function readStored<T>(key: string, parse: (raw: unknown) => T): T {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined;
  } catch {
    // Storage non disponibile o JSON rovinato: come se non ci fosse niente.
  }
  return parse(raw);
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Come sotto: senza storage non c'è niente da togliere.
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage non disponibile (navigazione privata, file://): si perde solo ciò che si voleva ricordare.
  }
}
