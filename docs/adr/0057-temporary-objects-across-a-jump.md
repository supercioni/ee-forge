# ADR-0057 — The crew's mines, probes and missiles do not follow a jump: ownership, a bounded registry, one sweep

**Status:** accepted, 2026-10-11 (follows ADR-0056, whose "not covered" list named these objects).

## Context

Change sector (ADR-0056) unloads what the **map** placed: every such object has an id in `M.objects`, so it can be removed by id. A
mine laid from a tube, a probe launched from Relay and a missile in flight are **not** placed by the map. They belong to whoever fired
them and live in the engine. Reproduced in both real engines (`docs/verification/temporary-objects/live/repro{24,26}-run.json`, three
jumps A→B→A→B between two sectors on the **same coordinates**): every one of them was still in the destination after every jump,
mines and probes piled up (1, 2, 3 …), and a ship that sailed to where the old sectors' mines had been laid was **lost**
(the engine confirmed the ship no longer exists). Distance cannot tell these objects apart from the destination's, because the sectors
overlap.

## What the engines say (read live, not assumed)

| | EE 2024.12.08 | EE 2026.09.22PR |
|---|---|---|
| what they are | `Mine`, `ScanProbe`, `HomingMissile`, `Nuke`, `HVLI`, `EMPMissile` (`obj.typeName`) | entities: a ship-launched mine has `delayed_explode_on_touch`, a missile `explode_on_touch` + `missile_flight`, a probe `allow_radar_link` + `lifetime`; `typeName` is nil |
| who fired it | `obj:getOwner()` (all of them) | the `owner` field of that component |
| enumerate | `getAllObjects()` — **returns a list with nil holes** where an object is gone; `ipairs` stops at the first hole, `pairs` does not | `getAllObjects()` (a plain list) |
| owner after the owner is destroyed | **nil** | a stale entity, `isValid() == false` |
| handle identity | `==` works; the wrapper is stable while held | `==` works; `tostring(obj)` is a stable id |
| `destroy()` | silent: no explosion, no damage, **no callback** | silent: no explosion, no damage; an `onDestroyed` callback **does** run |

An HVLI is a burst of five rounds over about six seconds from one tube: the rounds not yet fired when the ship jumps are fired in the
destination by the ship that stays (see Limits).

## Decision

1. **Ownership, not distance.** A mine, probe or missile is the crew's of the old sector when its **owner** is (a) the kept player ship,
   (b) an object of a **Shared** group, or (c) an object of the **sector being left**. Compared with `==` against the live handles in
   `M.objects` (the owners are alive at that moment because the sweep runs first). **An object whose owner is not one of these — nobody,
   or an object the map did not place — is never removed.**
2. **A bounded registry for orphans.** The engine forgets (2024) or invalidates (2026) the owner of an object whose owner died, and the
   object could no longer be attributed. So the runtime keeps `M.temporary` (key `tostring(handle)`, value the handle): every
   `M.TEMPORARY_PERIOD` (2) seconds of scenario time `update()` scans `getAllObjects()` once and registers the crew's temporaries
   whose owner is on the old side; invalid handles are dropped at each scan; the registry is **emptied by every sweep**. It never
   holds more than what is alive. Scans are not per frame. Only a project that contains a Change sector action carries any of this.
3. **When.** `enter_sector` calls `M.sweep_temporaries()` **first**, after the refusals and the same-sector no-op of ADR-0056 have
   already returned (so a refused or no-op request removes nothing) and **before** the old sector is unloaded (so the owners are still
   alive). One last scan, then `destroy()` of everything registered. The sweep is wrapped in `pcall`: a failure is logged and the
   jump goes on.
4. **Not a destruction.** Temporaries are not scenario objects (no id, no `unloaded` entry), so `Object destroyed` / `Group wiped
   out` cannot see them. The engines' `destroy()` is silent (no explosion, no damage). The only callback it can raise is an
   `onDestroyed` that someone registered on a crew object; Forge registers none.
5. **Inventory untouched.** Nothing is given back: a missile or mine already fired stays consumed, the probe count is what the
   crew left; ammunition in tubes is not touched.
6. **Unchanged for everything else.** A project without Change sector has no registry, no scan, no sweep (a test pins the Lua of
   every demonstration project and of a project with a start sector but no jump).
7. **Engine flavour** is chosen at build time by the target (the same switch that already separates `typeName` from ECS for the
   comms restore).

## Alternatives rejected

- **Remove everything the engine holds except the player ship** — also removes what the author or EXODUS placed outside the map.
- **Remove by distance / by sector rectangle** — the sectors overlap, which is the case that matters.
- **Scan every frame** — needless: ownership is stable, and a two-second scan plus a final scan at the jump is enough.
- **Hook creation** (`onProbeLaunch` exists, but no hook exists for mines or missiles) — not available in both engines.
- **Rely on the 2026 stale owner** — 2024 gives nil; one rule for both is the registry.

## Limits (stated, not hidden)

- An object fired and **orphaned before the next scan** (its owner destroyed within two seconds of the shot) is not registered and
  therefore not removed. A mine laid by a CPU ship that dies within two seconds is the realistic case.
- Objects whose owner is unknown are left in place by design: a mine placed by a GM or an external script stays.
- The rest of an **HVLI burst** started before the jump is fired in the destination, by the kept ship. Cancelling it would mean
  touching the tube state or the stock.
- Visual effects (explosions, beams) are not touched; they last seconds.
- The simulator has no model of crew projectiles; the rule is checked on the generated Lua with a mock world and on the real engines.
- EXODUS-placed objects and per-sector persistence are not covered.
