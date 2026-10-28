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
- Il pezzo suggerito non viene dalla soluzione ma da una deduzione: `nextDeduction` (`grader.ts`) parte dai pezzi posati e applica le regole del valutatore in ordine di costo fino al primo indizio con una sola forma; la riga di stato dice il motivo (forma unica, casella che può coprire solo quell'indizio, celle sicure di un altro indizio, buchi, ipotesi) e l'indizio o la casella decisiva lampeggiano. Solo se le regole non bastano si posa un pezzo della soluzione, senza motivo.

## Variante Forme

- `Clue` ha `n` e `shape` opzionali (`types.ts`): senza `n` l'area è aperta, senza `shape` la forma è libera, senza nessuno dei due è un `?`. Ogni controllo su un rettangolo passa da `fits(clue, rect)`.
- Forme possibili: `square`, `oblong` (non quadrato, orizzontale **o** verticale), `wide` (più largo che alto), `tall` (più alto che largo). `shapeOf` restituisce sempre quella esatta (mai `oblong`); `fits` accetta `oblong` per `wide` e `tall`.
- Simboli (scelti dall'utente): `oblong` è una croce, con contorno esterno pieno e linee interne tratteggiate (maschera SVG in `style.css`); `wide` e `tall` sono un rettangolino orizzontale o verticale. Un rettangolino orizzontale per `oblong` sembrava imporre l'orientamento.
- `ORIENTED` (`generator.ts`) dà per livello la probabilità che un indizio con forma sia orientato: più alta ai livelli bassi, 0 a Maestro. L'orientamento non si rivela in `reveal` (rendeva Esperto e Maestro troppo facili).
- La partizione riga per riga favorisce i rettangoli verticali (sul 15×15 4 puzzle su 5 quasi tutti verticali). Si usa quindi la partizione bilanciata (`BALANCED`, per livello, in entrambe le varianti): si ammettono solo forme che ci starebbero anche ruotate, e gli orizzontali pesano `WIDE_WEIGHT`. Maestro usa quella originale: con la bilanciata ha pezzi più piccoli e non si trovava in tempo.
- Il solver ha un budget di nodi (`maxNodes`), usato dal generatore (`SOLVE_BUDGET`): con molti indizi ad area aperta la ricerca poteva esplodere (30 s). Se il budget finisce, quella partizione si scarta.
- Con aree aperte la somma dei numeri non garantisce più la copertura: il solver verifica che tutte le caselle siano coperte prima di contare una soluzione.
- Il generatore sceglie il tipo di indizio con `SHAPE_KINDS` (pesi per livello); per rendere unica la soluzione prima **rivela** un'informazione, poi sposta l'indizio. Nel Classico non si estrae il tipo: a Maestro (partizione originale) i puzzle per seed sono gli stessi di prima.
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
