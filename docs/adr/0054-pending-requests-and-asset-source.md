# ADR-0054 — Answers to requests made for another document are dropped; images come from the chosen installation

**Status:** accepted, 2026-10-10 (final acceptance of Forge Desktop, `docs/design/forge-collaudo-finale.md`).

## Context

Final acceptance exercised operations that were really pending (the shell answered late on purpose) and two installations of the
same engine version. Four defects came out of it, all reproduced before being fixed:

1. A **Verify** that answered after the author had opened another project was stored as the open project's result.
2. A **save** that was confirmed after the author had moved to another project marked that project as unsaved.
3. Images and models were requested by *engine* (`?target=`), so with two installations of one version the service answered from
   "the one scanned last" while the lists and the checks (GUI-6) described the installation chosen in the toolbar.
4. A scan that finished while the open document had unsaved edits never refreshed the editor's references (the editor only reloaded
   when clean), and a scenario made with **+ New** never loaded the references of its engine at all.

## Decision

1. The editor counts the documents it has put on screen (`session`, bumped by open / new / projects-folder change). A request that
   starts for a document records the session; if the session has changed when the answer arrives, the answer is dropped (the file
   operation itself is not undone — only the editor state is not touched). `openProject`/`newProject` also carry a ticket, so the
   newest request to open something wins.
2. Assets are requested by **installation id** as well as by engine (`?target=…&install=…`). The editor derives the id from
   `libraryInstall` (the installation whose scan the lists and checks use) when it is of the project's engine, and bumps the asset
   epoch when it changes. The service refuses to serve an installation of another engine as the requested engine's.
3. One function (`loadReference`) loads the catalog, the scan and the asset engine for a project, for opening **and** creating one;
   a scan that ends over unsaved edits updates the references (not the document) when it is the installation in use.

## Alternatives

- Cancel the in-flight request: not possible through the IPC channel, and the work is already done in the shell (it is synchronous).
- Key the cache by install on the service side only: the page would still ask for "the engine" and get the newest scan.

## Consequences

- A late answer is silent. The shell's result is not lost, but the editor never shows it as the open project's.
- The product still cannot interrupt an install: build, install and export run synchronously in the shell, so a window close can only
  come before or after one (observed), never during. Killing the process (power loss, task manager) mid-install is not covered
  beyond the existing rollback on a failed write.
