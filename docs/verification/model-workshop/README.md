# Model workshop verification — 21 October 2026

Scope: the standalone repository `ee-forge`, development build. Original EXODUS, EE installations and the installed Forge application were not modified. Existing version 0.9.1 edits in the root/desktop manifests and changelog were preserved. No commit or installer rebuild.

## Implemented and exercised

- Fleet → Hull: installed/project model selection, complete ModelData copy, independent names, shared-model warning, editable scale/radius/collision box/render offset, engine origin/RGB/size and beam/tube origins.
- Actual mesh preview from the installation cache or project resources. Orbit, fixed camera during edits, fit and direction buttons, collision overlays and selectable markers. Numeric editing remains the authoritative input; markers are not drag handles.
- OBJ + PNG/JPG import into the project document. Triangulation/positive indices, namespaces and binary export/install. Existing transactional install handles resource collisions and rollback.
- Complete stock ModelData scan including literal colour lists and numeric families: 133 definitions on EE 2024 and 141 on EE 2026 in the inspected installations. No model-definition/resource warnings on those scans.
- Browser: copied `small_fighter_1`, imported a purpose-built OBJ/PNG, edited scale to 2.5, radius to 40 and one engine origin to (-8, 3, 0), size 2; saved, reloaded and reopened the template. Embedded resource bytes and edits persisted. Screenshots inspected at 1600×1000 and 900×600; body width did not exceed the viewport. Long resource-path inputs scroll internally. At 900px, controls stack below the preview and require vertical scrolling.
- Electron on Linux/WSLg: opened the saved imported mesh without any registered EE installation, displayed its embedded texture under the application CSP, imported another OBJ/PNG and saved via the normal desktop transport. The native OS chooser itself was not driven: automation supplies selected files to the HTML file input. Software WebGL was enabled for this test only.
- Service export regression: both vanilla targets receive identical binary image bytes at the resources destination and include manual installation instructions. A separate mixed-project export correctly refused 2024 because an unused copied 2026 model contained `normalMap`; 2026 succeeded. No settings were silently dropped.

## Real engines: what this proves

The imported model saved from the GUI was assigned to a fully copied Atlantis player template and installed through `installBuild` into **existing isolated clones only**, `C:\ForgeCollaudo\T\e24` and `e26`. Each bundle contains three scenario scripts, a launch-time model/template file, an OBJ and a PNG. The template registration was applied by the normal installer with its ledger/backups.

Both engines were cold-started headless, one at a time, with dedicated HTTP ports 19824/19826. The test refuses to start while any EE process is running and stops only its own process afterward.

| Engine | Observed ship | Hull / impulse max | Position after approximately 15 seconds |
|---|---|---|---|
| EE 2024.12.08 clone | MODEL-TRIAL / Model Workshop Ship | 250 / 90 | (1169.32, 0) |
| EE 2026.09.22PR clone | MODEL-TRIAL / Model Workshop Ship | 250 / 90 | (1190.87, 0) |

These prove launch-time registration, scenario loading, player-template resolution and movement. **They do not prove visual rendering of the mesh or engine particles inside EE**: the engine runs were headless. The visual checks were in Forge's browser/Electron preview. The 2026 log captured by this build contains only startup lines, so it is not evidence of a full clean Lua log. The 2024 log includes the pre-existing missing `logs/` directory warning.

The 2024 clone uses the previously modified executable with a separate game port. SHA-256: `ee63c166c9f288bde4335ae98e87e7116f5c9ee1aa538727498c8781599b9923`; original executable SHA-256: `f976e175b2b905474b398e9b110d37a7388dd49e2c4c0dc246181dd5643886d5`. The original was only read.

An earlier trial converted the demo's CPU template to a player template; its missing player settings left it stationary on 2026 despite a valid impulse maximum. Repeating with a complete Atlantis copy moved correctly on both engines. This is a trial-fixture correction, not a claimed product fix. The user guide therefore recommends starting from a player template when authoring a player ship.

## Automated checks

See `checks.txt` for final commands and counts. Regressions cover full scanner definitions, literal loop expansion/concatenation, both catalogs, normal-map incompatibility, embedded bytes, traversal/collision rejection, rollback, cache freshness, model copying/renaming/inheritance, stale import rejection, OBJ/EE coordinate conversion and the application export service.

The existing scan test assumes an unmodified official 2026 script set and exactly two known warnings. The user's installation contains `serata_spazio_templates.lua`, adding a third, unrelated warning. Full tests were run with `EE_DIR=/tmp/forge-stock-2026`: a copy of the scripts with only that personal template and its require removed, plus read-only resource/pack links. The user's installation and the test assertion were not changed. The DMX hardware test is skipped in this fixture because it has no hardware.ini; DMX is outside this change.

## GitNexus and procedural limits

The index was generated at the start. Before changing existing production symbols: `emitModel` reported HIGH (emitTemplates/build/CLI flows); this was communicated. ProjectTemplate and CLI/service methods reported LOW. Several core calls, including build/install/scanning, returned **partial** results because the pool adapter was read-only; these are not reliable zero-impact results. Direct callers were also inspected in code.

New model functions are not yet in the index and impact queries return UNKNOWN. One framing adjustment to the newly added ModelViewport was made before querying that new symbol; the subsequent UNKNOWN result does not constitute a preventive analysis. No commit was performed, and no claim is made that a cumulative LOW impact closes the changes.

## Reproduction and remaining checks

After building the repo, `node docs/verification/model-workshop/prepare-trial.mjs` prepares the two **specified isolated clones**, using the included fixture project and the Atlantis template scanned from each clone. It writes only those clones and `/tmp/forge-model-trial/engine`. Run `run-trial.ps1 e24 19824` / `run-trial.ps1 e26 19826` on Windows after copying the script into the trial area. Do not point this procedure at an original installation. The fixture contains the custom OBJ/PNG bytes recovered from the isolated trial installation, with the saved GUI model parameters; it does not redistribute stock meshes.

Still unverified: EE's visible 3D/particle rendering with the custom model, a Windows Electron run of this feature, native chooser interaction, installer packaging/update, and large imported assets near the limits. GLB/glTF/MTL and multiple-material assignment are unsupported; normal maps require 2026. The previous GUI-wide Electron suite was not rerun as a claim of coverage for the new workshop; the targeted real Electron session and automated suites above are the evidence.

Images: `browser-imported.png`, `browser-900.png`, `electron-imported.png`. Runtime reports: `engine-2024.json`, `engine-2026.json`, `engine-install.json`.
