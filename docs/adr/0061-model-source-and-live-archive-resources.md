# ADR-0061 — Model source and live reading of archived resources

Status: implemented in the development build, 22 October 2026. Refines ADR-0060 (the model preview cache).

## Problem reproduced

- 0.9.2 read pack files, but copied every referenced resource out of `packs/*.pack` into a cache (hundreds of MiB per installation, whole archives read into memory) and decided what "was available" from an index written at scan time. A resource that later disappeared kept its old copy in the cache.
- The installation that supplied meshes and textures was **not a choice**: it was whichever scan the project's engine resolved to ("the newest scan"), or the installation picked in the toolbar — which is the *install destination*. With two installations of one version the preview could come from the wrong one, and a 2024 installation could not be used for a 2026 project at all.
- Verify / Install did not check that a model copied from one installation could load in the installation it was installed to.

## Decision

1. **Read live, cache nothing.** `modelResourceReader(installPath)` resolves a resource the way EmptyEpsilon does: `resources/<path>` first, then each `packs/*.pack`. A pack contributes only its index (parsed from the file header; cached in memory while size and mtime are unchanged) and the byte range of the one resource asked for. Offsets, lengths, truncated archives, overlapping entries, `..`, absolute and backslash paths are checked. Result states: `ok`, `missing`, `unsupported-format`, `refused`, `archive-unreadable`, each with its origin (file, or archive + offset + length). The old copied `model-resources/` folder is deleted on rescan; nothing reads it.
2. **Model source is a third, separate choice.** Project target engine, model source installation and *Install scenario* destination are shown side by side in the workshop. The model source is stored only in this browser's / app's local storage, keyed by project id (an installation id derives from a machine path), never in the project document. Choosing it does not edit, dirty or rewrite the document, change the target or the destination, or reassign any model. No silent fallback: a remembered installation that is gone stays chosen and is reported; with several installations of the project's engine none is chosen for the author; a single one is shown as a starting default.
3. **Service surface**, all addressed by registered installation id: `GET /forge/model-source/<id>/report?paths=[…]` (JSON, over IPC when in the desktop app) and `GET /forge/model-source/<id>/file/<path>` (bytes; the app protocol, like assets). A path never crosses the renderer boundary; the guard accepts only registered ids.
4. **Stale answers.** The store keeps one ticket; a scan or load that finishes after a newer choice is dropped. The preview is keyed on source, a scan epoch and the resource stamps from the report.
5. **Compatibility is its own check** (`checkModelDependencies`), run by Verify, Install preview and Install against the *destination* installation: every non-embedded mesh/texture a project model names must resolve there (error: blocks), every stock model a template names must be defined there (error), the same name with different bytes in source and destination is a warning, and anything that cannot be checked is "unverified". `normalMap` on 2024 stays a blocking build error. Nothing is dropped, substituted or copied. An export has no destination: the bundle's `INSTALL.txt` lists the requirements under **REQUIREMENTS NOT VERIFIED** and no compatibility is claimed.
6. A copied model records `origin: { model, target }` (names only) so its provenance survives a change of source.

## Consequences

- No stock bytes are stored by Forge; the installer and the projects remain free of them.
- A source can be any registered installation, including a different engine's: a model that the project's target does not define is *previewed* (never assigned) and can be copied into the project, after which the destination check decides whether it can load.
- The editor's reference scan (original ship list, name checks) still follows the project's target engine and the toolbar installation, as before; the UI now says so.

See the [verification report](../verification/model-source/README.md) and the [guide](../authoring/ship-model-workshop.md).
