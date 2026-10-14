# EE FORGE

A visual scenario editor for [EmptyEpsilon](https://github.com/daid/EmptyEpsilon). Place ships, stations, planets and zones on a map, describe what happens
(timed events, rules, dialogues, GM controls, sectors you can jump between) and **export plain vanilla Lua** that runs in stock EmptyEpsilon —
**2024.12.08** and **2026.09.22PR**. Nothing else is needed to play the result: no server, no plugin, no editor open.

- **Map, fleet, mission and dialogue editors**, with a simulator for the scenario's logic (timers, rules, variables — it does *not* simulate EmptyEpsilon's combat or AI).
- **Reads your own EmptyEpsilon install** (ships, factions, images) and exports one bundle per engine, each built against that engine's own API catalog.
- **Sectors and Change sector**, with optional **campaign saves**: frozen sectors, checkpoints in EmptyEpsilon's own `scriptstorage.json`, resume after closing the game.
- **Installs the generated scenario** into an EmptyEpsilon folder you choose, all-or-nothing, with a backup of every file it replaces.
- Optional, separate **backup utility** for campaign saves (PowerShell).
- Windows desktop app (Electron), works offline.

## Download

Get the Windows installer from the [**Releases**](../../releases/latest) page (`EE-FORGE-Setup-<version>-x64.exe`, with a `SHA256SUMS.txt` to check it).
It is a per-user install: no administrator rights.

> The installer is **not code-signed**, so Windows SmartScreen will warn ("Windows protected your PC" → *More info* → *Run anyway*). Check the SHA-256 against the
> one in the release if you want to be sure of what you downloaded.

Your projects live in `Documents\EE FORGE\Projects`; they are plain `project.json` folders you can back up or version.

## Community pack

[`community/`](community) holds the **EE FORGE Community Pack 1.0**: a ready-made demo scenario (*Lantern Route*) for EmptyEpsilon 2024.12.08 and 2026.09.22PR (project and generated Lua), a user manual (HTML/PDF/Markdown) and the test report. Start with [`community/README.md`](community/README.md); the zip and its `.sha256` are there too.

## Using it

The step-by-step guide (in Italian) is [`docs/guida-ee-forge-windows.md`](docs/guida-ee-forge-windows.md); the authoring reference (English) is
[`docs/authoring/ee-forge.md`](docs/authoring/ee-forge.md). In short: **+ New** (or **Import…**), build the map, add rules, **Add EmptyEpsilon folder…** to point at your
install, then **Export…** or **Install scenario**.

EE FORGE does **not** include EmptyEpsilon. You need your own copy of EmptyEpsilon 2024.12.08 or 2026.09.22PR.

## Build from source

Needs Node 22+ and pnpm 11 (`corepack enable`).

```bash
pnpm install
pnpm build        # builds the libraries, the editor and the desktop app
pnpm test         # unit tests of every package
pnpm start        # runs the desktop app from the checkout
pnpm installer    # Windows only: builds release/EE-FORGE-Setup-<version>-x64.exe
```

Packages: `forge-contracts` (the project document and its schemas), `forge-core` (catalog, code generation, simulator, editor logic),
`forge-app` (local services), `web-forge` (the editor UI), `forge-desktop` (the Electron shell and installer).
Design decisions are written down in [`docs/adr/`](docs/adr).

## Releases

Pushing a tag such as `v0.9.0` runs [`.github/workflows/release.yml`](.github/workflows/release.yml): it builds the installer on a clean Windows runner and
attaches it, with its SHA-256, to a GitHub Release.

## Licence

[GPL-3.0-only](LICENSE). Third-party notices ship with the installer (`THIRD-PARTY-NOTICES.txt`). EmptyEpsilon is a separate project by Daid and contributors
(GPL-2.0-or-later); the API catalogs in this repository are derived from its public script reference. No EmptyEpsilon game files or models are distributed here.
