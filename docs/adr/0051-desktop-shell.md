# ADR-0051 — The desktop shell: services in the main process, a path-free editor

**Status:** accepted, 2026-10-07 (increment 5 of the autonomous Forge plan).

## Decision

1. **`@forge/desktop` (`packages/forge-desktop`) is an Electron shell, nothing more.** The main process creates the
   Forge services (`@forge/app`) in-process and drives them through the router; the editor (`web-forge`'s production
   build) is the renderer. **No server is started and no port is opened**; there is no backend to launch, no terminal
   to leave open, and no EXODUS in the dependency graph (`forge-core/test/independence.test.ts` enforces it).
2. **The editor reaches the services through its existing `ForgeTransport`**, implemented over IPC by the preload
   (`window.__FORGE_TRANSPORT__`). Nothing in the editor knows it is in Electron except a handful of
   `getDesktop() !== null` branches.
3. **Isolation.** `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity`, no `webview`, no new windows,
   no navigation away from the app, every permission denied. The page is served from a private scheme
   (`forge-app://app/`) with a strict CSP (`'self'`, plus `'wasm-unsafe-eval'` for the glTF mesh decoder — no
   `eval`, no remote origin). The preload exposes two things only: the transport and `forgeDesktop`, a fixed set of
   functions — no channel name, no generic `invoke`/`send`. Arguments are validated in the preload and again in main;
   results are validated before the page sees them.
4. **The page never holds a path.** Every operation that needs a file or folder opens the operating system's dialog in
   the main process and acts on the answer there: choose projects folder, add an installation, import a project,
   export, pick an optional extension module. A *guard* in front of the router refuses the Forge routes that take a
   path (`POST /forge/installations`, `eeDir` on rescan / DMX import, a non-id `install` on build) and answers only
   known areas with well-formed paths. An install is named by its registered id. A folder Forge cannot identify is held
   in the main process behind a random token while the author declares its version.
5. **A dismissed dialog is an answer.** Every dialog operation returns `canceled`; nothing is half-done.
6. **User folders.** Projects default to `<Documents>/EE FORGE/Projects` (changeable by the user); settings, the
   installation registry, libraries, image caches, the DMX rig and logs live in the per-user app-data folder. Nothing is
   written next to the program, and the bundle embeds no path of the machine that built it (the catalog `source`
   provenance, which recorded `/mnt/c/…`, is anonymised in the bundle). Updating the app does not touch either folder.
7. **Import is a copy.** `ProjectService.importCopy` reads a project folder or `project.json`, stores the copy under a
   free id (never overwriting), migrates in memory and keeps unmodelled fields; the source is never written.
8. **Export is per engine.** `ProjectService.exportBundle` builds each chosen target on its own — its catalog, its
   library, its dialogue/API branches — into `<out>/<project>/<target>/scripts/…` (the layout of an EE install) and an
   `export-report.json`. "Both" means two separate bundles; a failure on one never stops the other. Exporting copies
   nothing into an install; installing is the separate, explicit "Build + install".
9. **Compatibility is evidence, not a version string.** `ForgeExtension.compatibility(target)` and
   `VANILLA_COMPATIBILITY` record what was actually run (levels `engine-tested`, `offline`, `unverified`,
   `incompatible`), served at `GET /forge/compatibility` and shown in Settings and the Export dialog. EXODUS with EE 2024
   is `incompatible` (the real bridge cannot read that engine's transport; ADR-0050 trial). An integrated export for a
   pairing without engine evidence still happens, with a warning that names the engine; **the vanilla path is never
   blocked by anything about an extension.**
10. **EXODUS is opt-in.** The app loads no extension unless the user chooses a module and turns it on (Settings); an
    unloadable module is reported, not fatal. Without it only vanilla exports are offered.
11. **Unsaved work.** The renderer reports its dirty state to the shell; closing the window with unsaved changes is held
    by the shell and put to the editor, which asks (Save / Don't save / Cancel) in its own dialog. The same question
    guards opening or creating another project, importing, and switching the projects folder. In a browser the
    browser's own leave-page prompt is used.

## Alternatives rejected

- **A loopback HTTP server inside the app** (reusing `createForgeHttpServer`): a port to pick and collide on, reachable by
  any local process or web page, and an origin the editor must trust. IPC has none of that.
- **`nodeIntegration` / exposing `ipcRenderer`**: any script in the page would hold the file system.
- **Letting the page send paths and validating them**: validation of "is this folder safe to write" is a policy the
  shell cannot make; the OS dialog is the user's own decision.
- **Wrapping the EXODUS bridge**: ruled out by the plan; Forge does not start the bridge or its watchers.
- **A native menu / title-bar dialog for unsaved work**: harder to test and not the editor's visual language.

## Not decided here (increment 6)

Installer, icon, code signing, auto-update, first-run packaging of `assets/` (the `Nebula`/`nebula` folder pair merges on
Windows — no file collides today, the bundle script checks it), and trimming the 175 MB asset set.
