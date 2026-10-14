# 0041 — A stock ship is materialised, not copied

**Status:** Accepted.
**Date:** 2026-08-20 (Phase 5, EE FORGE).

## Context

The Ships view could only edit templates the project itself declared. An
author wanting a variant of EmptyEpsilon's Atlantis had no way to see what
the Atlantis *is*, let alone start from it — the install's 168 hulls existed
in the editor only as a list of names in the map inspector's `setTemplate`
picker.

Three facts, established before any design.

**A scenario cannot reference an existing template.** `ShipTemplate` has
`getTemplate(name)`, `getAllTemplateNames()` and `getTemplateNameList(type)`
in C++ (`shipTemplate.h` 203–205), and **none of them is registered with
the script engine** — they are absent from the
`REGISTER_SCRIPT_CLASS_FUNCTION` block. Enumerating `_G` on a live
EE-2024.12.08 confirms it from the other side: the only template-related
global is the `ShipTemplate` constructor. So `ShipTemplate:copy()` can only
chain off a Lua local declared earlier in the same file, and "copy the
Atlantis" cannot mean `copy()`.

**A scenario cannot declare one either.** `ShipTemplate::ShipTemplate()`
opens with `if (game_server) { LOG(ERROR) << "ShipTemplate objects can not
be created during a scenario."; destroy(); return; }`. Templates exist only
during EE's launch-time phase — which is what ADR-0034 §3 already
established, and what the wiki's *Creating Ship Templates* says in prose.

**Redefining a stock name works, loudly.** `setName` logs
`ERROR: Duplicate ship template definition: <name>` and then assigns
`templateMap[name] = this`. The last definition wins. That is a genuine
capability — it is how a campaign retunes the Atlantis its crew flies
without touching the install — and a genuine hazard, because it changes
every scenario that spawns the name.

## Decision

**Copying a stock hull means writing its whole definition into the project
document.** The install library therefore holds each stock template
*whole*, in the same shape a project template has, and the copy is a
spread.

Concretely:

- `EETemplateRefSchema` is `EE_SHIP_TEMPLATE_FIELDS` — the field table
  `EETemplateDefSchema` is itself built from — plus `sourceFile` and
  `copiedFrom`. One definition of "a ship template" in the codebase, and
  `TEMPLATE_FIELDS`' existing coverage test now guards both.
- The install scanner reads all 53 registered `ShipTemplate` setters
  instead of 9. A setter it ignores is a field that silently reverts to
  EE's default in a copy.
- `templateFromStock(stock, id, name)` sets `copyOf: null`. There is
  nothing in a generated file to copy from, and claiming otherwise fails
  the build with a message about a base the project does not define.
- The default name is suffixed (`Atlantis (cioni)`). Shadowing a stock name
  is available by typing it, and the inspector says what EE will do about
  it.
- The editor installs the build into EE — `scripts/shiptemplates/` plus the
  `require` line — and says a restart is due. Generating files an author
  then has to place by hand is half a feature.

## What this cost, and what it caught

Reading the install whole meant reading it honestly, and two of the
scanner's neighbours turned out to be wrong.

**`copy()` does not carry everything.** Diffing the members declared in
`shipTemplate.h` against those assigned in `ShipTemplate::copy` leaves six
behind: `locale_name`, `jump_drive_min_distance`, `jump_drive_max_distance`,
`long_range_radar_range`, `short_range_radar_range`, `impulse_sound_file`.
The variant gets the constructor's defaults instead — 30000 for long-range
radar, 5000/50000 for jump range, `sfx/engine.wav` for the engine.
`has_jump_drive` **is** carried while its range is not, so a variant of a
jump ship kept the drive and lost the tuning.

ADR-0036 decided that a variant emits only its differences. That is still
right; it was just unsound for those six. `NOT_CARRIED_BY_COPY` now names
them in one place, and both consumers read it: the emitter always writes
them, and the scanner does not inherit them when it reads a stock
`base:copy(…)`.

**`setDockClasses` and `setExternalDockClasses` are the same field.** Both
assign `external_dock_classes`; no `dock_classes` member exists. The model
carried two lists and the emitter wrote both, in order, so the second
silently overwrote the first. Now there is one, and the old key merges into
it on read.

## Alternatives considered

**Per-object runtime overrides.** The wiki suggests
`CpuShip():setTemplate("Atlantis")` followed by runtime setters, and the
surface is real: `setHullMax`, `setImpulseMaxSpeed`, `setBeamWeapon`,
`setWeaponStorage`, `setTypeName` and ~25 more are registered on
`ShipTemplateBasedObject` / `SpaceShip`. It needs no restart and no install
step. It also cannot touch `setModel`, `addRoom`, `addDoor`, `setClass`,
`setDescription`, `setDefaultAI`, `setRepairCrewCount`, the dock classes or
the crew-ability flags — none of which are registered at runtime — so it
makes a *retuned ship*, never a new class, and the hull never appears in
EE's picker or database. Rejected for this feature on the author's call:
the editor's job is to produce the files EE loads at launch. It remains
available if a use case for disposable variants appears.

**A thinner library plus a mapping layer.** Keeping `EETemplateRef` as an
index and mapping it onto `EETemplateDef` at copy time would have avoided
touching the library schema. It also creates a second definition of the
same thing that a test cannot see drifting — the objection `web-forge`'s
briefing already makes about derived data.

## Consequences

- `ee-library.json` written by an older toolkit no longer parses. It is a
  cache of the install, regenerated by one button, so the editor says
  *"open Install… and Rescan"* rather than carrying a migration for it.
- The scan reports what it could not read instead of leaving a field
  looking unset. On the pinned install that is two warnings, both
  `setLocaleName(string.format(…))` on loop-generated families.
- `lua-data.ts` gained literal-only constant folding, so a family's
  `setSpeed(60 - 5 * cnt, 6, 10)` resolves once the unroller has
  substituted `cnt`. It refuses anything with an identifier left in it,
  which keeps the package's "report, do not guess" rule intact: this is the
  arithmetic counterpart of the `..` folding that was already there, not an
  evaluator.
