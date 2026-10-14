# ADR-0056 — Change sector: a sector becomes a game concept, objects are unloaded (not destroyed) and recreated from their initial settings

**Status:** accepted, 2026-10-11 (after ADR-0055, which made sectors authoring organisation only).

## Context

ADR-0055 left sectors with no game meaning. The next step is a jump: leave a place, arrive somewhere else, **same player ship, same
state**. Three things make that non-trivial in the generated Lua: (1) removing the old environment calls `destroy()`, and the
scenario's own predicates (`object_destroyed`, `group_destroyed`) read "not valid" as "destroyed", so unloading a sector would look
like a victory over its enemies; (2) a rule that fires the jump is running inside the rule loop, and the rest of that loop would go on
evaluating the old sector's rules against objects that are gone; (3) existing projects must keep behaving exactly as they did.

## Decision

1. **Document.** `map.startSector` (sector id or `null`) is the sector the game *starts* in — distinct from the sector open in the
   editor (editor state, ADR-0055). Migration `0004-start-sector` writes `startSector: null` explicitly into older documents:
   **null = the legacy behaviour**, every *At mission start* group spawns, sectors have no runtime meaning. New action
   `change_sector { sectorId, arrivalMarkerId, rotation|null }` (the marker must belong to the destination sector; no rotation keeps
   the ship's own) and new predicate `current_sector { sectorId }`. Using either needs a start sector (`startSector` ≠ null).
2. **Runtime is opt-in.** The sector runtime is emitted only when the project sets a start sector or uses `change_sector` /
   `current_sector`. Any other project produces **the same Lua as before, byte for byte** (test).
3. **Cycle of a change.** (a) refuse before touching anything: unknown destination or marker → nothing unloaded; (b) destination ==
   current → **no-op**; (c) *unload* the previous sector's groups: for each object, **record the id in `unloaded` before `destroy()`**,
   forget its handle and group entry; (d) current sector = destination; (e) create the destination's groups that are *At mission start*
   (*When a rule spawns it* groups keep waiting for their rules), from their initial settings; (f) install dialogues; (g) place the
   player ship at the arrival marker (rotation only if given); (h) count the transition. **Shared** groups and the **player ship**
   are never unloaded; a PlayerSpaceship object is never created a second time.
4. **Unloaded ≠ destroyed.** `object_destroyed` and `group_wiped` read the unloaded record and the cleared tables, so a removal
   satisfies neither, including through any callback that looks at validity. No delay, no global switch-off of victories. An explicit
   *Destroy* action is unchanged and still counts; a real destruction in combat is still recognised.
5. **Transition inside the rule loop.** The jump runs immediately where the action is. The **actions after it in the same sequence run**
   in the new sector (a target that was unloaded is simply gone: a no-op). The **rule loop stops for that update**: the remaining rules
   are not evaluated until the next update, in the new world; beats are time-keyed and unaffected.
6. **What a reset is.** Only *objects* are recreated from their initial settings. Global variables, object variables, rules already
   fired (`once`), beats and the clock are **not** reset. Rules are edge-triggered; a non-`once` rule may fire again after a return.
7. **Guard on spawning.** `spawn_group` for a group filed under a sector other than the current one is refused at run time with a log
   line (Shared groups always spawn); the build warns when a rule conditioned on `current_sector X` spawns a group of another
   sector, and errors on a start sector / destination / arrival marker that does not exist or does not belong.
8. **Editing.** A sector or marker referenced by a rule cannot be deleted away from under it (the editor says which rule); moving a
   marker out of the sector a jump arrives in is reported by Problems. Membership of a group now **does** decide where it spawns when the
   project uses sectors at run time — documented, and flagged where an author could be surprised.

## Found live (addendum)

Played in an isolated EE 2024 clone, the first version left the ship **turning back** toward its old helm target after `setRotation`
(read 201° instead of 180°). The runtime now also calls `commandTargetRotation` (guarded); EE 2026 held the heading either way. Both
engines were played again on the final build. Recorded in `docs/ee-api-reference.md` and `docs/verification/change-sector/`.

## Alternatives

- Defer the jump to the end of the update: simpler loop, but actions after it would act on the old sector, which is what the author
  did not mean.
- Treat "unloaded" through a delay or by disabling victories while unloading: rejected (fragile, global).
- Keep per-sector progress (damage, destroyed ships) across visits: needs a persistence model of its own; first version recreates
  the sector from its initial settings.
- Unload what the author did not place (missiles, mines laid by the player, probes): not tracked by the map, so not touched. Said.

## Consequences

- A project's behaviour now depends on sector membership once it opts in; the editor shows the start sector and the arrival marker.
- `object_destroyed` cannot be true of an object that has been unloaded; after a return the object exists again and is alive.
- Verified live only where stated in `docs/verification/change-sector/`; the simulator is the second executor, never evidence of a live run.


## Addendum (2026-10-12)
The objects the map did not place — a mine laid by the crew, a probe, a missile in flight — were *not* unloaded and followed the ship into the destination (reproduced live, both engines). They are handled by [ADR-0057](0057-temporary-objects-across-a-jump.md).

## Addendum (2026-10-12, later)
The other limit named here — a sector is rebuilt from its initial settings every time, nothing survives a restart — is lifted, **for projects that turn it on**, by [ADR-0058](0058-sector-persistence-and-campaign-saves.md) (frozen sectors, campaign saves). Without that option this ADR describes what happens, unchanged.
