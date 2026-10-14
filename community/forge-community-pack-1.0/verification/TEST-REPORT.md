# Community pack verification — 14 October 2026

Scope: **The Lantern Route**, community pack 1.0, authored for Forge 0.9.0 / project schema 5.
This report concerns the files identified by `build-checks.json` and `SHA256SUMS.txt`, not an earlier draft.

## Offline checks

- Both target projects parse against the real Forge schema and build in vanilla mode against their matching catalogs and scanned libraries.
- Each export has exactly three portable Lua files and **zero build warnings**. No custom template/model, EXODUS action or external service is required.
- A fresh rebuild is byte-identical to the packaged Lua. The editable documents differ only in `eeVersion`.
- **23 explicit checks passed** (11 for 2024, 12 for 2026, the extra check compares the two documents): references, portable output, no premature victory, player/port/relay defeat, delivery-to-victory logic, dialogue guards, and a simulated round trip retaining kills without false victory.
- Simulation tests inject events or test-only timed actions. They are not represented as combat or dialogue playtests. The distributed projects contain none of those test fixtures.

Machine-readable details: `build-checks.json`, `offline-checks.json`.

## Real engines

**10/10 checks passed on each engine**. See `live-2024.json` and `live-2026.json` for the individual results.
The test uses dedicated headless Windows engine copies and their HTTP command interface. HTTP is a test tool only; it is not a requirement of the distributed mission.

The end-to-end route checks initial spawning, native station comms, outbound travel, native weapon destruction of both raiders, a checkpoint file on disk, return travel, a revisit with dead enemies remaining absent, a second return, a real process stop/restart, and delivery through comms ending the scenario.

No enemy is destroyed by a script, no mission flag is forced, and no victory or GM callback is invoked by the driver. Helm and weapons commands are automated rather than clicked by a human. The final end-state check observes the scenario clock stop after the guarded delivery action; it does not inspect a rendered Victory screen.

The EE 2024 test executable is byte-identical to the installed 2024 executable (SHA-256 recorded in `engine-evidence.json`); **it was not port-patched in this trial**. It used the normal multiplayer port with no other EE running, and a dedicated HTTP port. EE 2026 used its configurable separate server port. Both engines ran from private copies, and the user's originals were not modified. The targets are exactly EE-2024.12.08 and EE-2026.09.22PR.

## Browser and manual

The 2026 editable project was opened in Forge's standalone browser mode, using an isolated projects folder and state directory. Its matching engine library was scanned read-only. Verify reported **0 errors, 0 warnings, current**. Map, Mission, Campaign and Dialogues screenshots were captured at 1500 × 1000 and inspected. The examined page had no horizontal overflow or broken images, and Save remained disabled after navigation.

The English guide is included as Markdown, offline HTML and a **22-page PDF**. All four images loaded in HTML. The PDF's text was extracted for inspection; cover, contents, rules and campaign pages were visually inspected. This is documentation validation, not a comprehensive accessibility or print-production audit.

## Draft and harness issues resolved before packaging

The reconstructed draft initially had the station dialogue under the wrong data key; the attachment was corrected and is now explicitly tested. The driver initially answered comms before the conversation was open; it now waits for the engine's open state. EE 2026 does not return boolean HTTP results in the same way as EE 2024, so the driver uses explicit string markers.

The first combat design used moving attackers; the simple automated pilot did not reliably destroy them on 2024. The published teaching mission instead uses two close-range defenders ordered to stand their ground. Tests of the earlier layout are not counted as evidence for the final layout.

One engine log on 2024 contains the generated loader's caught `comms_station.lua` nil `comms_target` message at startup. Forge preloads stock station-service definitions under `pcall` before a hail. This report does **not** claim a completely error-free engine log. Mission progression nevertheless completed in the live route. Stock station-service transactions were not exercised in this mission's live trial.

## Not established by these tests

- A full session played by a human crew; the suggested 15–25 minutes is an estimate and difficulty is not user-tested.
- Live combat-caused destruction of each protected object; the loss rules were exercised in the simulator.
- The installer procedure, a clean Windows machine, DPI settings, touch, screen readers or physical DMX hardware.
- Compatibility with every future prerelease, modded ship library, or campaign transfer across engines/builds.
- Perfect save fidelity, crash-safe disk writes or every resume edge case. The guide describes the known limited persistence contract.

No installer was rebuilt, no changes were committed, and the user's Forge installation and original projects were left alone. This pack contains new documents, new project data and generated scenario files; it does not change Forge's application code.
