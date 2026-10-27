# Shikaku — note per Claude

Gioco Shikaku nel browser, per uso personale e con amici. Testi dell'interfaccia, commenti e messaggi di commit in italiano.

## Comandi

```sh
npm test            # Vitest
npm run typecheck   # tsc --noEmit
npm run build       # dist/index.html, file unico
npm run dev
```

Su Windows, se `npm` non si trova: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"` (PowerShell).

## Vincoli di architettura

- La logica (`types`, `rng`, `solver`, `grader`, `generator`, `game`) non usa il DOM ed è coperta dai test in `tests/`. `ui.ts` si occupa solo di rendering e input.
- La build deve restare **un unico file HTML** che funziona aprendolo con doppio clic (`file://`), senza server. Il Worker è incluso inline (`./worker?worker&inline`).
- `localStorage` sempre dentro try/catch: il gioco deve funzionare anche senza.
- Tutti i puzzle hanno soluzione unica, verificata dal solver.

## Regole di gioco decise dall'utente

- I rettangoli non si sovrappongono: un trascinamento sopra un'area esistente mostra l'anteprima rossa e al rilascio viene rifiutato.
- Click singolo: su un rettangolo lo toglie; su una casella libera crea un 1×1 solo se lì c'è il numero 1, altrimenti non fa niente.
- Suggerimento: se ci sono rettangoli sbagliati (diversi dalla soluzione) li toglie tutti senza posarne; solo quando non ce ne sono posa un pezzo corretto.

## Variante Forme

- `Clue` ha `n` e `shape` opzionali (`types.ts`): senza `n` l'area è aperta, senza `shape` la forma è libera, senza nessuno dei due è un `?`. Ogni controllo su un rettangolo passa da `fits(clue, rect)`.
- Con aree aperte la somma dei numeri non garantisce più la copertura: il solver verifica che tutte le caselle siano coperte prima di contare una soluzione.
- Il generatore sceglie il tipo di indizio con `SHAPE_KINDS` (pesi per livello); per rendere unica la soluzione prima **rivela** un'informazione, poi sposta l'indizio. Nel Classico la sequenza casuale è identica a prima (stessi puzzle per seed).
- Il valutatore ha un budget di passi (`WORK_BUDGET`): con molti indizi aperti le ipotesi profonde esplodevano fino a 10 s per valutazione. Finito il budget il puzzle risulta "non risolto", senza scartare forme a torto.

## Difficoltà

Il livello è la regola più avanzata che serve al valutatore (`src/grader.ts`) per chiudere il puzzle:

| Livello | Regola |
| --- | --- |
| Facile | un numero ha una sola forma |
| Medio | cella coperta da un solo numero; celle comuni a tutte le forme di un numero |
| Difficile | scartare forme che lascerebbero celle o numeri senza copertura |
| Esperto | un'ipotesi tra ≤3 forme, smentita con le regole Facile/Medio |
| Maestro | ipotesi profonda tra ≤6 forme, smentita con regole fino a Esperto |

- Il generatore (`src/generator.ts`) usa un profilo per livello (`PROFILES`) e poi sposta i numeri (`tune`) finché il livello misurato coincide.
- In `src/types.ts`: `MIN_SIDE` (Esperto da 7, Maestro da 8, sul lato minore) e `TIME_LIMITS`. Allo scadere del tempo si propone il puzzle più vicino, preferendo un livello sotto a uno sopra.
- Esperto e Maestro: mentre si gioca, un secondo Worker prepara il puzzle successivo e lo salva in `localStorage` (`shikaku:ready`).

Se si cambiano regole o profili, **prima misurare** su più seed e dimensioni (7×7, 8×8, 10×10, 15×15, una griglia rettangolare): quanti puzzle del livello giusto si trovano entro il tempo limite e quanto tempo serve. Le soglie attuali vengono da queste misure.

## Modo di lavorare

- Prima di modifiche importanti presentare il piano e aspettare la conferma.
- Per le domande aperte rispondere a parole, non con menu a scelta multipla.
- Dopo una modifica: typecheck, test e build. Per l'interfaccia, prova in Edge (Playwright) del file `dist/index.html`.
