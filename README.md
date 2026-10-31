# Shikaku

Rompicapo logico nel browser: dividi la griglia in rettangoli, ognuno con un solo numero e tante caselle quanto quel numero.
Puzzle generati a caso con soluzione unica garantita, tutto lato client (nessun server).

## Comandi

```sh
npm install        # una volta sola
npm run dev        # sviluppo con ricarica automatica
npm test           # test della logica (Vitest)
npm run test:e2e   # test dell'interfaccia in Chromium, WebKit e iPhone (Playwright)
npm run typecheck  # controllo tipi
npm run lint       # regole e formattazione del codice (Biome)
npm run format     # formatta il codice
npm run measure    # misura generatore e suggerimenti su tutte le griglie (qualche minuto)
npm run build      # crea dist/index.html, file unico da aprire con doppio clic o condividere
```

## Struttura

| File | Ruolo |
| --- | --- |
| `src/types.ts` | Tipi (`Rect`, `Clue`, `Puzzle`), limiti griglia 4–15, preset |
| `src/rng.ts` | Generatore casuale con seed |
| `src/generator.ts` | Partizione casuale + numeri; soluzione unica; profili e raffinamento per raggiungere la difficoltà chiesta |
| `src/solver.ts` | Conta le soluzioni con backtracking (si ferma a 2) |
| `src/grader.ts` | Misura la difficoltà risolvendo "come una persona" con regole graduate; trova la prossima deduzione per i suggerimenti |
| `src/share.ts` | Puzzle nel link: codifica degli indizi, soluzione e livello ricostruiti all'apertura |
| `src/selection.ts` | La selezione mentre si trascina: può partire anche da una casella in mezzo a un lato |
| `src/tutorial.ts` | Le griglie del tutorial, scritte a mano |
| `src/records.ts` | Record personali per griglia, livello e variante |
| `src/worker.ts` | Genera i puzzle in un Web Worker, senza bloccare la pagina |
| `src/game.ts` | Stato partita: posa/rimozione, annulla, suggerimenti (con il motivo), vittoria, cronometro |
| `src/hint-text.ts` | Le parole del suggerimento: nomi degli indizi ("il 6 verde"), frasi, passi delle spiegazioni |
| `src/ui.ts` | Rendering, input mouse/touch, azioni, tema, impostazioni, salvataggio, avvio |
| `src/keyboard.ts` | Gioco da tastiera: cursore, selezione, annunci per i lettori di schermo |
| `src/tutorial-panel.ts`, `src/records-dialog.ts` | Pannello del tutorial; tabella dei record |
| `src/loader.ts` | Animazione d'attesa mentre si genera un puzzle |
| `src/colors.ts`, `src/board.ts` | Tinte degli indizi; posizioni sulla griglia |
| `src/storage.ts`, `src/stored.ts` | Dati nel browser: lettura e scrittura sicure, controllo di ciò che si rilegge |
| `src/runner.ts` | Lavori nel Web Worker, con ripiego se il browser non lo permette |

La logica (`types`, `rng`, `generator`, `solver`, `grader`, `game`) non usa il DOM ed è coperta dai test in `tests/`.

## Come si gioca

Il pulsante **?** apre un tutorial di sette griglie piccole, una per regola: le regole del gioco, la casella che può raggiungere un solo numero, niente buchi, le ipotesi, le varianti Forme e Caselle nere. Si giocano sulla griglia vera, con il suggerimento come aiuto; uscendo si riprende la partita di prima.

## Aiuti

- **Suggerimento**: se ci sono rettangoli sbagliati li toglie e spiega perché (per esempio "l'8 verde vuole 8 caselle, qui ce ne sono 6" o "così il 4 blu non avrebbe più spazio"). Altrimenti aiuta a gradi: prima l'indizio da guardare, poi il ragionamento, poi posa il pezzo. Il ragionamento si vede sulla griglia **a passi**, una cosa per volta (ogni 3,5 secondi, o toccando la frase): "Proviamo il 6 rosso qui, nel tratteggio" → "Allora il 12 viola ha un posto solo: questo" → "Ma così l'8 verde non ha più spazio" → "Quindi il 6 rosso va nell'altro modo". I numeri si chiamano con il colore della loro pastiglia. Il pezzo è sempre uno a cui si arriva ragionando dai pezzi già posati, e fino a Esperto (nelle Forme fino a Difficile) ogni puzzle si risolve fino in fondo così. Tra un pezzo suggerito e il successivo devono passare 15 secondi (il pulsante mostra il conto alla rovescia); indizio e ragionamento restano sempre disponibili.
- **Suggerimento a Maestro e nelle Forme a Esperto**: lì il ragionamento sarebbe troppo lungo da mostrare, quindi il suggerimento è senza spiegazioni: toglie i rettangoli sbagliati oppure posa un pezzo.
- **Verifica**: dice solo se ci sono errori e quanti, senza indicarli.
- **Quanti aiuti**: a Facile suggerimenti e verifiche sono illimitati, poi calano col livello, uguali per ogni griglia e variante. I pulsanti mostrano quanti ne restano. Indizio e ragionamento non contano: conta il pezzo posato, o i rettangoli sbagliati tolti.

  | Livello | Suggerimenti | Verifiche |
  | --- | --- | --- |
  | Facile | illimitati | illimitate |
  | Medio | 5 | 5 |
  | Difficile | 4 | 3 |
  | Esperto | 3 | 2 |
  | Maestro | 2 | 1 |

