# ADR-0058 — Frozen sectors and campaign saves: what is kept, how it is stored, and what the engines allow

**Status:** accepted for implementation, 2026-10-12 (follows ADR-0055/0056/0057). Increments are verified one at a time; the "Verified" section at the end says what has been.

## Context

ADR-0056 recreated a sector from its initial settings on every visit and kept nothing across a restart of EmptyEpsilon. The user's decisions: the sectors belong to
the **same Forge project**; an inactive sector is **frozen**; returning restores the state it was left in; saves **survive a restart** of EE; vanilla play must not
depend on EXODUS or on Forge being open; EE 2024.12.08 and 2026.09.22PR.

The OdysseusLarp scripts the user pointed at (`scenario_jump_00.lua`, `utils_odysseus_scenariochange.lua`) were read: they switch with `setScenario(file)` behind GM buttons
and **do not save or restore any map or object state** (no ScriptStorage, no snapshot). They are a reference for the flow of a jump only. Forge's own Change sector stays; it
is not replaced by `setScenario`.

## What the real engines allow (measured: `docs/verification/campaign-persistence/`)

| | EE 2024.12.08 | EE 2026.09.22PR |
|---|---|---|
| `getScriptStorage():set(key, value)` accepts | **string only** (a number is coerced to its text; boolean, table and nil are errors) | string, number, boolean, nested table; `nil` deletes |
| `:get(missing)` | `""` (an empty string is also "absent") | `nil` (an empty string is a value) |
| where it lives | **`scriptstorage.json` in the engine's working directory** (the folder of `EmptyEpsilon.exe`; the doc's `$HOME/.emptyepsilon` is not what a Windows install does) | same |
| when it reaches disk | **on every `set`, synchronously**: a hard kill 1.8 s after a `set` kept the key | same |
| cost | the **whole file is rewritten on every set**: ~1.9 ms (a few KB), 12–21 ms (100 KB–1 MB), ~55–75 ms (6 MB) | same |
| a NUL inside a string | truncates it (`"a\0b"` is stored as `"a"`) | same |
| a **malformed** file | read as empty; **the next `set` overwrites the file, discarding every other key** (also other projects' and EXODUS's) | same |
| a **missing** file | recreated by the first `set` | same |
| a **read-only** file (write cannot happen) | **`set` returns normally, `get` reads the value from memory, the file is not written, nothing is logged** — a failed write cannot be detected from Lua | same |
| Lua environment | no `io`, `os`, `load`, `loadfile`, `dofile`, `package`, `debug`; **`toJSON`/`fromJSON` exist in both** (nlohmann: 17-digit doubles, `fromJSON` of bad text raises a catchable error); `require` exists | same; plus `setPlayerShipCustomFunction` (2026 only) |
| player-station buttons | `PlayerSpaceship:addCustomButton(position, name, caption, callback)` | same method on the entity |
| scenario start choice | header `-- Setting[Name]: …` / `-- Name[Option|Default]: …`, read by `getScenarioSetting("Name")` | same |

Consequences: (a) **one JSON string per checkpoint** is the only atomic unit (a single `set`); (b) a write failure or a corrupted store **cannot be detected from the scenario**
(no `io`, no read-back from disk) — stated as a limit, not hidden; (c) two logical copies in one file are **not** two physical backups; (d) no RNG, no real-time clock (`os` is
absent): identifiers are counters; (e) keep each checkpoint small (it is rewritten with the whole file on every save).

The property roundtrips (read → write → read → restore) are in `property-matrix.md`. Notably: positions and rotations are settable on every object; hull, hullMax and shields on
ships and stations; reactor/system health, heat, power, coolant, energy, weapon storage, scan probes, jump charge on player ships (and on CPU ships in 2024 only); **velocity has no
setter** (a restored ship starts at rest and takes its order again); `getOrder` is readable on CPU ships only.

## Decision

1. **Opt-in per project.** `project.campaign.persistence` (default `false`; migration `0005-campaign-persistence`). A project that does not enable it generates the Lua it always did
   (test). Persistence needs a start sector (the same condition as Change sector) and is refused by the build otherwise.
