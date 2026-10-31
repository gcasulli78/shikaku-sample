# Registro delle modifiche

Le versioni seguono lo schema x.y.z: la **y** sale con una funzione nuova, la **z** con una correzione o un ritocco. Ogni versione ha il suo tag git (`v0.4.3`…), e la versione in gioco si legge in fondo alla pagina.

## [Non ancora pubblicato]

## [0.4.7] - 2026-10-31

### Cambiato
- Il codice dell'interfaccia è diviso in moduli più piccoli; le frasi dei suggerimenti hanno ora i loro test. Il gioco non cambia.

## [0.4.6] - 2026-10-31

### Aggiunto
- `npm run measure`: le misure di generatore e suggerimenti da cui vengono soglie e tempi, ripetibili.

## [0.4.5] - 2026-10-31

### Aggiunto
- Regole e formattazione del codice controllate da Biome (`npm run lint`), anche nella CI.

### Cambiato
- La CI non si avvia più per i tag delle versioni.

## [0.4.4] - 2026-10-31

### Aggiunto
- Questo registro e i tag git delle versioni.
- La CI gira anche sugli altri branch e sulle pull request; pubblica solo da `main`.

## [0.4.3] - 2026-10-31

### Aggiunto
- Test dell'interfaccia con Playwright (`e2e/`, `npm run test:e2e`) su Chromium, WebKit (Safari) e iPhone, eseguiti anche nella CI prima di pubblicare.

### Corretto
- Sui browser senza `oklch()` (Safari prima di 15.4, Firefox prima di 113) pastiglie e rettangoli restavano trasparenti e il numero bianco spariva: ora prendono tinte HSL equivalenti.

## [0.4.2] - 2026-10-31

### Cambiato
- Favicon con tre rettangoli nei colori del gioco.

## [0.4.1] - 2026-10-31

### Cambiato
- Il cronometro parte al caricamento della griglia e conta il tempo a pagina aperta: non si ferma più con la scheda nascosta o il telefono bloccato, solo alla vittoria. A pagina chiusa si riprende dal tempo salvato.

## [0.4.0] - 2026-10-31

### Aggiunto
- Animazione d'attesa: mentre si genera un puzzle la griglia si ritaglia da sola in rettangoli colorati; all'arrivo i numeri entrano a onda.

## [0.3.0] - 2026-10-31

### Aggiunto
- Fino a Esperto (Forme fino a Difficile) ogni puzzle si risolve fino in fondo con le sole deduzioni del suggerimento.
- A Maestro e nelle Forme a Esperto il suggerimento si usa al massimo 2 volte a partita, senza spiegazioni.

### Cambiato
- Tempo di generazione di Difficile da 1,5 a 3 s.

## [0.2.1] - 2026-10-31

### Cambiato
- La spiegazione del suggerimento va a passi, una cosa per volta, e chiama i numeri con il colore della pastiglia ("il 6 verde").

## [0.2.0] - 2026-10-29

### Aggiunto
- La versione in fondo alla pagina.

### Cambiato
- Spiegazioni del suggerimento che si vedono sulla griglia, senza passi nascosti; un rettangolo sbagliato senza motivo visibile viene sostituito da quello giusto.

## [0.1.0] - 2026-10-29

Prima versione, sviluppata dal 27 al 29 ottobre.

### Aggiunto
- Puzzle generati con soluzione unica e cinque livelli (Facile, Medio, Difficile, Esperto, Maestro) misurati da un valutatore "come una persona"; generazione in un Web Worker, con il prossimo Esperto o Maestro preparato in anticipo.
- Varianti Forme e Caselle nere.
- Suggerimento a gradi con il motivo, Verifica, Annulla; 15 s tra un pezzo suggerito e l'altro.
- Partita salvata, record personali, link condivisibile.
- Gioco da tastiera e annunci per i lettori di schermo; tutorial "Come si gioca".
- Grafica con indizi a pastiglia colorata, tema chiaro e scuro.
- Pubblicazione su GitHub Pages con GitHub Actions; file unico che funziona anche aperto con doppio clic.

### Sicurezza
- Dati salvati nel browser sempre controllati, link aperti nel Worker con un limite di tempo, Content Security Policy.

[Non ancora pubblicato]: https://github.com/gcasulli78/shikaku-sample/compare/v0.4.7...HEAD
[0.4.7]: https://github.com/gcasulli78/shikaku-sample/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/gcasulli78/shikaku-sample/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/gcasulli78/shikaku-sample/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/gcasulli78/shikaku-sample/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/gcasulli78/shikaku-sample/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/gcasulli78/shikaku-sample/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/gcasulli78/shikaku-sample/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/gcasulli78/shikaku-sample/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/gcasulli78/shikaku-sample/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/gcasulli78/shikaku-sample/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/gcasulli78/shikaku-sample/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gcasulli78/shikaku-sample/releases/tag/v0.1.0
