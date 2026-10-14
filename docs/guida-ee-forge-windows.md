# EE FORGE per Windows — guida all'installazione e all'uso

Per chi usa il programma: non servono Node, pnpm, WSL, il repository né EXODUS. Versione descritta: **0.7.0** (installer
`EE-FORGE-Setup-0.7.0-x64.exe`). Stato delle prove: vedi in fondo, «Cosa è stato collaudato».

## 1. Requisiti

- Windows 10 o 11, **64 bit (x64)**. Non sono compilati: Windows ARM, 32 bit, macOS, Linux.
- Circa 330 MB sul disco. Nessuna rete: il programma funziona offline dopo l'installazione.
- Nessun permesso di amministratore: l'installazione è **per utente**.
- Per ottenere immagini di pianeti/radar e per installare gli scenari serve una copia di **EmptyEpsilon** (2024.12.08 o 2026.09.22PR) sul PC.

## 2. Installare

1. Metti `EE-FORGE-Setup-0.7.0-x64.exe` e `SHA256SUMS.txt` nella stessa cartella. In PowerShell:
   `Get-FileHash .\EE-FORGE-Setup-0.7.0-x64.exe -Algorithm SHA256` — il valore deve coincidere con quello in `SHA256SUMS.txt`.
2. Doppio clic sull'installer. **L'installer non è firmato** (nessun certificato è stato acquistato): Windows SmartScreen può mostrare
   «Windows ha protetto il PC». Se l'hash coincide, scegli **Ulteriori informazioni → Esegui comunque**.
3. Scegli la cartella (predefinita `%LOCALAPPDATA%\Programs\EE FORGE`) e conferma. Vengono creati il collegamento nel menu Start
   e sul Desktop, con l'icona di EE FORGE, e la voce in «App installate».
4. Avvio: doppio clic sul collegamento. Non serve alcun terminale.

Installazione silenziosa (per un amministratore di sistema): `EE-FORGE-Setup-0.7.0-x64.exe /S`.

## 3. Dove stanno i tuoi dati

| Cosa | Dove |
|---|---|
| Progetti | `Documenti\EE FORGE\Projects` (si cambia da **Settings → Change projects folder…**) |
| Impostazioni, registro delle installazioni EE, immagini copiate da EE, rig DMX, **copie di sicurezza**, log | `%APPDATA%\EE FORGE` |
| Programma | `%LOCALAPPDATA%\Programs\EE FORGE` |

Aggiornare o disinstallare **non cancella** né i progetti né le impostazioni. Se «Documenti» è sincronizzato con OneDrive, anche i
progetti lo sono: è una scelta di Windows, non del programma.

## 4. Primo uso

1. **Installations… → Add EmptyEpsilon folder…** e scegli la cartella che contiene `EmptyEpsilon.exe`. La versione viene riconosciuta dai
   file del motore (`script_reference.html`), non dal nome della cartella. Una cartella non riconosciuta resta «non verificata» finché
   non dichiari tu la versione. Subito dopo la registrazione EE FORGE scansiona la cartella (puoi ripetere con **Rescan** dopo aver aggiunto texture o template a EmptyEpsilon): copia nel proprio spazio le immagini di pianeti, tracce radar e nebulose
   *della tua* installazione (il programma non le contiene: vedi §9).
2. **Import…** per portare una copia di un progetto esistente (scegli la cartella che contiene `project.json`): l'originale non viene
   mai modificato e non viene mai sovrascritto un progetto con lo stesso nome (la copia prende un nome libero). **+ New** ne crea uno nuovo.
3. Modifica sulla mappa, **Save**. Se chiudi la finestra, cambi progetto o importi con modifiche non salvate, il programma chiede
   *Save / Don't save / Cancel*.
4. **Fleet**: l'anteprima 3D mostra una sagoma generica con la scritta «Generic stand-in»: i modelli delle navi di EmptyEpsilon non sono
   inclusi (§9).

### Organizzare la mappa: settori, visibilità e blocco (Map)

