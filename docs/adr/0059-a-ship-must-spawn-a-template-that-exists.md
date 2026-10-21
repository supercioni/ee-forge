# ADR-0059 — A ship must spawn a template that exists; the move offer holds the copy by id

**Status:** accepted, 2026-10-21. Evidence: `docs/verification/template-ship/`.

## Context

"New ships do not work after installing the scenario." Reproduced through the editor's window on isolated clones of both engines
(`docs/verification/template-ship/before-fix/`): copy Atlantis → rename the copy → *Move these 1 to …* → Verify (0 errors, 1 warning) →
Install scenario ("Installed — every file written and read back"). The installation was complete and correct: the templates file, its
`require` line in `shipTemplates.lua`, the load order (models, then templates) and the restart notice were all fine, and the same
project without the one ship loaded and played. What was wrong was a **reference**: the offer made by *Copy into project* remembered the
copy's **name**, so a rename made before answering sent the ship to a template that no longer existed. `setTemplate("Atlantis (ship_test_…)")`
on a name the engine does not know produces, in EE 2026, a ship with no hull, engines or shields (components `callsign, faction,
player_control, …` only) **and stops the map from being built** — the ships listed after it never appear; in EE 2024 the ship is not created.
Nothing reaches the log. The build only *warned*, and the Problems panel did not list it.

## Decision

1. **The offer holds the copy by id** (`pendingRetarget = { from, toId }`). The name shown and applied is whatever the template is called
   when the author answers; if the copy was deleted meanwhile, nothing moves and the editor says so.
2. **A map object spawning a template that neither the project defines nor the scanned install has is an error**, in the build
   (`validateProject` refuses with the object, the name and what to do) and in Problems (`object-unknown-template`, pointing at the object).
   The claim needs evidence, so it is made only when a scan with at least one template exists; without one the reference stays "unverified".
   The templates file Forge installed **for this project** is not evidence (`unknownTemplateReferences`): it is what the next install
   replaces, so a name that survives only there would pass today and be gone after the restart.
3. **The manual export carries `INSTALL.txt`** per engine folder, telling a three-file scenario (copy, no restart) from a project with
   templates (close EE, copy `scripts/`, copy `scripts/shiptemplates/`, add the exact `require` line once, restart), and the dialog shows
   the same steps with the exact line. `requireLineFor` is the single definition of that line, shared with the installer.

## Alternatives

- *Make the build rewrite the dangling name to the nearest template.* Rejected: it guesses; the author would not know which ship they got.
- *Keep it a warning and fix only the offer.* Rejected: the next dangling name (a deleted template, a typo, a template renamed from the
  Fleet list with objects in a locked group) would fail the same silent way, and a result that says "Verify passed" must mean the ships exist.
- *A second install mechanism for templates.* Not needed: the existing one (`<project>_templates.lua` in `scripts/shiptemplates/` + one
  `require` in `shipTemplates.lua`, idempotent, backed up, all-or-nothing) loaded correctly on both engines.

## Consequences

`validateProject` is **HIGH** risk in GitNexus (every build goes through it); the change is one branch that can only refuse a project whose
object names a template nothing defines, and only with a scan. Projects that spawn templates from an install that was never scanned are
unaffected. A scenario that deliberately spawns a template defined by something Forge cannot see (another script the scan does not read)
now has to be built without that scan or from an install where the file exists.
