# Shikaku

Rompicapo logico nel browser: dividi la griglia in rettangoli, ognuno con un solo numero e tante caselle quanto quel numero.
Puzzle generati a caso con soluzione unica garantita, tutto lato client (nessun server).

## Comandi

```sh
npm install        # una volta sola
npm run dev        # sviluppo con ricarica automatica
npm test           # test (Vitest)
npm run typecheck  # controllo tipi
npm run build      # crea dist/index.html, file unico da aprire con doppio clic o condividere
```

## Struttura

| File | Ruolo |
| --- | --- |
| `src/types.ts` | Tipi (`Rect`, `Clue`, `Puzzle`), limiti griglia 4–15, preset |
| `src/rng.ts` | Generatore casuale con seed |
| `src/generator.ts` | Partizione casuale + numeri; soluzione unica; profili e raffinamento per raggiungere la difficoltà chiesta |
| `src/solver.ts` | Conta le soluzioni con backtracking (si ferma a 2) |
| `src/grader.ts` | Misura la difficoltà risolvendo "come una persona" con regole graduate |
| `src/worker.ts` | Genera i puzzle in un Web Worker, senza bloccare la pagina |
| `src/game.ts` | Stato partita: posa/rimozione, annulla, suggerimenti, vittoria, cronometro |
| `src/ui.ts` | Rendering, input mouse/touch, tema, impostazioni salvate |

La logica (`types`, `rng`, `generator`, `solver`, `grader`, `game`) non usa il DOM ed è coperta dai test in `tests/`.

## Difficoltà

Il livello è la regola più avanzata che serve per risolvere il puzzle:

| Livello | Regola necessaria |
| --- | --- |
| Facile | Un numero ha una sola forma possibile |
| Medio | Una cella può appartenere a un solo numero; celle comuni a tutte le forme di un numero |
| Difficile | Una forma va scartata perché lascerebbe celle o numeri senza copertura |
| Esperto | Serve un'ipotesi: provare una forma (tra al massimo 3) e scartarla quando con deduzioni semplici porta a contraddizione |
| Maestro | Serve un'ipotesi profonda: tra al massimo 6 forme, e per smentirla servono i buchi o una seconda ipotesi dentro la prima |

Esperto è disponibile da 7×7 in su, Maestro da 8×8 (lato minore; `MIN_SIDE` in `src/types.ts`).
La generazione ha un tempo massimo (`TIME_LIMITS`): se scade, si propone il puzzle più vicino e la pagina lo segnala.
Per Esperto e Maestro, mentre si gioca un secondo Worker prepara già il puzzle successivo e lo salva nel browser, così la partita dopo parte subito.
