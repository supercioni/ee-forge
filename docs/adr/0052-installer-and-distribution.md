# ADR-0052 — The Windows installer, the asset licence rule, and an all-or-nothing scenario install

**Status:** accepted, 2026-10-08 (increment 6 of the autonomous Forge plan).

## Decision

### 1. One installer: NSIS, per user, Windows x64

- Built with `electron-builder` (exact version pinned, `pnpm-lock.yaml` frozen) from `packages/forge-desktop` →
  `EE-FORGE-Setup-<version>-x64.exe`. Per-user (`%LOCALAPPDATA%\Programs\EE FORGE`), **no administrator rights, no UAC**,
  no machine-wide registry entry; Start-menu and Desktop shortcut with the icon; an uninstaller; the version in the
  uninstall entry and in the executable's version resource.
- **Supported:** Windows 10/11 **x64** (Electron 44 supports Windows 10 and later). **Not built:** ARM64, 32-bit, macOS, Linux.
  Only Windows 11 Pro 10.0.26200 x64 was tried.
- **Runtime included:** Electron/Chromium/Node are inside the program. The end user needs no Node, pnpm, WSL, repository or EXODUS.
- **Unsigned.** No certificate was bought or used (task constraint). Windows SmartScreen will warn; the SHA-256 is published
  next to the file instead. Signing and auto-update are a distribution decision, not made here.
- **Uninstall never deletes user data**: projects (`Documents\EE FORGE`) and settings/registry/caches/backups
  (`%APPDATA%\EE FORGE`) stay (`deleteAppDataOnUninstall: false`). Update = run the newer installer over the old one.
- **Hardened executable** (Electron fuses flipped at packaging): no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`,
  only the embedded `app.asar` is loaded and its integrity is checked. (Chromium's `--remote-debugging-port` is not a
  fuse and still exists; the installed-product test uses it, because Playwright cannot start a hardened executable.)

### 2. The build is reproducible from a clean Windows

`scripts/windows-clean-build.sh` copies **only the Forge subset** (contracts, core, app, web-forge, desktop, the lockfile)
to a scratch folder on Windows and runs `build-windows.ps1` there with Windows' Node: `pnpm install --frozen-lockfile`,
build, `electron-builder`, then `verify-package.mjs` — which opens `app.asar` and **fails the build** on a developer path,
an EmptyEpsilon or EXODUS file, a test tool, a source map, `node_modules`, or an asset the licence inventory withholds.
The packager runs on a *stage* folder (a copy of `dist/`) because, run inside the workspace, it walked `node_modules` and put
the workspace packages and their tests into the app — the verifier caught exactly that. Byte-identical output is not claimed.

### 3. Assets: an allowlist by positive evidence, nothing assumed

`scripts/asset-inventory.mjs` decides per file. A file ships only if the repository holds evidence of a licence that permits
redistribution with attribution: a glTF whose own `asset.extras.license` is CC0 or CC-BY 3.0/4.0, or the Kenney CC0 model
(`assets/LICENSE-kenney.txt`) — **and** the editor actually loads it. Everything else is withheld, with the reason recorded
(`docs/licenses/asset-inventory.json`). Findings that drove this (EmptyEpsilon-derived meshes, 106 `.glb`):

| Origin (matched by file name against the install's `packs/` and `resources/`) | Files | Terms |
|---|---|---|
| `ee-ships/` ← `Angryfly.pack` | 52 | TurboSquid Royalty-Free: "only to be distributed as a whole, without modifications, with copies of EmptyEpsilon" |
| `ee-ships/` ← `msgamedev-1/2.pack` | 13 | CGTrader licence: same restriction |
| `ee-ships/` ← `Asteroids.pack` | 10 | not covered by EE's `packs/License.txt`; upstream terms not established here |
| `ee-ships/` ← loose `resources/mesh/*.obj` | 15 | EE resource; upstream terms not established here |
| `ee-ships/`, no trace in the install | 6 | no provenance at all |
| other folders: 7 Sketchfab CC-BY-4.0, 1 CC-BY-NC-4.0, 1 unknown (`wormhole/`), 1 Kenney CC0 (`ships/atlantis.glb`) | 10 | CC-BY allowed in principle but **viewer-only** (mines, black hole, missiles, nebula cloud), so not shipped; the NC one and the unknown one never; Kenney is allowed but not referenced by the editor's manifest |

(The 175 MB of images — planets, radar, nebula, fx — are EmptyEpsilon resources whose upstream licence is not established in this repository.)

Consequence: **the installer ships no stock image and no stock hull model.** Planet textures, radar sprites and nebula
billboards are copied from the **user's own EmptyEpsilon install** when it is registered and scanned (`Rescan`, existing
mechanism, extended to the nebula billboards) into a per-install cache. Stock hull previews show a labelled generic stand-in
drawn from primitives. The map draws plain shapes for objects whose sprite is missing. A real hull preview would need the
user's own models converted locally — the packs forbid modification, so only the loose `.obj` files could be; **not built**.
The npm dependencies' licences (MIT, Apache-2.0, BSD-3-Clause, ISC) are collected with their texts into
`THIRD-PARTY-NOTICES.txt`, installed beside the program together with Electron's and Chromium's own notices.
The licence of EE FORGE itself has not been chosen by its owner and is not asserted anywhere.

### 4. Installing a scenario into EmptyEpsilon is all-or-nothing

`installBuild` (forge-core) now: **preflight** (target version already enforced; files held open — including ones that cannot
even be read — refuse the whole install; a file EE FORGE did not install, or that was edited since (SHA-256 ledger in
`scripts/.ee-forge-ledger.json`), is a *collision*, refused unless the author says "Install anyway"); **backup** of every
file about to be replaced (and `shipTemplates.lua`) into the app's own state folder, read back; **write** through a temporary
sibling + rename, read back and compare; **any failure restores everything** (`rolled-back`) — only a failed restore is
`rollback-failed`, naming the files. Result status: `installed` | `installed-pending` (files in, but the `require` line is
missing, so the templates will not load) | `refused` | `rolled-back` | `rollback-failed`. The UI says "Installed" only for
`installed`; templates and models — which EE reads only at launch — are listed apart as needing a restart.

### 5. The limits stay written down

EE 2024 + the real EXODUS bridge remains `incompatible` (ADR-0050/0051); the installer neither changes nor hides that, and the
vanilla path never depends on it. The installed product was exercised on a developer's Windows 11 with a sanitised
environment, **not** on a clean machine/VM (Windows Sandbox and Hyper-V are not available here).

## Alternatives rejected

- **Bundling the stock models/images "because the project is GPL"** — the packs' own licence text forbids it, and the rest is unproven.
- **A denylist** (ship all, remove the known-bad): fails open on the first file nobody classified.
- **MSI / Squirrel / MSIX**: MSI needs more tooling for per-user installs, Squirrel is unmaintained, MSIX needs signing to install at all.
- **Per-machine install in Program Files**: UAC for every update, and nothing here needs it.
- **Updating by overwriting EE files in place without backup** (the old behaviour): a locked file produced a half-installed scenario.
