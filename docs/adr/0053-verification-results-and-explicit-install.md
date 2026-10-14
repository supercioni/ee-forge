# ADR-0053 — Results tied to a revision and an installation; export destination chosen first; install with a preflight

**Status:** accepted, 2026-10-10 (GUI-6 of the Forge GUI revision, `docs/design/forge-gui-stato.md`).

## Context

Until GUI-6 a "Verify" left a green line in the status bar that stayed true however the document changed; an
export picked its folder only *after* the button was pressed, so the author never saw destination, blocking
problems and bundle together; the install was a toolbar button that built and copied in one go, and its refusals
lived in one long status-bar sentence. A result named an engine year, not the installation it was checked
against, so two copies of one engine were indistinguishable.

## Decision

1. **A result is a statement about one revision of one document.** The editor counts edits (`revision`) and the
   revision on disk (`savedRevision`); every Verify/Install record carries the revision it was made from, the
   engine, the content mode (vanilla / with EXODUS), the installation whose scan the references were checked
   against (`ForgeBuildResult.library`, a `ForgeLibrarySource`: id, label, folder, engine, verified, scan date) and
   its outcome. Any later edit makes it *out of date*; saving does not make it current again — only a new check.
   "Installed" is said only for a complete install; a refusal, a rollback or a half-undone install is its own
   outcome (`passed | partial | failed | refused`).
2. **Problems are structured and derived, not parsed.** `diagnose()` (forge-core, pure, offline) lists what is
   wrong with the document — severity, subject, plain explanation, what to do, and a `ProblemLocation` the editor can
   navigate to (view, section, field). The build stays the authority on what blocks: `validateProject` /
   `validateExodusSteps` are untouched and tests prove the two agree (same errors present/absent, same warning
   counts) on every demonstration project and on mutated ones. A refusal `diagnose()` did not foresee is shown as
   the build's own message in the Last check record. The Problems panel keeps *problems* (current), *last check*
   (about a revision) and *evidence* (what has been run in an engine) apart.
3. **Evidence is worded as what it is.** A recorded "engine-tested" entry means the demonstration mission was run;
   the UI never implies that this scenario was. Export results and check records say, in words, "Not run": Forge
   generates and checks offline and does not execute the scenario in EmptyEpsilon.
4. **The installation is explicit.** The installation picked in the toolbar decides the scan used by the editor's
   checks and resource lists and is sent (`libraryInstall`, `libraryInstalls` per engine for an export) to the
   service, which refuses a scan of another engine as evidence; without a choice the newest verified scan of the
   engine is used and *named*. Two installations of one engine are two scans.
5. **Export: folder first, through the shell, by token.** `chooseExportFolder` opens the system dialog in the main
   process and returns a one-use token plus the path *for display*; `exportProject` takes the token. The path never
   comes back from the page (same rule as installations, ADR-0051). The dialog shows engines, content mode,
   installation scanned, blocking problems and warnings per engine, destination and the files each bundle will hold
   (`plannedBundle`, checked against the generator by a test) **before** exporting; a blocked engine is not exported,
   the others are, and the result says so.
6. **Install is its own step with a preflight.** `previewInstall` (forge-core) and `POST /forge/projects/:id/
   install-preview` report, without writing, what each file would do (create / replace ours / unchanged / collision /
   held open), the `require` line state and the restart. `installBuild` still runs its own preflight; the preview
   is information. Collisions need an explicit tick; locked files and blocking problems disable the button. The
   result keeps installed files, unchanged files, errors, backup, restart and the require line apart.
7. **Found while proving it:** `installBuild`'s rollback reported a file as "could not be put back" when the write
   failed because the parent was not a folder (`rmSync` forgives a missing file, not a missing folder), turning a
   clean rollback into "partly undone — fix by hand". Fixed (`ENOTDIR` means nothing was created).

## Not decided here

Running the scenario in the engine, a general undo, live (per-keystroke) re-verification, signing, auto-update.
