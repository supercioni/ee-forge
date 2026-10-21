# New ships from the editor to the game — verification (21 October 2026)

Decision: [ADR-0059](../../adr/0059-a-ship-must-spawn-a-template-that-exists.md). The engine half is `scripts/template-ship/play.mjs`; the window half (Electron driver `run-template-ship.mjs`) and `run-all.sh` live in the EXODUS_EE2026 workspace this was authored in, not in this repository. Reproduce there with `scripts/template-ship/run-all.sh 2026|2024`
(needs the isolated clones `C:\ForgeCollaudo\T\e26` and `e24` — copies of the two installs with the user's own extra templates removed, ports
19999/19600 and 18080/19601 (2024's executable patched in the copy), `hardware.ini` removed from the 2024 copy so no serial device is opened).
The user's EmptyEpsilon, Forge, projects and games were not opened or changed.

## Cause (reproduced before touching code — `before-fix/`)
Copy Atlantis → rename the copy → "Move these 1 to …" → Verify (0 errors, 1 warning) → Install scenario ("Installed — every file written and read back").
The install was right (templates file, `require` line, load order, restart notice). The ship named the copy's **old** name — the offer remembered the name
and the rename came in between — so it spawned a template nobody defines. EE 2026: hollow `FA-01` (no hull/engines/shields) and the map stops there
(`FB-01` never built); EE 2024: `FA-01` not created. Nothing in the log. The same project without that ship loaded and played on 2026 (template B alone: hull 321).

## Fix
Offer held by id; an object naming a template that exists nowhere is a blocking error in the build and in Problems; the project's own installed templates file
is not evidence; manual export writes `INSTALL.txt` and the dialog shows the exact steps/line. Tests: `forge-core/test/template-references.test.ts` (7),
`web-forge/test/scene-store.test.ts` (+2), `forge-app/test/install-scenario.test.ts` (+3).

## Runs (window = Electron, real clicks; engine = headless clone, station commands over HTTP)
| step | EE 2026 | EE 2024 |
|---|---|---|
| A+B authored in the window, saved, app closed and reopened, Verify, Install scenario | 13/13 | 13/13 |
| engine restarted from cold, ships played | 21/21 | 21/21 |
| C: edit template A in the window, Install again (backup of the previous file, one `require`), engine restarted | 7/7, 21/21 | 7/7, 21/21 |
| D: install again, nothing changed (`shipTemplates.lua` byte-identical, nothing written, no restart asked) | 7/7 | 7/7 |
| E: scenario with no templates (3 files, `shipTemplates.lua` untouched, no restart), played | 6/6, 10/10 | 6/6, 10/10 |

Expected → observed (identical on both engines; "api" = getters, "behaviour" = measured in play):
| property | A "Atlantis Forge A" (copy of Atlantis) | B "Scout Forge B" (new) |
|---|---|---|
| template name resolved by the engine (`getTypeName`) | Atlantis Forge A ✔ | Scout Forge B ✔ |
| hull | 777 → 777 (after C: 888 → 888) | 321 → 321 |
| impulse speed | 123 → api 123; cruising speed measured **123.0** | 140 → 140; measured **140.0** |
| rotation speed | 44 → 44; measured turn rate **44.0°/s** | 33 → 33; measured **33.0°/s** |
| beam 0 range / damage | 2222 / 25 → 2222 / 25 (after C: 31 → 31) | 3000 / 14 → 3000 / 14 |
| first hit on a shield-less target | 33 = beam 0 (25; after C 31) + beam 1 (8, untouched original value) → 33 (after C 39) | 14 → 14 |
| shield 1 | (original) 200, 5 tubes, jump drive kept → ✔ | 111 → 111 |
| model (EE 2026 `mesh_render.mesh`) | battleship_destroyer_1_upgraded ✔ | small_frigate_1 ✔ |
| engine log | no missing model, duplicate template or script error | same |
Plain scenario (stock Atlantis): 250 / 90 / 10 / beam 1500·8 → observed the same, hit 16 (2 beams × 8).
Per-step reports and screenshots stay in the EXODUS_EE2026 workspace; `project/` holds the two final project documents.

## Regression
Electron suite (`e2e/run.mjs`, includes Export through the IPC): **585/585** (kept in the EXODUS_EE2026 workspace). Its stand-in installs now also declare the originals the demonstration
project spawns (a project spawning an undefined template is an error since ADR-0059; without it 6 checks failed for that reason only). Unit: forge-app 54, web-forge 218,
forge-desktop 39, forge-core 749/750 — the one failure is `scan.test.ts` ("reports the fields it could not read"): the user's EE 2026 install carries an extra
`serata_spazio_templates.lua`, a third scan warning; it fails the same without this work.

## Not verified / limits
- **Deck plan and 3D appearance in a crew window**: not looked at in a running client. The deck plan (rooms) survives in the saved project and the template file
  (A keeps 5 tubes, shields and jump drive), but the Engineering screen was not opened. The model was read by API on EE 2026 only; EE 2024 has no getter, so there it is unchecked.
- Movement/weapons were driven by the engine's station commands (`commandImpulse`, `commandTargetRotation`, `commandSetTarget`), not by a person at a crew station; a missile tube was not fired.
- The window creates EE 2026 projects only; the 2024 project was a document with the other target placed in the profile (how the earlier acceptance did it), everything after was the window.
- Install while EE is running (locked file): covered by the earlier acceptance (`docs/verification/collaudo-finale/run-collaudo-A5-*`) and `install.test.ts`; not repeated with these ships.
- A template whose name is built by a Lua loop or a script the scan cannot read now needs a scan of an install that defines it by name.