## Tastiera

Frecce per muovere il cursore, Invio per fissare un angolo e poi per posare il rettangolo, Esc per annullare la selezione, Canc per togliere il rettangolo sotto il cursore, H per il suggerimento, Ctrl+Z per annullare. Un lettore di schermo annuncia casella, indizio e selezione.

## Partite, record e link

- La partita in corso si salva nel browser a ogni mossa: riaprendo la pagina si riprende da lì, con il tempo trascorso.
- Il cronometro parte quando la griglia è pronta e conta il tempo a pagina aperta: non si ferma con la scheda nascosta o il telefono bloccato, solo alla vittoria; a pagina chiusa si ferma e riprende dal tempo salvato.
- Mentre si genera un puzzle, la griglia vuota si ritaglia da sola in rettangoli colorati (tagli casuali, non la soluzione).
- Record personali (pulsante con la coppa): partite vinte, tempo migliore e tempo migliore senza aiuti, per griglia, livello e variante.
- **Condividi** copia un link (sul telefono apre il menu di condivisione): chi lo apre gioca lo stesso puzzle. Il link contiene gli indizi, non il seed, quindi non dipende dalla velocità del dispositivo né dalle versioni del generatore.

Tutto resta nel browser (`localStorage`): niente server, niente account.

## Aspetto

Ogni indizio è una pastiglia colorata con il numero in bianco, e il rettangolo giusto prende il suo colore. La forma della pastiglia dice il vincolo: cerchio = solo il numero, quadrato, rettangolino orizzontale o verticale, croce = non quadrato con verso libero, grigio col `?` = forma e area libere. I colori dipendono solo dalla posizione degli indizi (vicini con colori diversi), mai dalla soluzione.
Griglia, difficoltà, variante e tema stanno nel riquadro che si apre con l'ingranaggio o toccando la riga sotto il titolo con la scelta attuale (per esempio "10×10 · Difficile · Forme").

## Varianti

- **Classico**: ogni indizio è un numero, cioè l'area del suo rettangolo.
- **Forme**: un indizio può dire anche la forma, e area o forma possono restare aperte.
- **Caselle nere**: numeri come nel Classico, ma alcune caselle sono nere e non vanno coperte: i rettangoli ci girano attorno (l'8% fino a Difficile, il 3% a Esperto e Maestro, dove su 15×15 il livello si trova più di rado).

| Indizio | Significato |
| --- | --- |
| `6` | area 6, forma qualsiasi |
| `□ 4` | quadrato di area 4 (2×2) |
| `▭ 6` | rettangolo non quadrato di area 6, orizzontale o verticale (nel gioco il simbolo è una croce con le linee interne tratteggiate) |
| `▬ 6` | rettangolo orizzontale (più largo che alto) di area 6: 1×6 o 2×3 |
| `▮ 6` | rettangolo verticale (più alto che largo) di area 6: 6×1 o 3×2 |
| `□` / `▭` / `▬` / `▮` | forma fissa, area qualsiasi |
| `?` | forma e area qualsiasi |

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

## Sviluppo

- **Test**: `npm test` per la logica (Vitest, `tests/`), `npm run test:e2e` per l'interfaccia in Chromium, WebKit (Safari) e iPhone (Playwright, `e2e/`; la prima volta `npx playwright install chromium webkit`).
- **Stile**: `npm run lint` e `npm run format` (Biome).
- **Misure**: `npm run measure` rifà le misure di generatore e suggerimenti da cui vengono soglie e tempi.
- **CI** (GitHub Actions): ogni branch e pull request passano da stile, test, test dell'interfaccia e build; solo `main` viene pubblicato su GitHub Pages.
- **Versioni**: x.y.z in `package.json`, mostrata in fondo alla pagina, con il tag `vX.Y.Z` e la voce in [CHANGELOG.md](CHANGELOG.md).
- **Note di progetto**: decisioni, misure e motivi in [CLAUDE.md](CLAUDE.md).

## Licenza

[MIT](LICENSE): il codice si può riusare, modificare e ridistribuire, anche in altri progetti, purché resti la nota di copyright. Shikaku è il nome di un genere di rompicapo: la licenza riguarda questo codice, non il gioco.
