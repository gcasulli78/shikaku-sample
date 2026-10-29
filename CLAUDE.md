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
- Sicurezza (assessment del 2026-10-29):
  - Ciò che si rilegge da `localStorage` passa sempre da `stored.ts` (`parseSettings`, `parseSavedState`, `parseRecords`, `parseReady`): può essere rovinato o scritto da un'altra pagina della stessa origine (con `file://` sono tutti i file locali). Con un livello sconosciuto o una griglia enorme il gioco non partiva più.
  - Niente `innerHTML` con testo variabile: la riga di stato è `{ level, text }` costruita con nodi DOM, e la partita salvata contiene solo la nota in testo semplice (non più lo `status` HTML).
  - I link si aprono nel Worker (`jobs.ts`: `{ generate }` o `{ link }`), e il solver ha anche un limite di tempo (`LINK_TIME_MS` in `share.ts`): un link con tanti `?` su un 15×15 bloccava la pagina per 36–48 s.
  - La build aggiunge una Content Security Policy (`vite.config.ts`, dopo `viteSingleFile`), con l'impronta sha256 dello script inline. Risorse esterne, fetch o nuovi script vanno aggiunti alla policy, altrimenti il browser li blocca.
- Tutti i puzzle hanno soluzione unica, verificata dal solver.

## Regole di gioco decise dall'utente

- I rettangoli non si sovrappongono: un trascinamento sopra un'area esistente mostra l'anteprima rossa e al rilascio viene rifiutato.
- Click singolo: su un rettangolo lo toglie; su una casella libera crea un 1×1 solo se lì c'è il numero 1, altrimenti non fa niente.
- Selezione (`selection.ts`): la casella di partenza non deve essere un angolo. Ogni lato segue il dito finché il dito è da quella parte e resta fermo quando passa dall'altra; tornando sulla riga o colonna di partenza il lato si richiude, ma se da lì si prosegue dall'altra parte (attraversamento) si riapre fin dove il dito era arrivato. Serve a partire dal numero in mezzo a un lato (richiesta dell'utente). La scritta dell'anteprima va nella metà opposta al dito.
- Tastiera (`ui.ts`): il cursore si vede solo dopo un tasto e sparisce col mouse; Invio fissa l'angolo e poi posa con la stessa logica del trascinamento (`commitRect`, quindi anche il tap da tastiera su un 1). Annunci per i lettori di schermo in `#sr`.
- Suggerimento: se ci sono rettangoli sbagliati (diversi dalla soluzione) li toglie tutti insieme e spiega il primo (`Game.whyWrong`: nessun indizio, più indizi, area o forma sbagliate, oppure con `conflictOf` in `grader.ts` l'indizio che resta subito senza spazio o la casella che resta subito scoperta). Se il primo rispetta l'indizio ma il motivo non si vede subito (`misplaced`, dal 17% al 59% dei casi secondo il livello) non si inventa una frase: si posa il pezzo giusto di quell'indizio, o durante l'attesa di 15 s al suggerimento dopo (grado "Mostra il pezzo"). Deciso dall'utente: "dopo qualche passo" non spiega niente, meglio il pezzo. Solo quando non ci sono errori aiuta a gradi: indizio da guardare, motivo, pezzo; una mossa azzera i gradi.
- Il pezzo suggerito non viene dalla soluzione ma da una deduzione su UN indizio alla volta, "dove può stare?" (`nextDeduction`, `grader.ts`), sulla griglia che il giocatore vede (solo i pezzi posati): le forme possibili sono quelle che non toccano pezzi, altri numeri o caselle nere, e l'indizio si deduce se tutte tranne una creano un problema che si vede, cioè una casella che nessuno può più coprire o un numero senza spazio. Subito (`direct`) o dopo una catena di al massimo 3 pezzi obbligati (`chain`, `MAX_CHAIN`): obbligato vuol dire con una sola forma rimasta, o unico ad arrivare a una casella e in un modo solo. Se una casella la raggiunge solo quell'indizio basta mostrare quella (`only`). Si sceglie: forma unica, poi catene più corte, poi meno forme da scartare, poi l'indizio più vicino all'ultima mossa. Tetto di 300 ms (`DEDUCTION_MS`). Se niente basta si posa il pezzo mancante più vicino all'ultima mossa ("Nessuna deduzione semplice"; misurato: 0–1% su 8×8 Classico e Caselle nere, 4–12% su Forme Difficile e oltre).
- Come si mostra (`explainFrames`, `ui.ts`): al grado "Perché?" una forma scartata alla volta, ogni 3 s: tratteggiata in rosso, i pezzi della catena tratteggiati in blu, il problema in rosso, con la frase "Il 6 così? Allora il 4 potrebbe stare solo così, e il 3 resterebbe senza spazio". "L'altro 4" se il nome è lo stesso. Deciso dall'utente dopo tre segnalazioni: niente regole astratte ("solo lui può coprire la casella", "provando si arriva a una contraddizione", "dopo qualche passo") né passi non detti; meglio posare il pezzo. Il pezzo suggerito resta uno solo: le forme mostrate sono tutte dello stesso indizio o della catena. `grade` invece usa le sue regole a catena, quindi i livelli non dipendono da questo. Un test ricontrolla ogni spiegazione con le sole forme possibili (`explanationHolds`). Le griglie del tutorial devono dare il primo suggerimento del tipo atteso (`firstRule`, testato).
- Tra due pezzi posati dal suggerimento devono passare 15 s (`HINT_COOLDOWN`, deciso dall'utente): indizio, motivo e rimozione degli errori restano sempre disponibili; al terzo grado il pulsante mostra il conto alla rovescia. L'attesa si misura in tempo di gioco (il cronometro, che si ferma con la scheda nascosta): `Game.hint(now)` e `cooldown(now)` ricevono `timer.elapsed()`, e l'ultimo pezzo si salva con la partita nella stessa unità. Nel tutorial nessuna attesa (opzione `hintCooldown: 0` del costruttore). I test passano il tempo a mano; la prova in Edge usa l'orologio simulato di Playwright.
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
- Versione x.y.z in `package.json`, mostrata in fondo alla pagina ("Versione 0.2.0", da `__APP_VERSION__` in `vite.config.ts`): chiesta dall'utente per sapere se il sito è aggiornato. A ogni push su main si alza: patch per correzioni, minor per funzioni nuove.