La gerarchia è **Sector → Group → Object**. Un *Group* resta quello di prima (un insieme di oggetti con una modalità di comparsa:
*At mission start* o *When a rule spawns it*); un *Sector* è un modo di organizzare il lavoro, per esempio un sistema stellare o il
luogo raggiunto con un salto. **Shared** raccoglie ciò che più settori hanno in comune, come la nave del giocatore.

- **Sector (in alto nella colonna Scene):** scegli *All sectors* oppure un settore. Un settore mostra i propri gruppi, i propri
  marker e quelli *Shared*; sulla mappa, in alto a sinistra, una sigla dice cosa stai guardando. **+ Sector** crea un settore e lo
  apre; **Rename** e **×** stanno sull'intestazione di ciascun settore nell'elenco. Cancellare un settore **non cancella mai** ciò che
  contiene: se non è vuoto devi scegliere dove vanno i suoi gruppi e marker (un altro settore o Shared).
- **Dove sta un gruppo:** il menu sotto ogni gruppo (*Sector of group …*) lo sposta. Spostare un gruppo non cambia i suoi id, le
  coordinate, le proprietà, le regole e i dialoghi che lo nominano, né *At mission start / When a rule spawns it*, né l'ordine in cui
  viene generato. Anche i marker hanno il loro menu (nell'ispettore). Un **nuovo gruppo** va nel settore aperto; con *All sectors* devi
  scegliere tu la destinazione (nessuna è preselezionata); vale lo stesso per un marker.
- **Riferimenti tra settori:** *Used by*, *Go to it* e i link nei dialoghi aprono il settore giusto e selezionano l'elemento; un
  avviso sopra la mappa dice cosa è successo. Mentre scegli un punto o un oggetto sulla mappa per una regola, tutti i settori sono
  visibili.
- **Occhio, mirino, lucchetto (su ogni gruppo):** *Hide* toglie il gruppo dalla mappa (non si disegna, non si clicca, non entra nella
  selezione a rettangolo né in **Fit**); *Isolate* mostra solo quel gruppo e **Exit isolation** riporta esattamente la visibilità di
  prima; **Show all** rimette tutto nel settore che stai guardando. *Lock* lascia il gruppo visibile e consultabile ma non modificabile
  (né con il mouse, né con la tastiera, né dall'ispettore): l'ispettore dice perché i campi sono disabilitati. Un oggetto di un
  gruppo nascosto che raggiungi da un elenco resta selezionato ma **non si può modificare finché non lo mostri**; la mappa lo dice.
- **Cosa non fa:** nascondere nell'editor **non rimuove** gli oggetti dalla partita; cambiare settore nell'editor **non cambia il
  settore durante il gioco** (non esiste ancora «Change sector», né teletrasporto, né scaricamento o ripristino dello stato degli
  oggetti); *Destroy* può ancora soddisfare *Group wiped out*; un nuovo *Spawn group* ricrea gli oggetti dalle impostazioni iniziali.
- **Cosa viene salvato:** i settori e l'appartenenza di gruppi e marker stanno in `project.json` (sono un tuo modo di organizzare); quali
  gruppi sono nascosti, isolati o bloccati e quale settore è aperto restano **nell'editor**, ricordati per progetto: non rendono il
  progetto «unsaved», non finiscono nel Lua. Un progetto scritto da una versione precedente si apre con un solo settore («Sector 1») che
  contiene tutto; nulla viene dedotto dai nomi. La riorganizzazione non cambia il Lua esportato (cambia solo la riga di commento
  `-- sha256` con l'impronta di `project.json`).
- **Limiti noti:** in *All sectors* due sistemi sovrapposti nelle coordinate si disegnano uno sopra l'altro (è il motivo per cui
  esiste la vista per settore). *Esc* sulla mappa deseleziona e resta sulla mappa; durante la scelta di un riferimento (⌖) annulla e torna alla vista da cui eri partito.

### Cambiare settore durante la partita (Change sector)

Finora un settore era solo organizzazione. Diventa un concetto di gioco quando lo usi, e solo allora:

1. Nella colonna *Scene* clicca la bandierina di un settore («Start the game in …»): è il **settore iniziale della partita** (non quello
   aperto nell'editor). Con un settore iniziale, all'avvio si creano solo i gruppi *At mission start* di quel settore e quelli *Shared*.
   Senza (progetti precedenti, già migrati con «nessun settore iniziale») tutto funziona come prima e il Lua generato è identico.
2. In una regola (Mission → Rules) scegli l'azione **Change sector**: settore di destinazione, **marker d'arrivo** (deve stare nel
   settore di destinazione; se non ce n'è, aprilo sulla mappa e piazzane uno) e, se vuoi, la **rotazione d'arrivo** (vuota = la nave
   conserva la sua). Può essere attivata da qualsiasi regola, anche condizionata a un flag (una variabile). **Current sector is …**
   limita una regola al settore giusto.
3. Cosa succede: la nave giocatore resta la stessa, con danni e stato; gli oggetti **Shared** restano; gli oggetti del settore lasciato
   vengono **scaricati** (non distrutti: non contano come «Object destroyed» né «Group wiped out» e non fanno scattare vittorie);
   nel settore d'arrivo si creano i gruppi *At mission start* dalle impostazioni iniziali (quelli *When a rule spawns it* aspettano le
   loro regole); la nave va al marker. Tornando in un settore lo ritrovi **come all'inizio**: danni, nemici distrutti e avanzamento di
   quel settore non si conservano (richiederebbe un modello di persistenza a parte).
4. **Cosa non si azzera:** variabili globali e degli oggetti, regole già scattate (`once`), eventi temporizzati, orologio. Le azioni
   *dopo* Change sector nella stessa sequenza si eseguono (nel nuovo settore; ciò che è stato scaricato non c'è più); le **altre regole di
   quell'aggiornamento non vengono valutate**: ripartono al successivo, nel mondo nuovo. Cambiare verso il settore in cui già sei non fa
   nulla. Una richiesta non valida viene rifiutata prima di scaricare qualcosa; *Spawn group* di un settore inattivo viene rifiutato (riga nel
   log del motore); la build avvisa se una regola limitata al settore X fa comparire un gruppo del settore Y.
5. **Non si può cancellare** un settore che è quello iniziale o che una regola usa (l'editor dice quale regola).
6. **Mine, sonde e missili dell'equipaggio** non seguono il salto: chi usa Change sector ha un piccolo registro che ogni due secondi annota
   quelli sparati dalla nave giocatore, da un oggetto *Shared* o da un oggetto del settore corrente, e il salto li rimuove in silenzio
   (senza esplosioni né danni) prima di scaricare il settore: anche se il settore d'arrivo occupa le stesse coordinate, non ne trovi. Le
   munizioni non vengono restituite. Restano al loro posto, di proposito: oggetti di cui non si conosce il proprietario (una mina messa da
   un GM o da un altro script), gli effetti visivi, e il resto di una raffica di HVLI non ancora sparata (esce dai tubi nel settore
   d'arrivo). Uno sparo il cui proprietario muore entro due secondi non è registrato e resta.

### Salvare e riprendere una campagna (settori congelati)

Opzione **per progetto**, spenta di default: **Mission → Campaign → «Save the campaign (checkpoints) and keep every sector as it was left»**. Serve un settore iniziale
(la bandierina «Start the game in …»). Spenta, il Lua generato è quello di sempre.

1. **Cosa cambia con l'opzione accesa.** Un settore in cui la nave non c'è è **congelato**: nulla si muove, si ripara o combatte, e il suo orologio non scorre. Tornando
   lo ritrovi come l'hai lasciato: i nemici distrutti restano distrutti (non vengono ricostruiti, quindi nulla di ciò che avrebbero fatto si ripete), le stazioni
   danneggiate hanno i danni, gli oggetti mossi sono dove li hai lasciati, i gruppi «When a rule spawns it» mai chiamati restano assenti. Le ricompense e le
   regole già scattate non si ripetono. Un **timed event o una regola** può appartenere a un settore (nell'Inspector, *Belongs to*): corre solo mentre quel settore è
   attivo, sull'orologio di quel settore.
2. **Dove sono i salvataggi.** Nel file `scriptstorage.json` **nella cartella di EmptyEpsilon** (quella di `EmptyEpsilon.exe`; ogni installazione ha il suo).
   Lo scrive il gioco in esecuzione: Forge non deve restare aperto e EXODUS non c'entra. Copiare la cartella copia la campagna.
3. **Avviare / riprendere.** Prima dell'avvio EmptyEpsilon mostra l'impostazione **Campaign**: *Resume* (predefinita: riprende l'ultima campagna salvata di questo
   progetto; se il progetto non ne ha ancora, parte la prima e l'equipaggio ne è informato), *New* (campagna nuova: una salvata **non viene mai sovrascritta**, la nuova
   ha un suo numero) o *Off* (senza salvare).
4. **Salvare un checkpoint.** Il pulsante **Save checkpoint** sulla postazione Engineering (e sulla console GM), l'azione *Save checkpoint* per i momenti di storia;
   un checkpoint viene richiesto anche all'inizio di una campagna nuova e prima/dopo ogni Change sector. Dopo la chiusura di EE, riavviando con *Resume* la partita riprende
   dall'ultimo checkpoint: il tempo giocato dopo di esso va perso.
   **Cosa dice il messaggio.** «Checkpoint 3 sent to the save file. The game cannot confirm it reached the disk.» significa: il checkpoint è stato preparato e consegnato
   al salvataggio di EmptyEpsilon. EmptyEpsilon non dice allo script se la scrittura sul disco è riuscita (con il file in sola lettura la chiamata «riesce» lo stesso, e una
   rilettura può rispondere dalla memoria). Il gioco non scrive mai «saved» come fatto compiuto: la prova è il riavvio successivo, in cui la campagna c'è oppure il messaggio
   dice perché no.
5. **Una nave nuova.** Dopo un riavvio la nave giocatore è necessariamente **ricreata** dal progetto e riceve lo stato salvato (posizione, rotta, scafo, scudi, energia,
   sistemi, cursori di potenza e refrigerante dell'ingegnere, scorte, scorta di sonde). Non si conserva l'identità del processo.
6. **Cosa NON viene conservato** (osservato su EE 2024 e EE 2026, non solo dedotto dalle proprietà escluse):
   - **Velocità:** la nave torna dov'era, con la rotta di prima, **ferma**. Il percorso in corso e la richiesta d'impulso si perdono.
   - **Tubi e missili:** la scorta torna com'era al checkpoint. Un missile già **caricato in un tubo** non è nella scorta e non viene conservato: si perde, e i tubi tornano
     vuoti (anche l'avanzamento della ricarica).
   - **Mine, sonde e missili già lanciati** spariscono. La **scorta** di sonde torna; una sonda già nello spazio no.
   - **Attracco:** la nave torna dov'era ma **non attraccata**; l'equipaggio deve attraccare di nuovo.
   - **Scansioni:** un oggetto torna **non scansionato**, anche se l'equipaggio l'aveva scansionato; una scansione a metà si perde. Vale anche per gli oggetti di un settore
     quando la nave ci rientra.
   - **Impostazioni dell'equipaggio** che nessuna azione Forge ha dato (allarme, scudi alzati o abbassati, frequenza dei raggi, bersaglio selezionato): tornano ai valori
     di partenza dopo un riavvio. Nella stessa partita, anche attraverso un Change sector, la nave è la stessa e li conserva.
   - **Oggetti creati fuori dalla mappa** (da un GM, da uno script o da altri strumenti): spariscono.
   - **EXODUS:** stato e step non fanno parte del checkpoint.
   È un checkpoint della campagna, **non** un salvataggio completo della nave o del mondo.
7. **Una ripresa che non può avvenire non viene mai sostituita in silenzio.** Prima di arrendersi il gioco prova a recuperare: il checkpoint indicato dal puntatore; se è
   illeggibile, quello **precedente** (il messaggio dice quale numero è stato recuperato e quale è andato perso); se il puntatore stesso è illeggibile, il checkpoint
   leggibile con il numero più alto. Se non c'è nulla da recuperare, **la partita non parte**: nessun oggetto della campagna, nessuna regola, timer o ricompensa avanza, e nulla viene
   scritto. Esiste **una sola nave di servizio, «NO CAMPAIGN»** (EmptyEpsilon non mostra i messaggi generali nella schermata di scelta della nave, quindi senza una nave l'equipaggio non
   potrebbe leggere il motivo): la si seleziona, sulla sua postazione si legge il messaggio nel registro di bordo e dalla postazione **Engineering** si sceglie. L'equipaggio legge se il
   salvataggio è **danneggiato** o **incompatibile** (altra versione del formato, altra build di EE, progetto cambiato nella struttura: settori, gruppi, oggetti, regole, eventi, variabili)
   e che cosa fare:
   - premere **Start a NEW campaign** (Engineering della nave NO CAMPAIGN, oppure il GM dalla console): parte una campagna nuova accanto alla vecchia, che resta com'è; la nave di servizio
     sparisce (la sua schermata dice SHIP DESTROYED: premere Return e scegliere la nave della campagna); oppure
   - **chiudere la partita, tornare alla scelta dello scenario, scegliere di nuovo lo stesso scenario, impostare Campaign = New e avviare**; oppure
   - **Play without saving** (stessi due posti).
   Durante il blocco il gioco è fuori pausa (in pausa non girerebbe nessun aggiornamento, quindi nemmeno la scelta). Il promemoria è **una riga breve** (la postazione mostra
   un banner alto una riga e taglia il resto, misurato): la spiegazione completa è nel registro di bordo, per il GM e nel file.
   «Nessuna campagna precedente» è un'altra cosa: con *Resume* parte la prima e l'equipaggio legge «first start». Se è illeggibile l'**elenco** delle campagne, si può solo
   giocare senza salvare (una campagna nuova non potrebbe essere registrata senza distruggere l'elenco) e non si scrive nulla.
8. **Limiti di EmptyEpsilon (non di Forge).** Lo script non può leggere il file né sapere se una scrittura è arrivata sul disco. Se **tutto** `scriptstorage.json` è
   danneggiato, EmptyEpsilon lo presenta allo script come un archivio **vuoto**: per lo script è identico a una prima partenza, quindi il blocco di *Resume* **non** protegge da questo
   caso, e la scrittura successiva sostituisce il file, **con tutte le altre chiavi** (anche di altri strumenti). Le due copie di un checkpoint stanno nello stesso file:
   proteggono da una sequenza di scritture interrotta, non da un file rovinato.

#### Copia di sicurezza dei salvataggi (facoltativa)

Accanto a EE FORGE (cartella **Save backup tool**) c'è `forge-save-backup.ps1`, un'utilità per Windows PowerShell. Non è un servizio: non gira in sottofondo, non serve per giocare,
non richiede Forge aperto, EXODUS o altro. Funziona su un percorso che scegli tu e, in questa prima versione, **con EmptyEpsilon chiuso**.

- **Fare una copia:** `.\forge-save-backup.ps1 backup -Source "C:\EmptyEpsilon\scriptstorage.json" -BackupDir "D:\EE-backups"`. Ogni chiamata crea un **nuovo** file datato
  (`scriptstorage-AAAAMMGG-HHMMSS.json`); non ne sovrascrive mai uno vecchio. La copia vale solo se è JSON valido e identica a ciò che è stato letto; se il file sorgente è
  danneggiato non si crea nulla e le copie buone che hai restano com'erano. Il sorgente non viene mai modificato.
- **Vedere le copie:** `list -BackupDir …`; **controllare un file:** `check -Source …`.
- **Ripristinare:** `.\forge-save-backup.ps1 restore -Backup "D:\EE-backups\scriptstorage-….json" -Destination "C:\EmptyEpsilon\scriptstorage.json"`. Scegli tu sia la copia sia la
  destinazione; devi digitare `RESTORE`; il file che verrebbe sostituito viene conservato prima (`scriptstorage.before-restore-….json`); il ripristino è rifiutato se EmptyEpsilon è in
  esecuzione da quella cartella. Non viene mai applicato da solo.
- **Cosa non fa:** non protegge i progressi fatti **dopo** l'ultima copia; «JSON valido» **non** significa «campagna riprendibile» (lo decide lo scenario all'avvio); il file contiene anche
  le chiavi di altri strumenti, che con un ripristino tornano ai valori della copia.

## 5. Esportare

**Export…** → scegli 2024, 2026 oppure **entrambi** → scegli la cartella di destinazione. Per «entrambi» ottieni **due esportazioni distinte**
(`<progetto>\EE-2024.12.08\scripts\…` e `<progetto>\EE-2026.09.22PR\scripts\…`), ciascuna costruita con il catalogo del proprio motore, più
`export-report.json`. Il risultato indica quali **template e modelli** del progetto esistono solo dopo un riavvio di EmptyEpsilon.
L'esportazione vanilla non richiede EXODUS.

## 6. Installare lo scenario in EmptyEpsilon

Scegli l'installazione nel menu a tendina del gruppo «EmptyEpsilon» (seconda barra) e premi **Install scenario**. Prima di scrivere, il programma controlla:

- che la versione dell'installazione coincida con quella del progetto (altrimenti rifiuta);
- **file bloccati**: se un programma tiene aperto un file dello scenario, il controllo lo dice («HELD OPEN by another program»), il
  pulsante resta spento e **non viene scritto nulla**. Osservato su EE 2026 e 2024: **un EmptyEpsilon in esecuzione non tiene aperti i
  file dello scenario** (solo eseguibile, DLL, log e font), quindi di norma si può reinstallare anche a motore avviato; un file già
  caricato non cambia finché lo scenario non viene riavviato. Chiudi il programma che tiene il file e ripeti il controllo;
- **collisioni**: un file con lo stesso nome che EE FORGE non ha installato (o che hai modificato a mano dopo) non viene toccato:
  l'installazione è rifiutata e il file nominato. **Install anyway (back up first)** lo sostituisce *dopo* averne fatto una copia;
- **copia di sicurezza** di ogni file che sta per essere sostituito (e di `shipTemplates.lua`) in `%APPDATA%\EE FORGE\state\backups\…`;
- **ripristino**: se una scrittura fallisce a metà, tutto ciò che era stato scritto viene rimesso com'era e il messaggio dice
  «NOT installed … the install is as it was». Solo se anche il ripristino fallisse, il messaggio elenca i file da recuperare a mano dalla copia.

La scritta **«Installed N file(s)»** compare soltanto quando tutto è a posto. «Files copied but NOT active» significa che mancano
passaggi (per esempio la riga `require` in `shipTemplates.lua`). **Template e modelli** si caricano solo all'avvio di EmptyEpsilon:
dopo l'installazione il messaggio dice «Restart EmptyEpsilon: ship templates (…) and models (…)». Gli scenari senza template né modelli
non richiedono il riavvio.

## 7. EXODUS (facoltativo)

EXODUS è **spento** e non è necessario. In **Settings → Choose module…** puoi indicare un modulo EXODUS tuo e accenderlo. **Limite noto:**
**EE 2024 + il bridge EXODUS reale non è verificato ed è segnalato come incompatibile** (il bridge non riesce a dialogare con quel motore);
l'installer non cambia questo. Il percorso vanilla non ne risente.

## 8. Aggiornare e disinstallare

- **Aggiornare:** esegui l'installer della versione nuova sopra la vecchia. Progetti e impostazioni restano.
- **Disinstallare:** «App installate» → EE FORGE → Disinstalla (oppure `Uninstall EE FORGE.exe`). Rimuove programma, collegamenti e voce
  del registro; **lascia** `Documenti\EE FORGE` e `%APPDATA%\EE FORGE`. Per cancellare anche quelli, elimina le due cartelle.

## 9. Licenze e immagini

Il programma include librerie di terze parti (elenco e testi delle licenze in `THIRD-PARTY-NOTICES.txt`, accanto al programma, più
`LICENSE.electron.txt` e `LICENSES.chromium.html`). **Non include nessuna immagine né modello 3D di EmptyEpsilon**: i pacchetti dei
modelli delle navi hanno licenze (TurboSquid, CGTrader) che ne vietano la ridistribuzione, e per il resto la licenza non è documentata
nel progetto. Le immagini vengono copiate dalla *tua* installazione con **Rescan**; senza, la mappa usa forme semplici e l'anteprima
3D una sagoma generica. La licenza di EE FORGE stesso non è stata scelta dall'autore e non è dichiarata qui.

## 10. Problemi comuni

| Sintomo | Causa e rimedio |
|---|---|
| SmartScreen blocca l'installer | Non è firmato. Verifica l'hash (§2) e scegli «Esegui comunque». |
| L'antivirus segnala il programma | Programma non firmato basato su Electron: è un falso positivo comune; controlla l'hash. |
| «HELD OPEN by another program» | Un altro programma (non di norma EmptyEpsilon) tiene il file: chiudilo e ripeti il controllo. |
| «NOT installed — … were not installed by EE FORGE» | Esiste un file con lo stesso nome non creato da EE FORGE: guardalo, poi **Install anyway** se vuoi sostituirlo (c'è la copia). |
| I template/modelli non compaiono in EE | Vanno caricati all'avvio: riavvia EmptyEpsilon; controlla anche che `shipTemplates.lua` contenga la riga `require("shiptemplates/<progetto>_templates.lua")`. |
| Mappa senza icone né texture | Registra l'installazione EE (§4); se l'hai già fatto premi **Rescan**. Alcune texture esistono solo in EE 2024 (`sun.png`, `Planet-green*.png`, `ice-planet.png`): un progetto che le cita con un'installazione 2026 non le trova, perché in EE 2026 non esistono. |
| «Generic stand-in» al posto della nave | Atteso: i modelli di EmptyEpsilon non sono inclusi. |
| «No usable install scan» | Manca l'installazione registrata o la scansione: **Installations… → Rescan**. |
| La finestra non si chiude | Probabile domanda sulle modifiche non salvate (Save / Don't save / Cancel). |
| Dove sono i log? | `%APPDATA%\EE FORGE\logs\forge.log`. |

## 11. Cosa è stato collaudato

**Versione 0.7.0 (collaudo finale, 10 ottobre 2026)** — vedi `docs/design/forge-collaudo-finale.md`: il programma **impacchettato** (estratto
dall'installer, profilo isolato) con le finestre native reali, un'autoria completa nella GUI giocata in EmptyEpsilon 2024.12.08 e
2026.09.22PR su copie isolate, installazione con EE avviato e con un blocco reale di un file, EXODUS 2026 con bridge reale, prestazioni e
quattro risoluzioni. **Non** è stata provata la *procedura dell'installer* della 0.7.0 (su questo PC c'è già l'EE FORGE dell'utente) né
DPI reale, Windows 10, tocco e lettori di schermo.

**Versione 0.6.0 / 0.6.1 (collaudo precedente)**

Provato su **Windows 11 Pro 10.0.26200 x64** con l'installer reale, il programma avviato dal collegamento, e le **finestre native di Windows**
per scegliere cartelle e file (azionate con messaggi Win32, non simulate): installazione silenziosa, avvio dall'icona, import (annullato e
confermato), modifica, salvataggio, chiusura con domanda, riapertura, registrazione dell'installazione, esportazione per i due motori,
installazione dello scenario (riuscita, già aggiornata, file bloccato, collisione, ripristino dopo errore), modulo EXODUS opzionale,
aggiornamento 0.6.0 → 0.6.1 e disinstallazione con i progetti conservati.
**Non collaudato:** la procedura guidata dell'installer *con interfaccia* (è stata provata solo l'installazione silenziosa `/S`), una macchina Windows *pulita* o una VM (qui non c'era; la procedura è in `docs/verification/windows-clean-test.md`),
Windows 10, ARM, più monitor/DPI, installazione sotto `C:\Program Files`, antivirus di terze parti, un EmptyEpsilon reale in esecuzione
(il file bloccato è stato simulato con un blocco esclusivo di Windows su una copia di prova) e EE 2024 + bridge EXODUS reale.