2. **One contract of what is kept** (below), the same for both engines wherever the engine offers it; a property an engine does not offer is listed as such, never faked.
3. **Format.** One JSON document per checkpoint (`toJSON`), version `1`, in ScriptStorage keys that never collide with EXODUS or other projects:
   `forge/<project>/index`, `forge/<project>/<game>/head`, `forge/<project>/<game>/a`, `forge/<project>/<game>/b`. A checkpoint is written to the slot **the head does not point at**,
   then the head is flipped (one small `set`): a crash between the two leaves the previous checkpoint current. Identity inside every checkpoint: format version, project id,
   **structural fingerprint** (sector, group, object, rule, beat and variable identifiers — not their tuning values), EE target, game id, sequence number, active sector.
4. **Campaigns and games.** `New campaign` always creates a **new game id** (a counter in the index) — it can never overwrite an existing game. `Resume campaign` takes the latest
   game of this project. The choice is a scenario setting (`Campaign`: *Resume or start new* — default, *New campaign*, *Do not save*), shown by EE before the scenario starts, so
   Forge need not be open and EXODUS plays no part. **A save that cannot be resumed is never loaded partially and never replaced silently** (amendment below): the start is *blocked* and a new
   campaign is an explicit choice.
5. **Commands during play.** *Save checkpoint*: a custom button on the player ship's Engineering station and a GM button; *New campaign* and *Resume campaign* are the setting above
   (EE offers no in-game menu for them); an automatic checkpoint is taken at the start of a new campaign and each time a Change sector completes.
6. **Frozen sectors.** An inactive sector's objects do not exist in the world (they are unloaded and restored from the snapshot), so nothing moves, repairs or fights there. Time:
   the **campaign clock** (global, continues across a restart: `saved clock + scenario time since the resume`) and a **sector clock** per sector that advances only while the sector is
   active. `elapsed` conditions and beats keep the campaign clock unless **scoped**: `beat.sector` / `rule.sector` (migration, default `null` = today's semantics) make a beat or a
   rule belong to a sector — evaluated only there, `elapsed` and `at` measured on that sector's clock, its state (fired, edge, beat index) kept in that sector's snapshot. Scope is
   never inferred from a name or from a *Current sector is* condition.
7. **Destroyed is not unloaded** (preserved). A snapshot records each object as **alive** (with its properties) or **destroyed**. A destroyed object is **never rebuilt**, so no
   callback fires and no reward repeats; the runtime keeps a persisted `dead` set so `Object destroyed`/`Group wiped out` stay true for it. An unloaded object is neither.
   A group is **never appeared / appeared**; only appeared groups are restored; a group with on-call timing that has not been called stays absent.
8. **Order of a restore** inside a transition: create every alive object of the destination (initial settings), apply the saved properties, **then** re-link orders and targets
   (an order whose target is dead or absent falls back to *idle* and is logged). **The destination is built before the old sector is unloaded**, inside `pcall`: if building it fails,
   the partial objects are removed, the old sector is untouched, the ship stays and the request is refused with a message.
9. **Transition checkpoint.** (1) validate; (2) snapshot the old sector (read-only); (3) write a *pre-jump* checkpoint = the old sector's final state, still active (so a crash in
   the middle resumes in the old sector, never in a mix); (4) sweep the crew's temporaries (ADR-0057); (5) build the destination; (6) unload the old sector; (7) place the same
   player ship; (8) write the *arrival* checkpoint (new active sector). A failure in 5 aborts before anything is unloaded.
10. **Temporaries (ADR-0057) are not saved.** Mines, probes and missiles are swept at a jump and are **not** in a checkpoint: after a resume they are gone (a mine the crew laid is not
    restored). Stated in the interface and the guide; this is not a full snapshot of the world.
11. **The player ship after a restart is a new entity.** It is recreated from the project and given the saved state (position, heading, hull, shields, energy, systems, weapons stock,
    probes). Its identity as a process object is not preserved.

### The contract: what a checkpoint keeps (v1)

