# Changelog

## 0.9.3 — Model source (22 October 2026)
- Model workshop reads meshes and textures straight from the installation, including `packs/*.pack`, with no manual extraction and no copy: only the archive index and the one byte range asked for are read, so a resource that disappears is reported missing and nothing stale is shown. The old per-installation copy of model files is removed on rescan.
- New **Model source** selector (Fleet → Hull → Model workshop): any registered installation, 2024, 2026 or another, with name, version and path. Remembered per project on this machine, never saved in the project file. Project target, model source and Install scenario destination are shown separately; changing the source changes none of them, nor any ship, and does not dirty the document. An unavailable source is reported, not replaced.
- Resource origin panel: installation, archive (or file) and offset, or the exact problem — missing, unsupported format, unreadable/truncated archive.
- A model that the project's engine does not define is previewed, not assigned; copying it into the project records its origin (names only).
- Verify / Install now refuse a project whose copied models need a mesh or texture (or a stock model) the destination installation lacks, and warn when the same name holds different bytes; exports list their unchecked model requirements in `INSTALL.txt` and claim no compatibility.
- Verified in the real Electron app and in a browser against EE 2024.12.08 and EE 2026.09.22PR archives, and by cold start of isolated engine clones: [report](docs/verification/model-source/README.md), [ADR-0061](docs/adr/0061-model-source-and-live-archive-resources.md).

## 0.9.2 — Model workshop (21 October 2026)

- Fleet/Hull: complete project ModelData editing with actual-mesh preview, collision overlays, selectable engine/weapon origins, scale, offsets, RGB and emitter size.
- Import portable OBJ + PNG/JPG resources; binary-safe export/install with existing preflight, backup and rollback. Installed originals are copied before editing.
- Scan full model definitions, including bounded colour/numeric families; cache referenced loose/packed resources per installation. Preserve floating-point emitter colours.
- Normal maps are explicit 2026-only settings; 2024 export rejects them. [Guide](docs/authoring/ship-model-workshop.md), [verification](docs/verification/model-workshop/README.md).
- Windows x64 installer 0.9.2 rebuilt from a clean source copy on Windows; package content, embedded version and Model workshop modules verified. Existing installed application unchanged.

## 0.9.1
- Fix: ships made from the editor now work in the game. «Copy into project» then renaming the copy left the «Move these…» offer pointing at the old name, so the ship spawned a template nobody defined (a hollow ship in EE 2026 and a missing ship in EE 2024, with nothing in the log). The offer now holds the copy by id.
- A ship that spawns a template defined neither by the project nor by the scanned install is now a blocking error in Verify and in Problems (ADR-0059).
- The manual export writes `INSTALL.txt` per engine: the three scenario files, or — with templates — the extra `scripts/shiptemplates/` file, the exact `require` line and the restart.
- Verified on EE 2026.09.22PR and EE 2024.12.08 (window → Install scenario → cold restart → play): `docs/verification/template-ship/`.

## 0.9.0
- Campaign saves: frozen sectors, checkpoints in EmptyEpsilon's `scriptstorage.json`, resume after closing the game (EE 2024.12.08 and 2026.09.22PR).
- A resume that cannot happen is never replaced silently: damaged / incompatible saves block the start and a new campaign is an explicit choice.
- Honest save wording ("sent to the save file"), the engineer's power/coolant sliders restored, and a concrete list of what a resume does not give back.
- Optional campaign-save backup utility (`Save backup tool`, PowerShell) installed beside the program.
- Project schema 5 (older projects are migrated on import; the original is never modified).

## 0.8.0
- The crew's mines, probes and missiles no longer follow a jump between sectors.

## 0.7.x and earlier
- Sectors and Change sector, visibility/lock tools, the installer and desktop shell, the editor itself.
