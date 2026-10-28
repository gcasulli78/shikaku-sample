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
- Tastiera (`ui.ts`): il cursore si vede solo dopo un tasto e sparisce col mouse; Invio fissa l'angolo e poi posa con la stessa logica del trascinamento (`commitRect`, quindi anche il tap da tastiera su un 1). Annunci per i lettori di schermo in `#sr`.
- Suggerimento: se ci sono rettangoli sbagliati (diversi dalla soluzione) li toglie tutti insieme senza posarne e spiega il primo (`Game.whyWrong`: nessun indizio, più indizi, area o forma sbagliate, oppure con `conflictOf` in `grader.ts` l'indizio che resta senza spazio o la casella che resta scoperta, con le regole fino a Difficile). Solo quando non ce ne sono aiuta a gradi: indizio da guardare, motivo, pezzo; una mossa azzera i gradi.
- Il pezzo suggerito non viene dalla soluzione ma da una deduzione: `nextDeduction` (`grader.ts`) parte dai pezzi posati e applica le regole del valutatore in ordine di costo fino al primo indizio con una sola forma; la riga di stato dice il motivo (forma unica, casella che può coprire solo quell'indizio, celle sicure di un altro indizio, buchi, ipotesi) e l'indizio o la casella decisiva lampeggiano. Solo se le regole non bastano si posa subito un pezzo della soluzione, senza motivo.
- Tra due pezzi posati dal suggerimento devono passare 15 s (`HINT_COOLDOWN`, deciso dall'utente): indizio, motivo e rimozione degli errori restano sempre disponibili; al terzo grado il pulsante mostra il conto alla rovescia. L'ora dell'ultimo pezzo si salva con la partita. Nel tutorial nessuna attesa (`hintCooldown = 0`). `Game.hint(now)` riceve l'orologio, così i test non aspettano; la prova in Edge usa l'orologio simulato di Playwright.
- Verifica dice solo quanti rettangoli sono sbagliati. `hintsUsed` conta pezzi posati ed errori tolti dal suggerimento; `helped` qualsiasi aiuto (anche un grado o la verifica) ed esclude il record "senza aiuti".

## Variante Forme

- `Clue` ha `n` e `shape` opzionali (`types.ts`): senza `n` l'area è aperta, senza `shape` la forma è libera, senza nessuno dei due è un `?`. Ogni controllo su un rettangolo passa da `fits(clue, rect)`.
- Forme possibili: `square`, `oblong` (non quadrato, orizzontale **o** verticale), `wide` (più largo che alto), `tall` (più alto che largo). `shapeOf` restituisce sempre quella esatta (mai `oblong`); `fits` accetta `oblong` per `wide` e `tall`.
- Simboli (scelti dall'utente): `oblong` è una croce con linee interne tratteggiate (maschera SVG in `style.css`); `wide` e `tall` sono un rettangolino orizzontale o verticale. Un rettangolino orizzontale per `oblong` sembrava imporre l'orientamento.
- Aspetto (in tutte le varianti): ogni indizio è una pastiglia piena (`.pill`) con tinta OKLCH a luminosità fissa (`--pill-l`), così il numero bianco ha lo stesso contrasto su ogni colore; cerchio = solo numero, grigia = `?`. Le tinte (`assignHues` in `ui.ts`) dipendono dalla posizione degli indizi, non dalla soluzione: colorare in base ai rettangoli confinanti della soluzione la suggerirebbe. Ispirazione grafica generica (pastiglie, griglia tratteggiata, comandi a pillola), senza copiare l'aspetto di un gioco esistente.
- `ORIENTED` (`generator.ts`) dà per livello la probabilità che un indizio con forma sia orientato: più alta ai livelli bassi, 0 a Maestro. L'orientamento non si rivela in `reveal` (rendeva Esperto e Maestro troppo facili).
- La partizione riga per riga favorisce i rettangoli verticali (sul 15×15 4 puzzle su 5 quasi tutti verticali). Si usa quindi la partizione bilanciata (`BALANCED`, per livello, in entrambe le varianti): si ammettono solo forme che ci starebbero anche ruotate, e gli orizzontali pesano `WIDE_WEIGHT`. Maestro usa quella originale: con la bilanciata ha pezzi più piccoli e non si trovava in tempo.
- Il solver ha un budget di nodi (`maxNodes`), usato dal generatore (`SOLVE_BUDGET`): con molti indizi ad area aperta la ricerca poteva esplodere (30 s). Se il budget finisce, quella partizione si scarta.
- Con aree aperte la somma dei numeri non garantisce più la copertura: il solver verifica che tutte le caselle siano coperte prima di contare una soluzione.
- Il generatore sceglie il tipo di indizio con `SHAPE_KINDS` (pesi per livello); per rendere unica la soluzione prima **rivela** un'informazione, poi sposta l'indizio. Nel Classico non si estrae il tipo: a Maestro (partizione originale) i puzzle per seed sono gli stessi di prima.
- Il valutatore ha un budget di passi (`WORK_BUDGET`): con molti indizi aperti le ipotesi profonde esplodevano fino a 10 s per valutazione. Finito il budget il puzzle risulta "non risolto", senza scartare forme a torto.

## Variante Caselle nere

- `Puzzle.blocked` / `SolveInput.blocked`: celle (r * cols + c) da non coprire. Nel solver sono `BLOCKED` nella mappa degli indizi (nessun candidato le contiene) e contano come già coperte; nel valutatore sono `occupied` fin dall'inizio, quindi tutte le regole le ignorano. `Game.canPlace` rifiuta i rettangoli che le coprono.
- Il generatore non sparge caselle nere a caso (tolgono spazio ai pezzi grandi e rendono i puzzle troppo facili: con il 3% Maestro non si trovava più): parte dalla partizione normale e annerisce pezzi da 1–2 caselle, poi se servono strisce di 1–2 caselle dal bordo di rettangoli stretti (`blackenSmall`). Quota per livello in `BLACK_RATE` (8% fino a Difficile, 3% a Esperto e Maestro); su 15×15 Esperto e Maestro si trovano comunque più di rado che nel Classico.
- Nel Classico e nelle Forme non si estrae nulla in più: stessi puzzle per seed di prima.

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

## Tutorial

- `tutorial.ts`: griglie scritte a mano, una per regola (più una per variante); i test (`tests/tutorial.test.ts`) verificano soluzione unica, livello del valutatore e prima regola usata. Se si cambiano le regole del valutatore, ricontrollare che ogni griglia insegni ancora la sua.
- Il tutorial gioca sulla griglia vera: durante il tutorial niente salvataggio, record né riquadro di vittoria; uscendo si riprende la partita salvata (o se ne crea una nuova). Nuova partita o un link chiudono il tutorial.

## Partite salvate, record, link

- `localStorage`: `shikaku:settings` (menu e tema), `shikaku:game` (partita in corso: puzzle, rettangoli, suggerimenti, tempo; si cancella alla vittoria; la cronologia di Annulla non si salva), `shikaku:records` (`records.ts`, chiave griglia:livello:variante, livello misurato).
- All'avvio: puzzle del link (`#p=…`), altrimenti partita salvata, altrimenti una nuova. Riprendendo una partita i menu restano quelli delle impostazioni; con un link si allineano al puzzle.
- Il link contiene gli **indizi** (`share.ts`, con numero di versione), non il seed: col tempo limite lo stesso seed può dare puzzle diversi su dispositivi diversi, e cambiare il generatore romperebbe i link. All'apertura soluzione e livello si ricalcolano con solver e valutatore; dopo l'apertura l'indirizzo si ripulisce. Funziona anche con `hashchange` (link incollato nella scheda aperta).

Se si cambiano regole o profili, **prima misurare** su più seed e dimensioni (7×7, 8×8, 10×10, 15×15, una griglia rettangolare): quanti puzzle del livello giusto si trovano entro il tempo limite e quanto tempo serve. Le soglie attuali vengono da queste misure.

## Modo di lavorare

- Prima di modifiche importanti presentare il piano e aspettare la conferma.
- Per le domande aperte rispondere a parole, non con menu a scelta multipla.
- Dopo una modifica: typecheck, test e build. Per l'interfaccia, prova in Edge (Playwright) del file `dist/index.html`.