Kept: active sector; campaign and sector clocks; global and object **variables**; for rules and beats: fired flag, edge state, beat index (global, and per sector for scoped ones); for
every map-placed object, by **project id**: alive/destroyed, position, rotation, and where the engine offers it **hull, hull maximum, shields (every segment), energy, system
health/heat/power/coolant (on a player ship: the engineer's slider *requests*), weapon stock, probe count, jump charge**; the **last order a Forge action gave** (with its object references, re-resolved by id); the **dialogue assigned by
a Forge action**; which groups have appeared. Shared objects and the player ship are in the campaign part.
Rebuilt from the project: everything not listed (model, template stats, faction, callsign, comms script of an untouched object, planets' textures, orbits, zones).
**Not kept** (and said so; the observed behaviour on both engines is in the amendment "What a resume really gives back"): velocity (no setter), missiles/mines/probes/effects, tube contents and reload
progress, docking state, **scan state of any object** (complete or partial), GM-created objects, objects the scenario or EXODUS made outside the map, the camera, anything the crew set that a Forge action did
not (alert level, shields up/down, beam frequency, selected target), EXODUS state, and the state of EXODUS steps/timers.

## Alternatives rejected

- **`setScenario(next_file)` per sector** (the Odysseus flow) — it replaces the scenario: no shared variables, no Shared objects, no same ship; and it persists nothing.
- **A save file written by Forge or EXODUS** — would make play depend on them.
- **Writing the files with `io`** — not available in either engine.
- **One key per object / per sector** — many small `set`s are many whole-file rewrites and cannot be atomic together.
- **Rebuilding every group and destroying the dead** — fires callbacks and rewards.
- **Inferring a rule's sector from a *Current sector is* condition** — the same condition is used for other purposes; scope is explicit.

## Limits (stated, not hidden)

- **A failed or torn write cannot be detected** from Lua; the engine overwrites a malformed store with the next `set`. A corrupted store loses every key in it (also EXODUS's).
  Mitigation inside the contract only: the double slot protects against an interrupted *sequence* of writes, not against a damaged file.
- The store is a plain file in the engine folder: copying the folder copies the campaign; two installs have two stores.
- A save from an edited project is refused when its fingerprint differs (structural change); tuning edits do not invalidate a save.
- **A whole-file corruption is invisible to the script.** If `scriptstorage.json` is damaged as a whole, the engine presents an empty archive: the runtime sees no campaign, i.e. a first start, and the next write replaces the
  file with every other key in it. Resume's block does **not** protect against this case (measured on both engines). The optional backup utility (below) protects only up to its last copy.
- Everything in the contract is verified on the real engines only where the "Verified" section says so.

## Amendments made by what the engines showed

- **The saves write their own JSON.** EE 2024's `toJSON` raises `invalid key to 'next'` for a table holding a nested table with two or more keys (found when the first live run on 2024 wrote only the index); the first
  design used the engines' `toJSON`. A small writer in the generated Lua (`P.encode`) replaces it on both engines; reading uses `fromJSON` (checked on both; 2024 mangles integers beyond 32 bits, which the data never holds).
- **The message trail.** Headless EE 2026 does not echo a script's `print` into its log, and every engine shows a message for a moment and forgets it. The save system therefore also leaves its last eight messages in
  `forge/<project>/messages` (written only while saving is on): a support tool, or a driver reading the file, can see why a resume was refused.
- **The Engineering button's station key** is the enum string on 2024 and a lowercase key on 2026 (`addCustomButton`); both were confirmed by a real click.
- **A new action, `save_checkpoint`,** lets the author put a checkpoint at a story moment (it was needed for a deterministic test and is useful on its own); it needs saves to be on.

## Amendment 2 (12 October 2026, later) — a resume is never silently replaced; honest wording; backups

Found by reviewing the first version against the engines' limits; evidence in `docs/verification/campaign-persistence-recovery/`.

1. **A failed resume blocks the start.** The first version started a *new* campaign beside a save it could not use. That hides a loss from the crew. Now (all of this is generated Lua, no Forge or EXODUS at play time):
   - Three situations are told apart and worded differently: **no previous campaign** (a first start, announced as such), **damaged** (not readable as a save: not JSON, missing parts, a head that does not match) and
     **incompatible** (readable, but made by another format version, another EE build, another project, or a project whose structural fingerprint changed). A save that read but could not be rebuilt is a third failure ("could not be rebuilt").
   - **Recovery policy before giving up**: (1) the slot the head names; (2) the other slot, which must be an **older** checkpoint — the message names the one recovered and the one lost; (3) if the head itself is unreadable, the
     readable slot with the higher checkpoint number. Nothing is rewritten by the recovery itself.
   - When nothing can be recovered the runtime enters a *blocked* mode **before anything is built**: no campaign object, no `tick_beats`/`tick_rules`/`advance` (update returns first), no GM buttons of the project, nothing written
     (except the message trail, a key of its own; not even that when the list of campaigns is unreadable). **One stock ship, `NO CAMPAIGN`, is the only thing that exists**: a first real-window run showed that neither engine displays a global
     message on the ship-selection screen (it says "Waiting for server to spawn a ship" and nothing else), so with no ship the crew could not read why. The holding ship belongs to no sector and no campaign; the crew selects it, reads the message
     as the ship's-log banner on its station (measured: that banner, not the global message, is what a crew sees) and chooses from its **Engineering station** (`Start a NEW campaign`, `Play without saving`) or the GM from the GM console. The game is unpaused for the
     duration (a paused game runs no `update()`, so a reminder or a choice would never happen); the reminder is repeated every 20 s as a global message and a ship's-log entry, in **one short line** (measured: a station shows a message as a banner one line high at the top and clips what does not fit — a four-line message showed only its last line — so every routine message is one line and the long explanation goes to the log, the GM and the file). The message says what is wrong (damaged / incompatible), that nothing runs
     and nothing was changed, and how to go on: press the button, or end the game, choose the scenario again, set *Campaign = New*, start. The choice is carried out by the next `update`, not inside the button's own callback; the holding ship is removed (its
     station says SHIP DESTROYED — the message tells the crew to press Return and choose the campaign's ship); the new campaign's clock starts from its own zero and the old save is never touched. The buttons are refused when the game is not blocked.
   - An unreadable **list of campaigns** blocks too, and only *Play without saving* is offered: a new campaign could not be filed without overwriting the list (and its counter), which would let a later "c1" overwrite a surviving game.
2. **Honest save wording.** `ScriptStorage:set` returns normally when the disk write fails (a read-only file), and a read-back is answered from the engine's memory (measured: memory held checkpoint 4, the disk checkpoint 3). So nothing says
   "saved": the messages say **"Checkpoint N sent to the save file. The game cannot confirm it reached the disk."** — the checkpoint was prepared and a write was requested, which is all a script can observe. The proof of a save is the next start. A test pins that the
   generated Lua carries no "saved to disk" claim.
3. **What a resume really gives back** (measured on both engines by changing the ship's state, requesting a checkpoint, closing EmptyEpsilon and starting it again — `live/c26-contract.json`, `c24-contract.json`, `…-revisit.json`):
   velocity → the ship comes back at rest at its saved position and heading; loaded tubes → empty, and a missile that was loaded is **lost** (the store was counted without it); mines/probes/missiles already launched → gone; the probe *store* → back;
   docking → undocked; scans → every object unscanned (also on a revisit inside one run); alert level, shields up/down, beam frequency, selected target → engine defaults after a restart (within a run, across a jump, it is the same ship and keeps them);
   outside-map objects → gone. One inconsistency with the first contract was found and **fixed**: the engineer's power and coolant sliders were not restored on a player ship (the engine snaps a plain `setSystemPower` back to the slider request on the
   next tick: 2.0/4.0 came back as 1.0/0.0, before-fix evidence in `live/before-power-fix/`); on a player ship the saved values are now written as slider *requests* (`commandSetSystemPowerRequest`/`…CoolantRequest`). No other property was added.
4. **Backup.** The two slots are one file, so there is no physical backup inside the contract, and the engine offers no `io`/`os`. What can be delivered without EXODUS, without Forge open, without a service and without touching the engine is a **manual utility**, shipped
   beside the program (`Save backup tool\forge-save-backup.ps1`, Windows PowerShell): `backup` (a dated copy on a path the user names, never over an older one, accepted only if the copy is valid JSON and identical to what was read, the source never modified, no copy made from
   a damaged source and the older copies left alone), `list`, `check`, `restore` (the user names both the backup and the destination, types RESTORE, a copy of the file being replaced is kept first, refused while EmptyEpsilon runs from that folder, never automatic). It needs
   EmptyEpsilon closed. It validates **JSON, not campaigns**: the scenario decides at the next start whether a checkpoint is usable. It protects nothing made after the last copy. Not built: a daemon or watcher (it would be a service the user must run and trust).

## Verified

Evidence in `docs/verification/campaign-persistence/` (README there). Increment by increment:

1. **Feasibility** — ScriptStorage probed on both engines (types, the file, the moment of writing, restart, missing/malformed file, a read-only file, size and cost) and a property roundtrip per object type and engine
   (`property-matrix.md`). Outcome: the format above; two engine limits stated (a failed write cannot be detected; a damaged store is replaced together with every other key).
2. **Same-run persistence** — the generated Lua in a mock world (66+ tests, both targets) and the simulator, second by second (`campaign-persistence.test.ts`); then on the real engines: A → B → A with the destroyed enemy not
   rebuilt, the damaged station, the moved ship, the reward not repeated and the local timer frozen.
3. **Write and resume after a restart** — real engines (headless), the scenario installed through Forge's own Install dialog, EmptyEpsilon stopped and started again, what the save holds read **from the file on disk**:
   22/22 on EE 2024 and 22/22 on EE 2026, including a real kill after the resume and a repeated jump.
4. **Interface and complete test** — the editor (Campaign page, scope, action) in Electron and in a browser, 21/21 each; a **real window with real mouse clicks** on both engines: the *Campaign* setting on the screen before the
   game, the *Save checkpoint* button on the Engineering station, EmptyEpsilon closed, started again, *Resume*, then *New* chosen with the arrow (12/12 each); edge cases against the file (several games, New never overwrites,
   Off writes nothing, a malformed head, an incompatible structure, an unreadable newest slot, an unreadable list, other tools' keys).
5. **Amendment 2** (`docs/verification/campaign-persistence-recovery/`, README there) — against stores prepared on disk with EmptyEpsilon closed, then started for real: recovery of the previous checkpoint, a head recovered from its slots, a blocked resume for *damaged* / *incompatible* / an unreadable list
   (nothing built, nothing written, the explicit choices working afterwards), a first start, a whole-file corruption (indistinguishable from a first start — declared) and a read-only file (the message promises nothing the engine does not offer): **30/30 on each engine**; what a resume gives back, per property: **11/11 each**, and across a revisit
   **5/5 each**; the backup utility (24 checks on temporary files, 6/6 end to end with each engine); the decisive journey repeated on the final build **22/22 on each engine**; a real window with the mouse **20/20 on each engine** (the holding ship, its buttons, a real click on *Start a NEW campaign*, then the *Campaign = New* route);
   the editor 25/25 (Electron and browser) and the full Electron suite 585/585; the program extracted from **installer 0.9.0** 81/81 (`395f576c…`).
   The first real-window run of the blocked state found that nobody could read the message (no global message on the ship-selection screen): the holding ship and the one-line banner came from it.

**Not verified:** the installer **procedure** (the 0.9.0 program was run from its extracted files, not through Setup); EXODUS with sectors or with saves; a crash in the middle of a write (the engine offers no way to provoke or observe one); a very large store; a campaign across two EmptyEpsilon builds of the same
version; what the player ship's *identity* is for scripts that outlive a restart; the one-line blocked reminder as a banner on a station (photographed only for the routine checkpoint message and for a longer reminder that was clipped); a crash in the middle of a write; the utility on a machine without Windows PowerShell 5.1.
