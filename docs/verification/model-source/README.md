# Model source and archive resources — verification, 22 October 2026

Development build of `ee-forge` (0.9.2 sources plus the work in [ADR-0061](../../adr/0061-model-source-and-live-archive-resources.md)). No commit, no installer, installed application untouched. EE installations were only read; the engine runs used the existing isolated clones `C:\ForgeCollaudo\T\e24` and `e26`. Pre-existing uncommitted 0.9.2 edits were preserved.

## Problem reproduced and cause

On the real installations the 0.9.2 scan did find archived resources, but: it copied every referenced file out of the packs into a per-installation cache (whole archives read into memory); it judged availability from an index written at scan time; and the installation that supplied the preview was never a choice — it was the project engine's newest scan, or the toolbar installation (the *install destination*). Fleet therefore could not show 2024 models in a 2026 project, two installations of one version could be confused, and nothing compared source with destination. Real data behind the design: 115 of 133 models on 2024 and 125 of 141 on 2026 have **all** their files only in archives; the same texture name often holds different bytes in the two engines (116 models differ), e.g. `small_fighter_1_color.jpg`, and `LindwurmFighterBlue` lives in `msgamedev.pack` on 2024 but `msgamedev-2.pack` on 2026 with different mesh bytes.

## Models and archives actually exercised

| Installation | Model | Mesh / texture (inside the archive; no loose copy exists) | Archive |
|---|---|---|---|
| EE 2026.09.22PR `C:\EE_2026\EmptyEpsilon` | `LindwurmFighterBlue` | `LindwurmFighter/LindwurmFighterHull.model`, `…/AlbedoAO/LindwurmFighterBlueAlbedoAO.png`, `…PBRSpecular.png`, `…Illumination.png`, `…Normal.png` | `packs/msgamedev-2.pack` (mesh at offset 3223, 100228 bytes) |
| EE 2024.12.08 `C:\Win32_EmptyEpsilon_EE-2024.12.08\EmptyEpsilon` | `LindwurmFighterBlue` | same names, four files (no normal map) | `packs/msgamedev.pack` (mesh at offset 49784489, 100228 bytes) |
| both | `small_fighter_1` | `small_fighter_1.model`, `small_fighter_1_color.jpg` | `packs/Angryfly.pack` (texture bytes differ per installation) |
| 2026 | `astroid_1` (2026-only, has a normal map) | `Astroid_1.model`, `Astroid_1_d.png`, `_n.png` | `packs/Asteroids.pack` |

## Real Electron app (Linux/WSLg, built `dist`, isolated userData) — `run-electron.mjs`, 47/47

Preview uses the archive, not a loose copy or earlier cache: the bytes the app serves are compared (SHA-256) with the range cut out of the pack by an **independent** parser in the test script; no loose file exists; Forge's cache contains no model files. Screenshots in `screens/` were inspected: the textured Lindwurm (blue hull), the dark small fighter with red details (matches the JPEG extracted from the pack), the asteroid, red/green cubes.

- Select → Customise → scale 2.5, radius 45, extra engine → Save → project file holds archive references, edits, `origin`, and no machine path; **restart the app** → the remembered source and the model resolve again, document not dirty (2026, and again for 2024: scale 3.5/radius 55).
- **2026 → 2024 → 2026**: the preview switches to each installation's own archive and bytes; project target, document bytes on disk and the dirty flag unchanged; the install-destination selector untouched.
- **Two installations of one version** (stand-ins identified by the real 2026 script reference; texture only inside their own pack): red vs green, different bytes, no contamination; the document unchanged.
- **Selection persists** across restart; **source unavailable** (folder renamed): reported, stays chosen, no fallback to 2026 or the newest scan, choosing another recovers.
- **Faults**: missing mesh, missing texture, truncated archive (reported as unreadable), unsupported format (`.tga`): each reported with the reason, no preview, no stand-in. **Stale**: a texture deleted behind Forge's back is reported missing on the next view.
- **Source/destination**: with a 2024 project, a 2026-only model is preview-only and not assigned; after Customise the 2026 normal map is refused for 2024; after removing it the install is allowed with a *different content* warning; a model whose mesh exists only in the source blocks the install and names `probe.obj`. Two installations of 2026 registered → nothing chosen for the author.
- A 404 for `radar/ship.png` (a pre-existing thumbnail request) is the only non-OK response; no renderer errors.

## Browser mode (Forge's HTTP server, Chrome 148) — `run-browser.mjs`, 9/9

The same: nothing pre-chosen with two 2026 installations, 2026 and 2024 archives, document unchanged, twin bytes, selection kept across a reload, vanished source reported with no fallback.

## Engine clones — export/install and cold start (`prepare-engine-trial.mjs`, `run-engine-trial.ps1`)

For each clone the project (a complete Atlantis copy as player ship, using a customised copy of `LindwurmFighterBlue`: scale 3.5, radius 55, an extra engine) was built and installed through the real service: destination check (every referenced mesh/texture found in the clone's packs: 0 warnings), transactional install with ledger; no stock asset was copied or shipped (`resources shipped: 0`). Each engine was then cold-started headless, one at a time, and queried over its HTTP API:

| Engine | Player ship | Hull / impulse | Position after ~10 s |
|---|---|---|---|
| EE 2024.12.08 clone | ARCHIVE-TRIAL / Archive Ship | 250 / 90 | (708.5, 0) |
| EE 2026.09.22PR clone | ARCHIVE-TRIAL / Archive Ship | 250 / 90 | (719.0, 0) |

`archive-trial-e24.json` / `e26.json` hold the logs (the 2024 log lists unused models — ours is not among them; its only warning is the pre-existing missing `logs/` folder).

## Not proven / limits

- **Load proof, not visual proof.** The engine runs are headless: they prove registration, loading of the scenario and templates, and movement — not that EmptyEpsilon drew this mesh and texture. A windowed capture was attempted and abandoned (no EE window appeared; the capture had also taken the user's whole desktop, so it was deleted unused). Nothing here claims the ship looked right in the game.
- Electron was run on Linux/WSLg with software WebGL; a Windows Electron run, the native file chooser and an installer rebuild were not done.
- Unit and real-archive tests cover pack parsing, but the "two installations of the same version" and fault cases use small stand-in installations, not two real copies.
- The editor's reference scan (original ships, name checks) still follows the project's target engine and the toolbar installation, and falls back to the newest scan of that engine when the toolbar installation is another engine. That is unchanged; only model reading was made explicit.
- Preview formats: `.model` and `.obj` meshes, `.png`/`.jpg`. Others (`.tga`, …) are reported, not previewed.
- GitNexus: `ProjectService.compile` is **HIGH** (build / installPreview / export). It was not edited; the compatibility check was added in `build`, `installPreview` and `exportBundle` beside it, covered by `forge-app/test/model-source.test.ts` and the existing suites. The new model symbols are not in the index (UNKNOWN); their callers were inspected by hand.

Files: `seed.mjs`, `lib.mjs`, `run-electron.mjs`, `run-browser.mjs` (harness; run after `pnpm build`), `results-*.json`, `checks.txt`, `screens/`, `screens-browser/`.
