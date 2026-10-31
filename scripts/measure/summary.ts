/**
 * Riepilogo delle misure, stampato alla fine di npm run measure (measurements/*.jsonl, vedi run.ts): una riga per variante, griglia
 * e livello chiesto, poi per livello ottenuto. Le colonne:
 * - liv.ok: puzzle del livello chiesto (gli altri sono quelli "vicini" allo scadere del tempo);
 * - risolti: quanti si finiscono con le sole deduzioni dei suggerimenti (nessun ripiego);
 * - ripieghi: "Nessuna deduzione semplice" in media a partita;
 * - >300ms: deduzioni che nel gioco supererebbero il tetto e ripiegherebbero;
 * - gen: tempo medio di generazione in ms.
 */
import { existsSync, readFileSync } from "node:fs";
import { OUT_DIR, type Row } from "./rows";

const VARIANTS = ["classic", "shapes", "blocked"] as const;
const LEVELS = ["easy", "medium", "hard", "expert", "master"];

/** Alla fine di tutte le misure (globalSetup in vitest.config.ts): stampa il riepilogo. */
export function teardown(): void {
  const rows: Row[] = VARIANTS.filter((v) => existsSync(`${OUT_DIR}/${v}.jsonl`)).flatMap((v) =>
    readFileSync(`${OUT_DIR}/${v}.jsonl`, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Row),
  );

  const solved = (list: Row[]) => list.filter((r) => r.fallbacks === 0).length;
  const pad = (value: string | number, n: number) => String(value).padEnd(n);

  const lines: string[] = [];
  lines.push(`${pad("variante griglia livello", 26)}n   liv.ok  risolti(liv.ok)  ripieghi  >300ms  gen`);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.variant} ${r.size} ${r.asked}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, g] of groups) {
    const ok = g.filter((r) => r.got === r.asked);
    const fallbacks = g.reduce((s, r) => s + r.fallbacks, 0) / g.length;
    const slow = g.reduce((s, r) => s + r.slow, 0);
    const gen = Math.round(g.reduce((s, r) => s + r.genMs, 0) / g.length);
    lines.push(
      `${pad(key, 26)}${pad(g.length, 4)}${pad(ok.length, 8)}${pad(`${solved(ok)}/${ok.length}`, 17)}${pad(fallbacks.toFixed(2), 10)}${pad(slow, 8)}${gen}`,
    );
  }
  lines.push("", "Per livello ottenuto (risolti con i suggerimenti / puzzle):");
  for (const v of VARIANTS) {
    const parts = LEVELS.map((l) => {
      const g = rows.filter((r) => r.variant === v && r.got === l);
      return `${l} ${solved(g)}/${g.length}`;
    });
    lines.push(`${pad(v, 9)}${parts.join("   ")}`);
  }
  console.log(`\n${lines.join("\n")}\n`);
}
