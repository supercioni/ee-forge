# 0036 — A ship-template variant emits only what it changes

**Status:** Accepted.
**Date:** 2026-08-12 (Phase 5 STEP 39).

## Context

EE FORGE models a ship template as a flat record and emits every non-null
field as a setter (ADR-0034). For a root template that is exactly right.
For a **variant** — a template with `copyOf`, emitted as
`ShipTemplate("<base>"):copy("<name>")` — it is not, because `copy()`
already carries every value across. Re-emitting all of them is at best
noise, and for two calls it is a bug:

- `addRoom` / `addRoomSystem` and `addDoor` **only ever add**. A variant
  restating its base's deck plan gets two reactors stacked on the same
  cells, and EE exposes no `removeRoom`.
- EE's own templates never do this. `shiptemplates/corvette.lua` derives
  the Atlantis from the Atlantis X23 with six restated setters, not sixty,
  and says nothing about rooms.

The editor makes this reachable in one click ("⎘ create a variant"), so it
had to be settled before the Ship view shipped rather than discovered by an
author whose engineering screen came out wrong.

## Decision

**A variant emits a setter only when its value differs from its base's.**
Equality is structural over the JSON value, which is exact here: the
project document *is* JSON (ADR-0034 §1).

Three consequences follow from what EE's API does and does not offer:

1. **A variant may not change its deck plan.** `rooms` or `doors` that
   differ from the base is a `CodegenError` naming the problem, because
   there is no call that would take the inherited ones away. The author
   either shares the base's plan or writes a root template.
2. **A dropped beam is zeroed, not removed.** `setBeamWeapon(i, 0,0,0,0,0)`
   is EE's own idiom for it — the Atlantis drops its third battery exactly
   that way — so a variant that omits an index its base had emits the zero
   call.
3. **A variant that changes nothing emits one line.** `local x = base:copy("X")`
   and no chain at all; a bare `x` on its own line is not a Lua statement.

## Alternatives considered

**Keep emitting everything, and special-case rooms and doors.** Smaller
change, and correct. Rejected because the output stops resembling EE's own
templates: a variant restating forty identical setters hides the two that
matter from anyone reading the generated file, and reading the generated
file is how this project checks its own work.

**Flatten variants away — emit every template as a root.** Also correct,
and it removes the deck-plan restriction entirely. Rejected because
`copy()` is the relationship the author expressed, the emitted file should
show it, and a flattened variant silently stops tracking edits to its base.

## Consequences

- The `forge_demo` bundle shrank: the Corsair Mk2 no longer restates its
  type, class, model or radar trace.
- Verified on a live EE (2026-08-12, headless server): both Corsairs spawn
  from the generated file with the authored hull, shields, speed, beam
  ranges, arcs, tube counts and magazines, including the variant.
- A separate finding from the same session, now a build error: **a template
  that never calls `setModel()` kills EmptyEpsilon.** It exits during
  `shipTemplates.lua` with code 5, no Lua error and no log line. Two loads
  of the same generated file, differing only in that one call, separate the
  two outcomes. `validateProject` refuses it and walks the copy chain,
  since a variant may inherit its model.
