# ADR-0055 — Sectors organise the map for the author; hiding, locking and the open sector are editor state

**Status:** accepted, 2026-10-11 (Forge after 0.7.1; checkpoint in `docs/design/forge-gui-stato.md`).

## Context

An author building scenarios that visit several places — star systems, a place reached by a jump — had every group of the map on
screen at once, with no way to work on one place without seeing (and clicking, sweeping and fitting to) the others. Groups already
mean "a set of objects with a way of appearing" (`At mission start` / `When a rule spawns it`); that meaning must not change.

## Decision

1. **Sector → Group → Object.** A new level above groups, nothing below them (no recursive groups). `map.sectors` is a list of
   `{ id, label }`; every group and every marker carries `sector`: a sector id, or `null` for **Shared** (content several sectors
   have in common, the player ship for one). Sector membership is authoring organisation: it adds **no game rule**, never changes
   when a group spawns, and is **never emitted**. Moving a group between sectors keeps its id, its objects' ids and coordinates and
   properties, every rule and dialogue reference to it, its spawn timing and its **position in `map.groups`** — which is the order
   groups are generated in. The order the editor *shows* groups in is derived from it, never written back.
2. **Schema 3, migration `0003-sectors`.** Older documents get one initial sector (`sector-1`, “Sector 1”) and every group and marker
   is filed under it. Nothing is inferred from names; a document that somehow already has sectors keeps them and files unfiled
   groups under the first. Deterministic and idempotent; `schemaVersion` 2 → 3. The schema also `.default`s the new fields so a
   hand-written document still parses; `importProject` is the path that migrates.
3. **Hiding, isolating, locking and the open sector are not in the document.** They are the author's way of looking (`ViewPrefs` in
   `@forge/core/editor`), kept by the editor **per project** (localStorage key by project id) and pruned of ids that no longer
   exist. They never mark the project unsaved, never reach `project.json`, never change the exported Lua. Isolation is an overlay
   (`isolated`): it never edits `hidden`, so leaving it restores exactly the visibility there was.
4. **What the canvas does not draw does not exist for the pointer.** Every drawn element starts from the list of shown groups, so a
   hidden group's icons, textures, outlines, labels, orbits and arcs are absent, cannot be clicked, are not swept by a rubber band
   and are not part of Fit. A locked group is drawn and can be selected and read; its objects refuse moving, deleting, editing and
   renaming — in the store (so mouse, keyboard and inspector are all covered) and, for the inspector, by disabled fields that say
   why. A selection that becomes hidden is dropped *and the status says so*; one that becomes locked stays (it can be read).
5. **A sector is deleted only without losing its contents.** Empty: just removed. Non-empty: a destination (another sector or
   Shared) is required and the dialog says exactly what moves; nothing is deleted with it.
6. **References cross sectors.** "Used by", "Go to it" and the links in Dialogues go through `focusObject` / `focusMarker` /
   `focusGroup`, which open the target's sector (a notice says so) and change no data. A target hidden by its group's visibility
   is reached, selected and marked on the map as "not on the map" with the button to show it; it cannot be changed unseen. While
   something is being picked on the map, every sector is on screen.
7. **Provenance hash.** The generated files carry the sha256 of `project.json` in a comment (`-- sha256 …`). A reorganisation changes
   the document and so that line — and only that line.

## Alternatives

- A sector as a *kind of group* (nested groups): rejected — the hierarchy is fixed at three levels and a group's meaning must not
  change.
- Hide/lock stored in the project: rejected — they are a way of looking, would dirty the document on every toggle and would travel
  with copies.
- Hash the "game part" of the document so organisation does not touch the generated files at all: rejected — the line would stop
  being the checksum of the file it names.
- Making Change sector, teleporting and unloading/restoring object state part of this: out of scope (the sector is not a game
  concept yet). **Hiding in the editor does not remove anything from the game; changing the editor's sector does not change the
  sector during play; Destroy can still satisfy “Group wiped out”; a new Spawn group recreates objects from their initial settings.**

## Consequences

- Every project written from now on is schema 3; Forge versions that only know schema 2 refuse it (existing rule: never downgrade).
- The scene list can be long with many sectors; the open sector narrows both list and canvas.
- Two groups in different sectors may overlap on the map; the sector view is what keeps them apart, All sectors shows both.
