import { formatTime } from "./game";
import { variantSuffix } from "./labels";
import { parseRecordKey, type Records } from "./records";
import { difficultyLabel, difficultyLevel } from "./types";

function recordTime(ms: number | undefined): string {
  return ms === undefined ? "—" : formatTime(ms);
}

/**
 * La tabella dei record (pulsante con la coppa): una riga per griglia, livello e variante,
 * in ordine di variante, griglia dalla più piccola e livello. Solo testo nelle celle, mai HTML:
 * i record vengono da localStorage.
 */
export function showRecords(records: Records, body: HTMLElement, dialog: HTMLDialogElement): void {
  const rows = Object.entries(records)
    .flatMap(([key, rec]) => {
      const parsed = parseRecordKey(key);
      return parsed ? [{ ...parsed, rec }] : [];
    })
    .sort(
      (a, b) =>
        a.variant.localeCompare(b.variant) ||
        a.rows * a.cols - b.rows * b.cols ||
        a.rows - b.rows ||
        difficultyLevel(a.difficulty) - difficultyLevel(b.difficulty),
    );
  if (rows.length === 0) {
    body.textContent = "Ancora nessuna partita vinta.";
  } else {
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Partita</th><th>Vinte</th><th>Migliore</th><th>Senza aiuti</th></tr></thead>";
    const tbody = table.createTBody();
    for (const { rows: r, cols: c, difficulty: d, variant: v, rec } of rows) {
      const tr = tbody.insertRow();
      for (const text of [
        `${r}×${c} · ${difficultyLabel(d)}${variantSuffix(v)}`,
        String(rec.wins),
        recordTime(rec.best),
        recordTime(rec.bestClean),
      ]) {
        tr.insertCell().textContent = text;
      }
    }
    body.replaceChildren(table);
  }
  dialog.showModal();
}
