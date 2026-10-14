# 0038 — Markers are authoring-only places, resolved to literals

**Status:** Accepted.
**Date:** 2026-08-14 (Phase 5, EE FORGE).

## Context

Several fields in a project document are **a place on the map**, written as
a bare `{x, y}`:

| Where | Field |
| --- | --- |
| `player_near_point` | `position` |
| `order_roaming_at` | `position` |
| `order_defend_location` | `position` |
| `order_fly_towards` | `position` |
| `order_fly_towards_blind` | `position` |
| `CpuShip.order` (defend location) | `position` |
| `WormHole` | `targetPosition` |
| `ScanProbe` | `target` |

The editor can already pick one by clicking the map, but what it stores is
the number pair. So the same place gets typed into four different records,
and moving it means finding all four. Nothing in the document says those
four are the *same* place, so nothing can keep them together — and a
trigger left behind at the old coordinates fires nowhere, silently, with a
build that succeeds.

EmptyEpsilon has no marker class. There is no invisible `SpaceObject` to
lean on, and inventing one is out (root `CLAUDE.md` §0.3).

## Decision

**A marker is a named place that exists only in the project document.** It
is never constructed in EE, never appears in `map.objects`, and costs
nothing at runtime: every reference to it is resolved to literal
coordinates when the project is built.

Two parts:

**1. `map.markers`** — a flat list of `{ id, label, position, notes }`,
beside `map.groups` rather than inside one. A group decides *when its
objects spawn*; a marker never spawns, so putting it in a group would
attach a meaning it cannot have — and `spawn_group` on a group of markers
would be a no-op the author could not see through.

**2. `EEPointRefSchema`** — every field in the table above becomes

```ts
{ ref: "point", position: Vec2 } | { ref: "marker", markerId: string }
```

which is the shape `EETargetRefSchema` already uses for objects and groups.
A literal point stays a first-class answer: most places in a scenario are
mentioned once, and forcing a marker for them would be ceremony.

**Resolution happens at build time, in one place.** `resolvePoint()` turns
a ref into coordinates and throws `CodegenError` on a marker that does not
exist; `validateProject` walks every ref first, so a dangling reference is
reported by id and by the record that holds it, before any Lua is written.
The emitted Lua is unchanged in shape — literal numbers, exactly as before
— so nothing downstream learns that markers exist.

The **simulator resolves refs the same way**, from the same helper. The two
executors of the narrative model must not disagree about where a point is
(`packages/ee-forge/CLAUDE.md`).

**Not applied to three fields that look similar and are not:**

- `order_fly_formation.offset` — a displacement from a leader, not a place.
  A marker there would be read as a destination and silently mean
  something else.
- `Zone.points` — the polygon *is* the shape; its corners are not places
  that other records refer to.
- an object's own `position` — the object is already the thing at that
  spot, and `player_near_object` already refers to it.

## Consequences

Moving a marker moves everything that names it, which is the entire point:
a patrol anchor, the trigger that arms the ambush, and the waypoint the
wing flies to are one draggable thing.

Documents written before markers existed have bare `{x, y}` at all eight
fields. `z.preprocess` normalises those to `{ ref: "point", … }` on read,
so old projects open unchanged and are rewritten to the tagged form the
first time they are saved. A schema addition should not become a migration
(the same reasoning as `order`'s `.default(null)`).

Marker ids are their own namespace, like group ids: a marker and an object
may share a name, and `renameObject` deliberately does not touch
`markerId`. Renaming a marker is a separate walk over `MARKER_ID_KEYS`.

A marker is not visible in game. If an author wants players to see the
place, that is a Zone or an Artifact, and both already exist.

## Alternatives considered

**A marker as a new `EEObject` variant, living in a group.** It would
inherit the inspector, canvas, selection, marquee and rename for free —
tempting, and the reason it was considered first. Rejected because
`EEObjectSchema`'s variants are *the classes a scenario can construct*:
that invariant is what lets the map emitter switch exhaustively over object
types and what `SPAWNABLE_CLASSES` means to the palette and to the
conformance walk. A member that must be skipped at emission time weakens
the one place the model is checked hardest.

**Keep `Vec2` and let the editor copy a marker's coordinates in.** No
schema change, no migration, and the picking UX would look identical — but
the copy is taken once, so moving the marker afterwards changes nothing.
That is the bug this ADR exists to remove.

**Emit markers as Lua constants and reference them from the generated
code.** `local M_ambush = {x = 1200, y = -800}` reads nicely, but the
generated Lua is a build artifact nobody edits (ADR-0034), and a named
constant used once is noise. Literals keep the output diffable against
hand-written scenarios.
