# EE FORGE — authoring EmptyEpsilon content from a project document

> How to author maps, ship classes, factions, models and narrative logic as
> data, and render them to **vanilla EmptyEpsilon Lua**.
>
> Decision record: [ADR-0034](../adr/0034-ee-forge-content-editor.md).
> Companion to root `CLAUDE.md` and [scenarios.md](./scenarios.md) (which
> still governs hand-written chapters).

---

## 1. What it is

One JSON document per project — `projects/<id>/project.json` — holding five
sections: `factions`, `models`, `templates`, `map`, `logic`. `forge:build`
renders it into three Lua files you copy into `<EE>/scripts/`:

| File | Contents |
| --- | --- |
| `<id>_content.lua` | factions + model data (idempotent) |
| `<id>_map.lua` | `spawn()` / `spawn_group(name)`, both returning the created handles |
| `scenario_<id>.lua` | the EE-loadable scenario: header, `init()`, `update(delta)` |

**Ship templates are the exception.** EE refuses to create them from a
scenario — `[ERROR]: ShipTemplate objects can not be created during a
scenario.` — so a project that defines any gets a fourth file with a
different lifecycle:

| File | Destination | Note |
| --- | --- | --- |
| `<id>_templates.lua` | `<EE>/scripts/shiptemplates/` + one `require` line in `shipTemplates.lua` | **Requires an EE restart**: templates load only during engine launch |

**Custom models ride in that same file**, ahead of the templates. A
template resolves `setModel()` during `shipTemplates.lua`, before any
scenario runs, so a scenario-registered model produces `Failed to find
model data` and a silent fallback mesh. Splitting models by usage would let
a reference moved from an artifact to a template break the mesh quietly, so
there is one rule: all project models are launch-time.

So a project with neither custom ship classes nor custom models is a pure
drop-in; one with either costs an extra file, one line in an EE-owned file,
and a restart. See [ADR-0034 §3](../adr/0034-ee-forge-content-editor.md)
for the correction and its evidence.

The generated Lua is plain EmptyEpsilon. No EXODUS install, no bridge, no
`exodus_bridge.lua` — unless the project explicitly opts into the exodus
tier (§6).

**The Lua is a build artifact.** Edit the document, re-run the build. Hand
edits to generated files are overwritten, and the forge never reads Lua back.

---

## 2. Commands

```bash
# Regenerate the API catalog from a pinned EE install (rarely — on EE upgrade)
pnpm --filter @forge/core ee:catalog --ee-install "$EE_DIR"

# Index the install: templates, models, factions, resources
pnpm --filter @forge/core ee:scan --ee-install "$EE_DIR"

# Start a scenario from scratch (the editor's "+ New" does the same thing)
pnpm --filter @forge/core forge:new "Ghost Fleet"

# Dry-run the narrative on a virtual clock — no EmptyEpsilon needed
pnpm --filter @forge/core forge:simulate projects/forge_demo --until 240 \
    --events my-events.json

# Render the bundle (optionally straight into the EE install)
pnpm --filter @forge/core forge:build projects/forge_demo \
    --library projects/ee-library.json \
    --install "$EE_DIR" \
    --patch-shiptemplates      # only needed when the project defines templates
```

`--library` is optional but worth passing: with it, references to stock
templates and factions are checked instead of warned about.

`--install` only ever *copies* files. The one line it would add to an
EE-owned file (`shipTemplates.lua`) is printed unless you also pass
`--patch-shiptemplates`; the patch is idempotent and keeps the file's
existing line endings. The editor's **Install scenario** does the same
through the bridge, patching the require line — that is the whole point of
installing from there.

**A running EmptyEpsilon holds handles on the scripts it has loaded** — and
leaks one when a load errors part-way. Installing over a file EE is holding
fails with `EACCES`; the CLI reports which files were locked and continues
instead of aborting halfway. Close or restart EE and re-run.

---

## 2b. The editor

```bash
./scripts/launch-forge.sh          # bridge + editor, then open http://127.0.0.1:5176
./scripts/launch-forge.sh --stop
```

Deliberately not part of `launch-playtest.sh`: that script boots a live
session for players, and an authoring tool has no business starting during
a playtest. EmptyEpsilon does **not** need to be running — the editor reads
the committed catalog and the scanned library from disk.

**Starting from scratch.** **+ New** in the toolbar asks for a name and
nothing else: the id is derived from it and stepped around anything already
taken, and the bridge refuses an id that exists rather than overwriting a
scenario. A new project is not the empty document — it opens with one
`on_start` group and one player ship, because with no group a placed object
has nowhere to go, and `target: {ref:"player"}` resolves statically, so a
map with no player ship (or two) is a build error. Both are deletable. It
builds the moment it is created.

**Ids are editable.** The inspector's first field is the object's id — the
handle the rest of the document holds it by. Placing gives you `planet`,
`planet_2`; renaming one to `gas_giant` carries every reference with it: a
moon's `orbit.targetId`, a rule's trigger, an order's target, a formation
leader, a zone named by `player_in_zone`. It commits on Enter or on leaving
the field, and refuses an id that is empty, malformed or already taken,
saying which — a rename that half-applied would be worse than one that did
nothing.

**Canvas.** Top-down, EE's axes exactly (x right, y south — flipping y
would produce maps that mirror in game). Wheel zooms about the cursor, the
grid labels itself in U, and the mouse is split by button: **right drags
the map** (anywhere, including over an object), **left works on objects** —
click one to select it, drag one to move it, drag on empty space to pull a
rubber band over everything you want. Shift adds to the selection instead
of replacing it, and Delete removes what is selected. The band catches an
object by its **centre**, so sweeping a belt takes exactly the rocks you
swept, rather than a distant planet whose edge the band happened to clip. Objects with real extent
are drawn to scale — planet radii, nebula 5 U, warp-jammer range, mine
trigger radius, asteroid size — so overlaps are visible before EE finds
them. Zones render as their polygon and orbits as a ring around the parent.

**Colour is the faction's.** A ship, station or warp jammer draws in its
faction's own `setGMColor` — the value EE's `factionInfo.lua` declares and
the install scan records, with a project's own factions overriding a stock
name. So the question you ask looking at a map ("whose is that?") is the one
the canvas answers, and changing a faction in the inspector recolours the
object immediately. Everything without a faction — planets, asteroids,
zones — keeps its per-type colour, and so does an object whose faction name
neither the project nor the install knows, which is a typo the build warns
about.

**Icons are EE's own.** Ships, stations, mines, probes, black holes and
wormholes wear the radar sprite EmptyEpsilon draws for them, picked the way
EE picks it: from the template's `setRadarTrace`, which the install scan
records (`ship.png` / `blip.png` as EE's documented fallbacks). So a Phobos
T3 looks in the editor exactly as it will look to Relay, instead of the
author learning a second visual language. The sprites are white on
transparent — EE's requirement for that setter — so the canvas tints them
with an SVG mask rather than shipping a coloured copy per faction.
Hulls rotate with their heading; stationary furniture stays upright, as in
game. Nebulae, asteroids and zones deliberately get **no** icon: they are
already drawn at true radius, which carries more than a glyph.
Sprites live in `assets/radar/` (GPLv2, attribution in that directory) and
are served by the bridge's existing `/assets/` mount.

**Planets wear their texture.** A planet's disc is filled with the very
file the project assigns it — the one EE receives through
`setPlanetSurfaceTexture` — clipped to the body's true radius, so a system
reads as a system at a glance instead of as a row of identical circles.
The ring around it is the planet's atmosphere colour
(`setPlanetAtmosphereColor`, EE's 0..1 floats converted to CSS bytes),
a band scaled to the body — taken *out* of the disc, not added around it,
so the planet still ends exactly at its true radius and the map keeps
telling the truth about overlaps. It is the one per-planet colour EE
renders outward from the surface, so tuning it belongs where it shows. A
planet with no atmosphere colour keeps the same band, dimmer: "unset" and
"set to something dark" should not look alike.

A planet that names a cloud map (`setPlanetCloudTexture`) also wears it,
over the surface and cropped the same way. EE's cloud files are greyscale
with no alpha — white is cloud, black is clear sky — so the editor uses
them as a luminance mask rather than painting them on, which would lay a
black film across half the body.

**Nebulae wear EE's billboards** the same way, screen-blended so the dark
parts of the file add nothing to the map, with the 5 U outline kept on top
— that circle is the interference radius a crew feels, and a soft-edged
cloud cannot express it. One honest difference from planets: a nebula's
texture is *not* something a project states. EE assembles each nebula from
billboards it picks at spawn and exposes no setter for them, so the editor
picks one deterministically from the object's id. The map looks the same
every time you open it, but the particular cloud is indicative rather than
a prediction. A planet with no atmosphere colour keeps the palette
tone, and a tinted base disc sits under the texture so a body stays visible
and clickable while the image loads or if its file isn't served. Once the
disc is bigger than a marker dot the dot disappears — the disc is the
marker. All 21 stock textures are in `assets/planets/` (GPLv2, same mount),
which is the complete set the inspector's picker offers.

**Placing.** Pick a type from the palette and click. The object arrives
schema-valid, with a stock template where one is needed and a callsign
assigned from `docs/authoring/naming-convention.md`. Drag to move (snap
defaults to 0.1 U), `Delete` to remove, `Escape` to deselect.

**Scatter brushes.** Belt, cluster and field, each with a seed and a count.
Arm the brush and click the map to set its centre: the shape's outline
follows the cursor while armed — snapped like everything else — so you can
see whether the belt clears the station before committing to it. Changing a
setting with the brush armed updates that outline, because the brush lives
in the store rather than in the panel. One click drops one scatter and
disarms; Escape cancels. (Fourteen asteroids are a lot more to undo than
one misplaced object, which is why it does not stay armed the way object
placement does.)
Scattering **asteroids** (either kind) also offers a size band: each rock
draws its own size from it, using the same seeded RNG that places it, so a
belt reads as rubble rather than as fourteen identical pebbles. The default
110–130 is the band EE's own asteroid fields sit in, and it is a default and
not a limit — `Asteroid:setSize(number size)` documents no bounds, and EE's
scripts go well outside it on purpose. Mines and nebulae have no size in the
model, so the control is not offered for them.

The scatter is computed in TypeScript at authoring time and stored as
literal coordinates, so the generated Lua contains no RNG and the preview
cannot drift from what EE loads. Every member of one scatter shares a
single `TT-SS-NN` callsign — the convention's golden rule, and what makes
downstream grouping work.

**Groups.** The tree switches which group new objects land in and dims the
others. `on_start` / `on_call` is a first-class control because it is the
seam between the map and the narrative.

**Colours are picked, not typed.** A colour field is a swatch; clicking it
opens a grid of 1024 — a greyscale ramp in the first column, then 31 hues
darkening upward and lightening downward from a fully saturated middle row,
so `#ff0000` is in the grid exactly rather than nearly. The picker works in
bytes and writes back in the field's own scale, which is not the same for
every EE setter: factions, zones and radar traces take 0..255 integers, a
planet's atmosphere takes 0..1 floats. A colour that came from elsewhere —
a hand-edited project, an imported faction — shows faithfully on the swatch
even when it is not one of the 1024; it simply highlights nothing.

**Numeric fields let you finish typing.** They keep half-typed text — a
lone `-`, a trailing `.`, a bare `1e` — instead of coercing it, and write
to the document only once it is a complete number; clearing a field that
may hold nothing unsets it, clearing one that must hold a number leaves the
last value alone. Arrow keys step, Shift ×10. A value outside the field's
declared bounds turns the border red instead of being blocked, so a number
the schema will refuse is visible while you write it rather than at save.

**Inspector.** Fields come from one descriptor table in the toolkit, and a
test asserts it covers every key of every object schema — a field can't go
missing silently. Help text comes from the generated catalog: the tooltip
on *Radius* is EmptyEpsilon's own prose for `Planet:setPlanetRadius`.
Template, faction, model, radar-trace and planet-texture pickers are filled
from the scanned install, with anything the project defines itself offered
first.

**Save and build** go through the bridge (`PUT /forge/projects/:id`,
`POST /forge/projects/:id/build`). Build always saves first — building a
stale document would be a quiet lie. The result line names the files and,
when the project defines templates or models, says plainly that the
launch-time install and an EE restart are required.

## 2c. Targets: EE 2024 and EE 2026

`project.eeVersion` is a real selector. `EE_TARGETS` (`src/targets.ts`) lists the
verified engines; `loadCatalog(project.eeVersion)` returns that engine's catalog and
`buildProject` refuses a catalog or library from another engine, and any version that is
not registered (a new prerelease is a target to verify, not one assumed compatible).
Engine-specific Lua is chosen from the target: `set_dialogue` restores a default comms
script via `typeName` on 2024 and ECS components on 2026. Install detection
(`detectInstallTarget`) hashes the install's `script_reference.html` against the recorded
provenance; unrecognised installs may be scanned only with an explicit version and are
reported unverified. Per-target libraries live in `projects/libraries/<target>.json`.
Regenerate a catalog with `ee:catalog --ee-install <dir>` (version detected) and update
`catalog/provenance.json`; `targets.test.ts` fails if the two disagree.

## 2d. Services, installations and browser mode

The editor talks to Forge's services (`@forge/app`, ADR-0048) through a transport, never to
a fixed host. Two ways to run it:

```bash
# Forge on its own — nothing of EXODUS needed (browser mode):
pnpm --filter @forge/web-forge build   # once; package name is @exodus/web-forge today
pnpm --filter @forge/app serve -- --projects-dir projects --assets-dir assets \
     --static-dir packages/web-forge/dist --port 8092      # then open http://127.0.0.1:8092/
# Development with hot reload: serve as above (no --static-dir), then
FORGE_API_URL=http://127.0.0.1:8092 pnpm --filter @exodus/web-forge dev

# With the EXODUS bridge (same editor, same router, legacy /forge/* paths):
./scripts/launch-forge.sh
```

**Installations** are registered with `POST /forge/installations {path}` (or by Rescan in the
editor). `verified` means the install's `script_reference.html` matched a known build; an
unrecognised folder can be registered only with an explicit `eeVersion` and stays unverified.
Each install owns `libraries/<id>.json` and `cache/<id>/assets/` under the projects directory
(both git-ignored), so two engines never overwrite each other's names or images. Images and
models are served at `/forge/assets/<path>?target=<engine>`: that engine's cache first, then
the bundled `assets/`. The library and catalog follow the open project's `eeVersion`.

## 2e. The desktop app (ADR-0051)

EE FORGE as an application window: the same editor, the Forge services running inside the app, **no server, no port,
no terminal to leave open, and nothing of EXODUS needed**. (Increment 5: runnable and tested; the installer and the
icon are increment 6, so today it is started from a checkout.)

```
pnpm --filter @exodus/web-forge build && pnpm --filter @forge/desktop build   # → packages/forge-desktop/dist
pnpm --filter @forge/desktop start                                            # opens the window
```

| You want to… | In the app |
| --- | --- |
| keep your work somewhere | **Settings → Change projects folder…** (default `Documents\EE FORGE\Projects`). Settings, the install registry, indexes and image caches live apart, in your user data folder. |
| bring in a project | **Import…**: pick the project folder (or its `project.json`). A **copy** is stored under a free id; the original is never written. |
| tell Forge where EmptyEpsilon is | **Installations… → Add EmptyEpsilon folder…** (once per engine). The version is read from the install itself; a folder Forge cannot identify can be registered only by declaring its version, and stays marked *not verified*. **Rescan** indexes textures, templates and models per install. |
| hand a scenario to a game | **Export…**: choose *this project’s engine*, *2024*, *2026* or **both** — two separate bundles, each built against its own engine — and *Vanilla* or *With EXODUS*; then pick the destination folder. Each bundle is laid out like an install (`scripts/…`) with an `export-report.json`. Nothing is copied into an install. |
| put a build into a game | choose an installation in the view bar's EmptyEpsilon group, **Install scenario** (adds the `require` line ship templates need; restart EE afterwards). |
| lose nothing | closing the window, opening or creating another project, importing, or switching the projects folder with unsaved changes asks first: **Save / Don’t save / Cancel**. |

Every file or folder you choose is chosen in the operating system’s own dialog; **dismissing it changes nothing**. The
editor itself never sees a path: it refers to an installation by id, and the shell refuses any request that carries a
path.

**EXODUS is optional and off.** Without it you edit, simulate and export vanilla scenarios. To include EXODUS code in an
export, **Settings → EXODUS (optional) → Choose module…** (an extension module file), then **Turn on**.
**Compatibility** (Settings, and the Export dialog) says what has really been run, per engine — *run in a real engine*,
*checked offline only*, *not verified*, *known incompatible*:

- vanilla export: the demonstration mission was run in an isolated copy of **both** EE 2024.12.08 and EE 2026.09.22PR;
- EXODUS with **EE 2026**: run with the real bridge in an isolated copy (ADR-0050 trial);
- EXODUS with **EE 2024**: **not verified — known incompatible**. The real bridge cannot talk to that engine. An
  integrated export for 2024 is still produced, with a warning; the vanilla export is never affected.

Tests: `pnpm --filter @forge/desktop test` (guard, settings, runtime, operations, bundle) and the Electron end-to-end suite
on Linux (`node packages/forge-desktop/e2e/run.mjs`) and on Windows (`bash scripts/desktop-windows-trial.sh`, from WSL).
The e2e suites replace the **native chooser** with scripted answers (Playwright cannot operate it); everything the app does
with an answer is real.

---

## 2f. The Windows installer and installing a scenario (ADR-0052)

**Installer.** `scripts/windows-clean-build.sh` (from WSL) or `packages/forge-desktop/scripts/build-windows.ps1` (on Windows) builds
`EE-FORGE-Setup-<version>-x64.exe`: NSIS, per user, no admin, Start-menu + Desktop shortcut with the icon, uninstaller, hardened Electron.
Unsigned. It runs `verify-package.mjs` on the result and refuses an installer that holds a developer path, an EmptyEpsilon/EXODUS file, a
test tool or a withheld asset. User guide (Italian): `docs/guida-ee-forge-windows.md`. Clean-machine procedure:
`docs/verification/windows-clean-test.md`.

**Assets and licences.** The installer ships no stock image and no stock hull model (`docs/licenses/asset-inventory.json`, rule in ADR-0052):
planet/radar/nebula images come from the user's own install on **Rescan**; hull previews show a labelled stand-in; the map draws plain
shapes where a sprite is missing. Notices: `docs/licenses/THIRD-PARTY-NOTICES.txt`.

**Installing a scenario** (`installBuild` / **Install scenario** / `forge:build --install`): preflight → backup → write+verify → restore on
failure, all-or-nothing. Statuses: `installed`, `installed-pending` (require line still missing), `refused` (collision with a file Forge did
not install / file held open), `rolled-back`, `rollback-failed`. `--overwrite` / **Install anyway** replaces foreign files after backing them
up (CLI backups: `<install>/.ee-forge-backups/`; the app keeps them in its own state folder). Templates and models are listed apart as
loading only at EE launch.

**Resizable panels.** Every view's side columns have a drag handle (Map: palette and inspector; Narrative: side column; Ships: lists and diagrams; DMX: preview).
Keyboard: arrows, Shift for big steps, Home / double-click to reset. Widths are remembered per view in the app profile (`localStorage`), clamped to each column's limits.

## 3. The catalog — why you cannot invent API here

`packages/forge-core/src/catalog/catalog.generated.json` is parsed out of the
`script_reference.html` that ships with the pinned EE install: 33 classes,
511 methods, 48 globals, 12 enums. Every call the emitters produce is
resolved against it, walking the subclass chain the way EE's bindings do.

A method that does not resolve is a **build error**, not an EE runtime
surprise:

```
CodegenError: SpaceStation:setSystemHealth does not exist in EE-2024.12.08
  — refusing to invent EE API (CLAUDE.md §0.3)
```

That example is real: `setSystemHealth` lives on `SpaceShip`, and
`SpaceStation` descends from `ShipTemplateBasedObject`, never from
`SpaceShip`. A test walks every generated file and asserts the same
property, so the rule holds for output as well as for input.

When EE is upgraded, re-run `ee:catalog` — **the JSON diff is the upgrade
impact report**.

---

## 4. Map

Objects live in **groups**. A group is either `on_start` (spawned by
`map.spawn()` from `init()`) or `on_call` (spawned by a `spawn_group`
action, which is how enemy waves stay part of the map while the narrative
decides when they arrive).

```jsonc
{
  "id": "ambush", "label": "Corsair raiding pair", "when": "on_call",
  "objects": [
    {
      "id": "corsair_a", "type": "CpuShip", "callsign": "SH-EN-01",
      "position": { "x": 15500, "y": 4200 }, "rotation": 200,
      "faction": "Corsairs", "template": "Corsair Mk2", "ai": "fighter",
      "description": null
    }
  ]
}
```

Fifteen object types are placeable — the classes a scenario can construct.
Missiles, beams and explosions are excluded: EE spawns those itself during
combat, they are never authored.

### Starting from a ship EmptyEpsilon already has

The Fleet view lists the install's own hulls under **From the install** —
168 of them on the pinned build, grouped by type and filterable by name or
class, with `hidden()` ones behind a checkbox as in EE's own picker.
Selecting one shows it in the same form used to edit your own, read-only,
with the firing arcs and deck plan beside it.

**Copy into project** writes the whole definition into your project under a
new name. It has to: EmptyEpsilon exposes no `getShipTemplate()`, so
`ShipTemplate:copy()` can only chain off a template the same file declared,
and there is nothing to chain off a stock one
([ADR-0041](../adr/0041-stock-ships-are-materialised-not-copied.md)).

Two things follow that are easy to miss:

- **Map objects keep the original.** A `CpuShip` spawning `"Atlantis"` goes
  on spawning EE's Atlantis; the editor offers to move them and the offer
  survives switching views.
- **Naming your copy after the stock ship redefines it.** EE accepts that —
  the last definition wins, so every scenario spawning the name gets your
  values — and logs `ERROR: Duplicate ship template definition` at launch.
  The inspector says so; it is a tool, not a mistake.

Templates load only when EmptyEpsilon starts. **Install scenario** (in the
toolbar's `Install…` disclosure) copies the bundle into the install and
adds the `require` line `shipTemplates.lua` needs, then says a restart is
due — which it always is, for a hull.

Notes that matter in practice:

- **Callsigns** follow [naming-convention.md](./naming-convention.md)
  (`TT-SS-NN[-III]`). The forge is where that convention finally gets an
  enforcement point.
- **Orbits**: `Planet.orbit` emits `setOrbit(target, orbitTimeS)`, and
  the emitter both orders the parent before the satellite and puts
  `setPosition` before `setOrbit` — EE locks the orbital radius to the
  distance at the moment of the call. Cycles are rejected.
  **The period is seconds for one full revolution, so a smaller number
  orbits faster.** EE's own documentation calls it "degrees per tick" and
  is wrong; the inspector shows the period back as a clock reading
  ("one revolution every 1h 00m") because a bare `3600` in a number box
  tells an author nothing, and a bare `3` told several of them the
  opposite of the truth. Zero is rejected — EE divides by it.
- **Zones** are polygons (`points`, minimum three). EE's reference claims
  they cannot be created over the `/exec.lua` HTTP API; a live probe
  (2026-08-09) shows they can, so a future live-push is not blocked here.
  Area triggers use EE's own `Zone:isInside` rather than geometry of ours.
- **Scan probes** default to `ownedByPlayer: true`; EE hard-faults on
  `getOwner()` for an unowned probe.
- **A CpuShip needs an order, or it does nothing.** See below.
- **No RNG is ever emitted.** Scatter and clusters are computed at
  authoring time and written as literal coordinates, so what you designed is
  what loads, every time.

`spawn()` and `spawn_group()` return the handles they created. That is the
entire EXODUS integration story:

```lua
for _, o in ipairs(forge_demo_map.spawn()) do bridge:track(o) end
```

### 4a. Markers — naming a place once

Several things in a project are *somewhere on the map*: a proximity
trigger, a patrol anchor, a waypoint, a wormhole's exit. Written as bare
coordinates they are unrelated number pairs that happen to match, and
moving the encounter means finding every one of them.

A **marker** is a named place. Drop one with the **⌖ Marker** button in the
palette, then point records at it instead of typing numbers. Move the
marker and everything that names it follows.

```jsonc
"map": {
  "markers": [
    { "id": "ambush_point", "label": "Ambush point",
      "position": { "x": 4200, "y": -1600 }, "notes": null }
  ],
  "groups": [ /* … */ ]
}
```

**A marker is not an EmptyEpsilon object.** EE has no marker class and none
is invented (root §0.3): nothing spawns, players never see it, and it costs
nothing at runtime. Every reference is resolved to literal coordinates when
the project is built — the emitted Lua is byte-for-byte what the same place
typed by hand would have produced, and a test pins that.

Markers live beside the groups rather than in one, because a group decides
*when its objects spawn* and a marker never spawns.

**Where a marker can be used** — every field that is a place:

| | Field |
| --- | --- |
| Trigger | `player_near_point` |
| Order actions | roam around a point · defend a location · fly towards · fly towards (blind) |
| CpuShip | the **Defend location** spawn order |
| WormHole | **Exit** |
| ScanProbe | **Target** |

Each of those offers *Coordinates* or a marker, and coordinates stay
first-class: most places in a scenario are mentioned once, and forcing a
marker for those would be ceremony.

**Three places that look similar and are not**, deliberately left as raw
numbers: a formation's **offset from its leader** (a displacement, not a
place — a marker there would read as a destination), a **zone's corners**
(the polygon *is* the shape), and an **object's own position** (the object
is already the thing there; `player_near_object` refers to it).

Renaming a marker carries every reference with it. Deleting one that is
still referenced is reported in the toolbar by name, and the build refuses
the document — `these markers are referenced but not defined: "…"` — rather
than emitting a trigger at the wrong place.

Decision record: [ADR-0038](../adr/0038-markers-are-authoring-only-places.md).

---

### 4b. Combat AI and orders are two different things

EE says it plainly in `setAI`'s own documentation: *"Combat AI states
determine the AI's combat tactics and responses. **They're distinct from
orders**, which determine the ship's active objectives."*

| | What it decides | Where you set it |
| --- | --- | --- |
| **Combat AI** — `setAI` | *How* the ship fights: `default`, `evasion`, `fighter`, `missilevolley` | Inspector → **Combat AI**; the hull's **Default combat AI**; or a *Set combat AI* action |
| **Order** — `order*` | *What* the ship is doing | Inspector → **Order**; or one of the twelve *Orders* actions |

The GM console in game shows the **order** — Idle, Roaming, Stand Ground,
Defend Location. It never shows `fighter` or `missilevolley`, which is
what makes the two look like conflicting lists of the same thing.

**A ship built with neither is Idle**, verified against a live EE
(2026-08-13): `CpuShip()` with nothing else set answers `getOrder() ==
"Idle"`, and EE documents Idle as *"don't target or attack nearby
enemies"*. So a fleet placed on the map and never ordered sits motionless
for the entire session — combat AI does not start a fight, it only shapes
one.

The inspector's **Order** field is the fix. It offers the four orders EE's
GM console exposes, because those are the four that need no target:

| Order | What the ship does |
| --- | --- |
| Idle | Stays put, ignores everything |
| Roaming | Roams and engages at will |
| Stand ground | Holds position, attacks what comes near |
| Defend location | Patrols within 1.5 U of a point |

*Defend location* seeds its point with the ship's own position, so the
common case — "hold this station" — is right without touching it.

**A newly placed CpuShip defaults to Roaming**, which is the one place the
editor departs from EE's own default on purpose: a ship that stands still
through a whole playtest reads as a broken build, and Idle is one click
away. Ships in projects authored before this field existed have no order
and stay Idle until you give them one.

The remaining eight verbs (`orderAttack`, `orderDock`, `orderFlyFormation`
and the rest) need a target object or a live tactical read, so they stay
in the narrative actions where a trigger can supply one — see §5.

---

### 4c. Sectors — organising the map into places (ADR-0055)

A scenario that visits several places — star systems, somewhere reached by a jump — organises its map as
**Sector → Group → Object**. A *sector* is a named part of the map the author works on; a *group* keeps exactly the meaning it
had (a set of objects with a way of appearing); there is nothing below groups. **Shared** (sector `null`) holds what several
sectors have in common, such as the player ship.

```jsonc
"map": {
  "sectors": [ { "id": "system_a", "label": "System A" }, { "id": "system_b", "label": "System B" } ],
  "groups": [
    { "id": "player", "label": "Player ship", "when": "on_start", "sector": null, "objects": [ … ] },
    { "id": "a_patrol", "label": "A · Patrol", "when": "on_start", "sector": "system_a", "objects": [ … ] },
    { "id": "b_ambush", "label": "B · Ambush", "when": "on_call", "sector": "system_b", "objects": [ … ] }
  ],
  "markers": [ { "id": "gate_b", "label": "Gate B", "position": { "x": 14000, "y": 200 }, "notes": null, "sector": "system_b" } ]
}
```

- **A sector is authoring organisation only.** It adds no game rule, never changes when a group spawns and is never emitted:
  moving a group between sectors, renaming a sector or adding one leaves every generated Lua line as it was (the provenance
  comment `-- sha256 …` names the hash of `project.json`, so *that one line* follows the document). Moving a group keeps its id,
  its objects' ids, coordinates and properties, every rule and dialogue that names it, `At mission start` / `When a rule spawns
  it`, and its position in `map.groups` (the generation order). The editor lists groups in that order within each sector.
- **What the documentation must keep saying:** hiding something in the editor does not remove it from the game; changing sector
  in the editor does not change the sector during play (there is no *Change sector* yet, no teleport, no unloading or restoring
  of object state); a *Destroy* action can still satisfy *Group wiped out*; a new *Spawn group* recreates its objects from their
  initial settings.
- **Deleting a sector never deletes its contents.** An empty sector is removed; one that holds groups or markers needs a
  destination (another sector, or Shared), and they move there whole.
- **Migration.** `0003-sectors` (schema 2 → 3) adds one initial sector (`sector-1`, “Sector 1”) and files every group and marker
  under it. Nothing is inferred from names. A new scenario starts the same way.
- **Checks.** Two sectors with one id, or a group/marker filed under a sector that is not there, block the export (and are listed
  in Problems: `duplicate-sector`, `dangling-sector`).

#### 4d. Change sector — a sector that means something in play (ADR-0056)

By default a sector is only organisation (4c). Two things make it a game concept, and a project opts in by using either:
**Start here** on a sector (`map.startSector`, the sector the *game* starts in — not the one open in the editor), or a rule that uses
**Change sector** / **Current sector is …**. A project that does neither generates exactly the Lua it always did; migration
`0004-start-sector` writes `startSector: null` into older documents to say so explicitly (`null` = every *At mission start* group
spawns at the start, as before).

- **Change sector** (a rule/beat/GM-control/dialogue action): destination sector, **arrival marker** (it must be filed under the
  destination), optional **arrival heading** (empty keeps the ship's own). It can be fired by any rule, including one conditioned
  on a flag (a variable) — the usual way to make a jump the crew triggers or the narrative decides.
- **What a jump does, in order:** (1) refuses before touching anything if the destination or marker is invalid; (2) if the
  destination is the sector already current, **does nothing** (no unload, no re-creation, no move); (3) unloads the previous
  sector's groups; (4) makes the destination current; (5) creates the destination's *At mission start* groups from their initial
  settings — *When a rule spawns it* groups keep waiting for their rules; (6) installs dialogues; (7) places **the same player ship**
  at the arrival marker (heading only if given); (8) counts the transition. **Shared** groups and the player ship are never
  unloaded, and a group that holds the player ship never creates a second one. Returning to a sector recreates its objects from
  their initial settings (damage, kills and progress of a sector are **not** kept — a separate persistence model, not built yet).
- **A reset is about objects only.** Global variables, object variables, rules already fired (`once`), beats and the clock are not
  reset. Rules are edge-triggered, so a rule that is not `once` may fire again after a return.
- **Unloaded is not destroyed.** The runtime records each unloaded id **before** it calls `destroy()` and forgets the handle and the
  group entry, so `Object destroyed` and `Group wiped out` stay false for what was merely unloaded — also for any callback that looks
  at validity. There is no delay and no global switch-off of victories. An explicit **Destroy** by the author is unchanged and
  still counts; a real destruction in combat is still recognised.
- **Inside the rule loop.** The jump runs where the action is. The **actions after it in the same sequence run** (in the new sector;
  something that was unloaded is simply gone, so an action aimed at it does nothing). The **rest of the rules of that update do not
  run**; they resume on the next update, in the new world. Beats are time-keyed and unaffected.
- **Current sector is …** limits a rule to the sector where it makes sense (`current_sector`). Using it needs a starting sector.
- **The crew's mines, probes and missiles do not follow a jump (ADR-0057).** They are not placed by the map, so they belong to whoever
  fired them. A project that contains a Change sector action also carries a small registry: every two seconds of game time it notes the
  mines, probes and missiles fired by the player ship, by a **Shared** object or by an object of the current sector; a jump removes them
  (silently: no explosion, no damage), **before** unloading the sector, so the destination — even one on the same coordinates — holds
  none of them. Ammunition is not given back (a missile already fired stays consumed). **Left in place on purpose:** anything whose
  owner is not known (a mine placed by a GM or by another script), visual effects, and the rest of an HVLI burst still to be fired when
  the ship jumps (it comes out of the tubes in the destination). A shot whose owner dies within two seconds of firing is not
  registered and stays. Projects that never use Change sector carry none of this.
- **Spawning into an inactive sector is refused.** `Spawn group` for a group filed under a sector other than the current one writes a
  line in the log and creates nothing (Shared groups always spawn). The build warns when a rule that only runs in sector X spawns a
  group of sector Y, and blocks an unknown start sector, destination or arrival marker, and a marker that is not in the destination.
- **Editing around it.** A sector the game starts in, or that a rule uses, cannot be deleted (the editor says which rule); moving a
  marker out of the sector a jump arrives in is reported in Problems.
- **What is not covered:** only objects the map placed are unloaded (a mine the crew laid, a probe, a missile is left where it is);
  nothing is saved per sector.
- **What was checked, and how:** the generated Lua is run against a mock world in tests and compared second by second with the
  simulator (both are models, never evidence about the engine); the live runs in isolated EE 2024 and 2026 clones are in
  `docs/verification/change-sector/`.


#### 4e. Frozen sectors and campaign saves (ADR-0058)

Off by default, per project: **Mission → Campaign → "Save the campaign (checkpoints) and keep every sector as it was left"** (`campaign.persistence`; it needs a
starting sector). A project that leaves it off generates the Lua it always did (a test pins the hash of the files). Switched on, three things change:

- **A sector keeps its state while the ship is elsewhere — it is frozen.** An inactive sector's objects do not exist in the world: when the ship leaves, each one is
  recorded (alive with its properties, or destroyed) and unloaded; when it comes back, the alive ones are rebuilt from the project and given the recorded properties.
  **A destroyed object is never rebuilt**, so nothing it would have triggered runs again, and `Object destroyed` / `Group wiped out` stay true for it (the
  runtime keeps a persisted *dead* set). A group that has not appeared yet (an *On call* group nobody called) stays absent. The first visit uses the initial settings.
- **Time.** The *campaign clock* is global and keeps counting across a restart (the saved clock plus the time since the resume); `Runs at` of a timed event and `elapsed`
  in a rule use it. Each sector also has its *own clock*, which advances only while the sector is the active one. A timed event or a rule can be **scoped** to a sector
  (its Inspector → *Belongs to*): it then runs only while that sector is active, its time is that sector's clock, and its progress (fired, edge state, which timed
  events have run) is saved with the sector. Unscoped ones keep the meaning they always had. Scope is the author's choice — never guessed from a *Current sector is*
  condition. A scoped item needs campaign saves to be on (the build says so).
- **Checkpoints.** The running game writes the whole state — every visited sector, the Shared objects and the player ship, variables, object variables, rule and
  timed-event progress, the last order and dialogue a Forge action gave, which groups have appeared, the clocks — as one JSON text into EmptyEpsilon's own
  `scriptstorage.json` (the folder of the engine; one file per install). It is written when a **new campaign starts**, **before and after every Change sector**,
  when the **Save checkpoint** action runs (a story moment) and when the crew presses **Save checkpoint** (a button on the Engineering station and on the GM console).
  Two slots and a head: a checkpoint goes to the slot the head does not point at, then the head moves — an interrupted *sequence* of writes leaves the previous one
  current. (Both slots are in the same file: that is not a backup against a damaged file.)
- **Starting and resuming.** EmptyEpsilon asks before the scenario starts: **Campaign = Resume** (the default: the latest saved campaign of this project; if the project has none
  yet, the first one starts and the crew is told it is a first start), **New** (a new campaign — a saved one is never overwritten, it gets its own game number) or **Off** (play without
  saving). **A saved campaign that cannot be resumed stops the start; it is never replaced silently.** The recovery policy runs first: the slot the head points at; else the **older** slot
  (the message names the checkpoint recovered and the one lost); if the head itself is unreadable, the readable slot with the higher checkpoint number. When nothing can be recovered the
  runtime goes into a *blocked* state: **no campaign object, no rule, timed event or reward runs, nothing is written**; the only thing that exists is a stock ship named **NO CAMPAIGN** (the engines show no
  global message on the ship-selection screen — measured in a real window — so a ship is needed for the crew to read the reason, as the ship's-log banner on its station). The crew reads whether the save is
  **damaged** (not readable) or **incompatible** (another format version, another EmptyEpsilon build, or a project whose structure changed — sectors, groups, objects, rules, timed events, variables, dialogues
  added, removed or re-filed; tuning does not count), and the steps: press **Start a NEW campaign** or **Play without saving** (the Engineering station of that ship, or the GM console), or end the game, choose the
  scenario again, set *Campaign = New* and start (the old save is kept; the new campaign gets another number). The game is unpaused while blocked (a paused game runs no `update()`); the holding ship is removed
  on the choice and its station says SHIP DESTROYED (press Return and choose the campaign's ship). An unreadable *list* of campaigns blocks too, and offers only *Play without saving* (a new campaign could not be
  filed without overwriting the list). *No previous campaign* is not a failure: it is the first start.
- **Wording of a save.** The game says what it can observe: "Checkpoint N **sent to the save file**. The game cannot confirm it reached the disk." ScriptStorage:set reports nothing about the disk
  (a read-only file makes it "succeed", and a read-back can be answered from memory), so no message says "saved" as a fact.
- **A jump is all or nothing.** The old sector's final state is read; a checkpoint with it is written while the old sector is still the active one; the destination is
  built from its snapshot or its initial settings (a failure removes what was built and **refuses the jump** — the ship stays where it is); only then the old sector is
  unloaded and the ship placed at the marker; an arrival checkpoint follows. A crash between the two checkpoints resumes in the old sector, never in a mix.
- **What is not kept** — said in the editor too, and measured on both engines (`docs/verification/campaign-persistence-recovery/live/c26-contract.json`, `c24-…`): velocity (the ship comes back
  at its saved position and heading, **at rest**); tubes (a missile loaded in a tube is not in the store and is **lost**; the tubes come back empty); mines, probes and missiles already launched
  (the *store* of probes is kept); docking (the ship comes back **undocked**); scans (an object comes back **unscanned**, also when the ship revisits a sector, and a scan in progress is lost);
  crew settings no Forge action set (alert level, shields up/down, beam frequency, selected target — after a restart; within one run it is the same ship and keeps them); anything made outside the map;
  EXODUS state and steps. After a restart the player ship is a **new** ship that gets the saved state, including the engineer's power and coolant sliders (written back as slider *requests*: on a player
  ship the engine snaps a plain setter back — found live, fixed). Properties the engine cannot read and write back are not faked: the matrix of what each engine allows is in
  `docs/verification/campaign-persistence/property-matrix.md`. This is a checkpoint of the campaign, not a full save of the ship or the world.
- **Limits of the engine, not of Forge.** A script cannot read the file, cannot tell whether a write reached the disk, and a damaged `scriptstorage.json` is replaced by the next write — together with every
  other key in it. **If the whole file is damaged the engine presents an empty archive**, which is indistinguishable from a first start: Resume's block does not protect against that case. EE 2024's
  `toJSON` fails on nested tables, so the saves write their own JSON.
- **Backup (optional, separate).** `forge-save-backup.ps1` (shipped beside EE FORGE, folder *Save backup tool*): `backup` / `list` / `check` / `restore` on paths the user names, EmptyEpsilon closed,
  dated copies never overwritten, a copy accepted only if it is valid JSON and identical to what was read, the source never modified, a restore that keeps the file it replaces and needs an explicit
  confirmation. Valid JSON is not a usable campaign (the scenario decides that); a backup does not protect progress made after it. No service, no EXODUS, no Forge needed.

#### The editor's view state is not the document

Which groups are **hidden**, **isolated** or **locked** and which sector is **open** are the author's way of looking at the map.
They live in the editor (per project, outside `project.json`), never mark the project unsaved, never change the Lua, and ignore
ids that no longer exist. Hidden means not drawn, not clickable, not swept by a rubber band and not part of **Fit**; locked means
drawn and inspectable but refusing every change (canvas, keyboard, inspector). See `packages/web-forge/CLAUDE.md`.

## 5. Logic

Narrative is data, in three parts.

**Beats** — time-keyed, the same scheduler `docs/authoring/scenarios.md`
describes: a `while` loop (so a long tick or an unpause fires every beat it
skipped, in order) with `pcall` around each body.

```jsonc
{ "id": "arrival", "label": "Arrival", "at": 0,
  "actions": [{ "kind": "global_message", "text": "…", "timeoutS": null }] }
```

**Rules** — edge-triggered on the conjunction of `when` and `conditions`:
they fire when the predicate turns true, not every tick it stays true.
`once: false` re-arms after each fire.

```jsonc
{ "id": "spring_ambush", "label": "Player enters the approach zone",
  "when": { "kind": "player_in_zone", "zoneId": "approach_zone" },
  "conditions": [{ "kind": "variable_equals", "name": "briefed", "value": true }],
  "once": true,
  "actions": [{ "kind": "spawn_group", "groupId": "ambush" }] }
```

Predicates: `always`, `elapsed`, `object_destroyed`, `group_destroyed`,
`player_in_zone` (via EE's own `Zone:isInside`), `player_near_object`,
`player_near_point`, `player_hull_below`, `player_system_below`,
`object_scanned`, `variable_equals`, `variable_at_least`.

`object_destroyed` is deliberately false for something that never spawned —
otherwise every rule watching an `on_call` group would fire at T+0.

**GM buttons** — `addGMFunction`, modelled separately from rules because a
button is an event source, not a predicate. EE accepts these only from a
loaded scenario, never over the HTTP API — and only when the callback
**closes over nothing but `_ENV`**: EE reads the closure's first upvalue and
requires a table. That is why the emitted runtime lives in two prefixed
globals (`<id>_rt`, `<id>_state`) addressed by full name rather than in
tidy locals; capturing a local helper makes `init()` die on the first
button with *"Upvalue 1 of function is not a table"*.

Actions cover messages (`global_message`, `banner`, `ship_log`,
`gm_message`), `play_sound`, `spawn_group`, `destroy`, variables,
`set_ai`, the twelve orders, hull and system damage, alert level,
`victory` and `pause_game`.

**Orders: one action per EE method.** All twelve `CpuShip:order*` forms,
each carrying exactly its own parameters — `order_fly_towards` takes a
point, `order_attack` takes an object, and `order_fly_formation` takes
both because `orderFlyFormation(object, offset_x, offset_y)` does. A
single `order` action with optional fields could not express that last
one at all, and made every form show boxes most orders ignore. A test
asserts the twelve match `CpuShip`'s order methods, so an order added to
EE shows up as a mismatch rather than as one nobody can give.

`set_ai` is listed apart from them, following EE's own wording: combat AI
states are *"distinct from orders, which determine the ship's active
objectives"*. One says how a ship fights, the other what it is doing.

**Object variables.** Any object can declare variables in the inspector,
with a starting value; beats and rules then read and write them
(`set_object_variable`, `add_object_variable`,
`object_variable_equals`, `object_variable_at_least`). A write takes a
target, so a group marks every member at once.

They live in the generated scenario's own state table, keyed by object id
— **not** as fields on the EE handle (ADR-0035):

```lua
forge_demo_state.obj_vars["corsair_a"]["alerted"] = false   -- seeded at init
forge_demo_rt.obj_vars(id)["alerted"] = true                -- set on a group
forge_demo_rt.obj_get("corsair_a", "alerted") == true       -- read by a rule
```

That is what lets a rule ask whether a ship *had been* alerted when it
died: the table outlives the handle. It is also what lets the dry run
report them faithfully, which a value living inside EE could not be. The
trade is that hand-written Lua only sees them by reading that table.

Actions are type-checked against the actual classes their target resolves
to, so `set_system_health` aimed at a group containing a station fails at
build time rather than at runtime.

### 5b. The narrative editor

The **Mission** tab (next to **Map** in the view bar; internally still `narrative`) is the GUI over all
of the above.

**Timeline.** Beats on a lane that is linear in seconds, dragged to move
them. Pacing is a spatial question — "how long is the lull before the
ambush" — and a column of numbers answers it badly. Double-click the lane
to drop a beat where you clicked.

**Rules table.** WHEN / IF / THEN, one row each, with the trigger, the
ANDed guards and the actions all readable without opening anything. A node
graph was considered and refused for the first version (STEP 37 plan): for
the ten-to-twenty rules a chapter actually has, a table is faster to scan
and several times cheaper to build. The flowchart tab covers the one thing
a table cannot show, which is shape — and if the table ever does prove too
tight, a graph is another view of the same model, not a rewrite.

**Forms are generated from descriptors** in `logic-forms.ts`, and a test
asserts the descriptors cover every variant of the schema's unions in both
directions. A predicate or action added to the model therefore cannot
quietly become unauthorable, and cannot carry a field with no control.

**References are picked, not typed.** Every field that points at the map —
an object, a zone, a target, a point — has a ⌖ button that switches to the
map, waits for a click, and writes the answer back. The author never types
`station_04`, and a typo can no longer become a build error twenty minutes
later.

**Dry run**, in the right-hand panel: the same executor `forge:simulate`
uses, running on every keystroke, with mock events injected by hand for the
things only a live game produces. What it cannot model it names.

**Flowchart**: mermaid source generated from the model — beats in clock
order, rules with their guards, and dashed edges for the one structural
link the model has (who spawns the group a rule is waiting to see wiped
out). Shown as source rather than rendered: drawing it would mean bundling
mermaid's parser and layout engine into an editor that runs on a LAN with
no CDN, to draw a picture an author looks at occasionally.

---

## 5c. Ship templates

The **Fleet** tab (formerly *Ships*) is the editor over `project.templates` — EmptyEpsilon's
`ShipTemplate`, all 52 of its authoring setters. Templates are written to
the **launch-time** file (`<project>_templates.lua`), not to the scenario:
EE refuses `ShipTemplate()` from a scenario outright. So a new hull needs
the file copied into `<EE>/scripts/shiptemplates/` and EE restarted; the
build tells you when that is required.

**A template must have a model.** EE quits while loading
`shipTemplates.lua` if one never calls `setModel()` — exit code 5, no Lua
error, nothing in the log. The build refuses it rather than letting you
find out that way, and a new template starts on a stock mesh.

**Variants.** The ⎘ button makes a copy of the selected template, emitted
the way EE writes its own: `base:copy("Name")`, restating **only** what
differs. Two consequences worth knowing before you use them
([ADR-0036](../adr/0036-ship-template-variants-emit-differences.md)):

- A variant cannot change its **deck plan**. `addRoom`/`addDoor` only ever
  add and EE has no way to remove an inherited room, so a variant either
  shares its base's plan or is a template of its own. The build says which.
- A variant that **drops a beam** emits `setBeamWeapon(i, 0, 0, 0, 0, 0)`,
  which is how EE's own Atlantis loses its third battery.

Stock templates cannot be copied at all — EE exposes no
`getShipTemplate()`, so there is no handle to chain from. Define the base
in the project.

**Firing arcs**, drawn beside the form from the beam table: forward is up,
`direction` is relative to the hull with 0 straight ahead, and the outer
ring is the longest beam. Turret coverage is the dashed wedge behind the
solid one; tube directions are the dashed spokes.

**Deck plan**, the grid below it: drag on empty cells to add a room, click
a room to give it a system, click a cell edge to toggle a door. It is the
same `rooms` and `doors` arrays the tables in the form edit — overlaps and
gaps are invisible in a table of four numbers and obvious here.

**Model**, at the bottom: the glTF EXODUS has for this template, or for the
stock hull it copies. It is a **likeness**, not a render of the project's
own `ModelData` — EE's meshes are its own `.model` format and the glTFs in
`assets/ee-ships/` exist per stock template. When nothing matches, the
panel says so rather than showing a different ship
([ADR-0037](../adr/0037-ship-preview-is-a-likeness.md)).

**Do not trust EE's getters to check your work here.** Several
`ShipTemplate` setters have no faithful readback on a spawned ship —
`getTubeSize` reports `"medium"` even for EE's own Atlantis X23, which is
declared with a small tube and a large one. `docs/ee-api-reference.md`
§15.4 lists which getters do verify and which do not.

---

## 5d. Dialogues — what an object says when hailed

A **dialogue** is a conversation, authored in the **Dialogues** view and
rendered to vanilla comms Lua. It is a **graph of nodes**: each node says a
line and offers replies, and a reply jumps to another node.

A graph rather than a tree because every comms script EE ships ends its
branches with a "Back" that returns to the main menu — a tree would have to
copy the menu into each branch.

```jsonc
"dialogues": [{
  "id": "council", "label": "Council of Anchorage", "entry": "greeting",
  "nodes": [
    { "id": "greeting", "text": "Anchorage here. Identify yourselves.",
      "replies": [
        { "text": "We are the Prometheus",
          "target": { "kind": "node", "nodeId": "cleared" },
          "conditions": [],
          "actions": [{ "kind": "set_variable", "name": "identified", "value": true }] },
        { "text": "Classified",
          "target": { "kind": "node", "nodeId": "cleared" },
          "conditions": [{ "kind": "variable_equals", "name": "identified", "value": true }],
          "actions": [] },
        { "text": "Get me an officer", "target": { "kind": "gm" }, "conditions": [], "actions": [] }
      ] },
    { "id": "cleared", "text": "Cleared for docking, pier three.", "replies": [] }
  ]
}]
```

**A node with no replies is the end.** There is no "hang up" reply: the crew
reads the line and closes the window, which is how EE's own scripts finish.
Writing the ending as a node means writing a farewell.

**A reply can do three things** beyond leading somewhere:

- **run actions** — the same actions a rule or beat runs, so a reply can
  spring the ambush, set a variable or complete the chapter;
- **be conditional** — the same predicates a rule uses. A guarded reply is
  *not offered*; EE has no greyed-out button, and an option that answers
  "you cannot do that" teaches the crew the option exists;
- **hand off** — to the GM (`commsSwitchToGM`), or to EE's stock station
  menu.

**Attaching one**, three ways:

| Where | What it does |
| --- | --- |
| Inspector → **Dialogue** on a CpuShip, SpaceStation or Artifact | answers with it from the moment it spawns, `on_call` groups included |
| Action **Set dialogue** | changes it mid-scenario; clearing it restores EE's own menu for the class |
| Action **Hail the player** | the object calls the ship instead of waiting |

### The station trade-off

Attaching a dialogue to a station **replaces EmptyEpsilon's service menu** —
missile restocking, repairs, supply drops, reinforcements, all of which cost
reputation and are real gameplay. That menu is the class's default comms
script, and a comms function overrides it.

The editor says so at the field. To keep them, give the dialogue a reply
whose target is **EE's station services**; the crew reaches the stock menu
from your conversation, though they cannot come back to it from there. The
build warns if that reply appears on anything but a SpaceStation.

### What the build produces

One Lua function per node, hung off a global table, and
`setCommsScript(""):setCommsFunction(…)` on the object — EE's own idiom.

**No emitted callback captures a local**, and that is not style:
`setCommsFunction` converts its callback through the same
`convert<ScriptSimpleCallback>` as `addGMFunction`, which reads the first
upvalue and demands a table. A callback capturing a local dies at load with
`Upvalue 1 of function is not a table`. A test asserts the emitted block
contains no `local` at all.

The build refuses a dialogue that opens on a node it does not define, a
reply that jumps nowhere, or an object answering with a dialogue nobody
defines. It warns about nodes nothing reaches.

**The simulator does not model dialogues** and says so in its "not
simulated" list: a dry run has nobody to pick a reply.

Decision record: [ADR-0039](../adr/0039-dialogues-are-a-graph-of-nodes.md).

---

## 6. EXODUS is optional (ADR-0049)

`"requires": ["exodus"]` lets a project use `exodus_event`, `exodus_puzzle`, `exodus_action`,
`exodus_lore`, `exodus_encrypted_comms`, `exodus_set_state` and `exodus_complete_chapter`.
Those are an *extension* of the vanilla scenario, never a precondition: **every scenario Forge
exports as vanilla is complete and portable on plain EmptyEpsilon.** Two export modes:

| mode | what the files contain | needs |
| --- | --- | --- |
| `vanilla` | each EXODUS action replaced by the alternative you recorded | nothing — no `exodus_bridge.lua`, no process |
| `integrated` | the extension's own code behind a gate, alternatives as fallback | the EXODUS extension in the host (the bridge has it); at run time works with or without the service |

Default: integrated when a registered extension owns an action the project uses, vanilla otherwise.
`forge:build --mode …`, `POST /forge/projects/:id/build {"mode"}`, or *Verify vanilla* in the header.

**Steps.** An EXODUS action points at a *step* (`stepId`, `logic.exodusSteps`). The step records:
`essential` (the mission cannot move on without it), `alternative`, and `onSuccess`.

| alternative | the crew gets |
| --- | --- |
| *not decided* (`null`) | nothing yet — a vanilla export refuses it and lists it |
| `none` | deliberately nothing (flavour only) |
| `immediate` | plain-EE actions at once: a message, a log line, a `set_dialogue` that hands them a conversation |
| `wait` | the same, N seconds later |
| `gm` | the GM is told and gets a button; the actions run when it is pressed |

Nothing is inferred: Forge never decides what a missing puzzle "should" do. An **essential** step needs
`immediate`/`wait`/`gm` with at least one action, in both modes. `onSuccess` is what the mission gains
once the step *settles* — through EXODUS or through the alternative — and it runs **once**.

**What "settles" means (ADR-0050).** It depends on who settled it, and the runtime records that (`via`):

| action | the step settles when… | `via` |
| --- | --- | --- |
| `exodus_puzzle` | the service reports `solved` or `bypassed` | `service` |
| every other `exodus_*` action | the request has been **written to the scenario's event queue**; the service has confirmed nothing | `handoff` |
| any, with the alternative | the alternative ran (`immediate`, `wait` elapsed, GM pressed) | `alternative` |

So for an event, lore drop, critical action, encrypted comms, state change or chapter end, `onSuccess`
means *sent*, not *done*: if the mission must not move on until EXODUS has really done it, EXODUS cannot
promise that today (only puzzles are answered). A validation warning says so for essential steps.

**Answer within (s).** For a puzzle step, `answerWithinS` is your deadline for the service's answer: if
EXODUS is running but has not answered that many scenario seconds after the request, the step passes to its
alternative and a later answer is ignored. Empty = keep waiting while EXODUS is alive (and a warning for an
essential step). It is not the puzzle's own time limit, nor the 15 s check that EXODUS is still running.

**Integrated: a file is not a service.** The emitted gate (protocol 1.0.0, `@forge/exodus`)
trusts only a beating beacon in ScriptStorage (`exodus.service.beacon`, written by the bridge every
3 s) — and one value proves nothing, since a dead service leaves its last beacon behind: the first
beacon seen is a baseline, and only a *different* beat later shows life. States: `connecting` (requests
wait up to 10 s of scenario time) → `active` / `absent` (no beat ever changed) / `incompatible`; `lost`
when the beat stops changing for 15 s. A request goes to EXODUS only if
the beacon announces its capability; otherwise — or when EXODUS is lost while a puzzle is pending —
the step's alternative runs, once. Coming back replays nothing. A puzzle answer
(`exodus.outcome.<id>`) counts only while EXODUS still owns the request; after the alternative has
taken over, a late answer is counted and dropped, so nothing is paid twice.

`exodus_encrypted_comms` is **not** `exodus_event` with an `encoded` flag: the helper looks up the
rotating codeword for the (channel, sender) pair and enciphers inside the scenario, so the plaintext
never travels. Its vanilla alternative is whatever you write — usually the plaintext in a comms line.

The dry run knows both worlds: *EXODUS: running / not running / a beacon is left behind / wrong protocol / lost at T / vanilla
export*, with *EXODUS answers* and *GM presses* as injected events, and a step-by-step log
(`forge:simulate --exodus vanilla|absent|stale|incompatible|running`). `projects/exodus_optional_demo` is
a four-step mission that finishes both ways.

---

## 7. Simulating before you play

`forge:simulate` runs the same model in TypeScript on a virtual clock, with
mock events for what only a live game produces:

```json
[
  { "at": 90,  "kind": "player_position", "x": 12000, "y": 3000 },
  { "at": 150, "kind": "destroy_object", "objectId": "corsair_a" },
  { "at": 170, "kind": "destroy_object", "objectId": "corsair_b" }
]
```

```
T+01:30  [rule] spring_ambush — Player enters the approach zone
         spawn group ambush
         alert level → red
         alarm = 1
T+02:50  [rule] ambush_cleared — Both corsairs destroyed
         victory: Human Navy
  not simulated: AI orders (no combat model)
```

Zone containment and proximity are computed geometrically, so they need no
mocking. The `not simulated` line is deliberate: the dry-run says what it
cannot model instead of quietly implying it did.

A parity test asserts the emitted Lua fires beats in the same order the
simulator does — if the two executors drift, the dry-run stops predicting EE.

---

## 8. Install scan — and where it stops

`ee:scan` reads the install's own data scripts: `shipTemplates.lua`'s require
list, `model_data.lua`, `factionInfo.lua`, plus a walk of `resources/` and the
name tables inside `packs/*.pack`. On the pinned install that yields **168
templates** (143 ships, 21 player ships, 4 stations), 59 models, 10 factions,
46 radar traces, 22 planet textures — with no warnings.

**`ee-library.json` is a snapshot, not a live view.** Drop a new texture,
model or ship template into EmptyEpsilon and the editor keeps offering the
old lists until the install is indexed again — which reads, from inside the
editor, as EE not having the file at all.

Use **Install…** in the toolbar: it holds the path to your EmptyEpsilon
directory and **Rescan** re-indexes on the spot, replacing the lists without
a reload. The path is remembered across reloads and is the same one the DMX
view uses for import and install. The CLI above does the same thing when you
would rather script it.

**Indexing also mirrors the images.** The browser cannot read the install, so
the canvas draws planets from `assets/planets/` through the bridge's
`/assets/` mount. Learning a texture's *name* without copying the file is
what produces a broken thumbnail inside the planet rather than a missing
entry in a list — so a rescan does both, and says how many images it copied.
Radar traces are mirrored the same way. Nothing is ever deleted: a project
may still point at a texture a newer install dropped.

The file is gitignored: it describes *your* copy of EE, so rewriting it is
the intended way to keep it current.

Sixty-five of those templates are **generated by Lua loops**:
`transport.lua` builds all 25 `Transport<n>x<m>` hulls in a nested `for`,
and `corvette.lua` builds five freighter families the same way, each with
jump variants guarded by `if cnt > 2`. The reader unrolls exactly that
grammar — numeric `for` with literal bounds, nested loops, and `if <var> <op>
<number> then` guards evaluated with the variable bound — then folds the
resulting literal concatenations into the names they produce.

It is deliberately **not** a Lua interpreter, and that boundary is written
down in tests rather than in intentions: a loop it cannot bound is left
untouched, a conditional with an `else` is reported instead of resolved, and
a concatenation with an unknown operand stays unresolved rather than being
guessed at. The moment the reader starts inferring control flow, the library
it produces stops being evidence about the install.

Verified end-to-end: all 168 names were spawned against a live EE over
`/exec.lua` (`CpuShip():setTemplate(name)`) and every one resolved. An
independent regex sweep of the required files finds 103 literal template
names; 103 + 65 = 168, so the count reconciles from both directions.

---

## 9. Layout

```
packages/shared/src/schemas/ee-catalog.ts   catalog wire shape + lookupMethod
packages/shared/src/schemas/ee-library.ts   install index
packages/shared/src/schemas/ee-project.ts   the project document
packages/forge-core/src/catalog/              reference parser + committed JSON
packages/forge-core/src/scan/                 install reader (Lua data + packs)
packages/forge-core/src/codegen/              lua core, map, content, logic, build
packages/forge-core/src/editor/               descriptors, factories, forms
packages/forge-core/src/logic/simulate.ts     the TypeScript executor
projects/<id>/project.json                  the source of truth
projects/<id>/build/*.lua                   generated bundle
```

`packages/forge-core` (`@forge/core`) depends only on `zod` and `@forge/contracts`
(`packages/forge-contracts`, `zod` only) — no bridge, no web, no EXODUS package,
directly or transitively (`test/independence.test.ts` checks the real graph).
`@exodus/shared` re-exports the contracts and `@exodus/ee-forge` re-exports the
core, so existing EXODUS code keeps importing the old names.

### Project document versioning (ADR-0047)

`project.json` carries `schemaVersion` (currently 3; files written before it are
version 0; 3 added sectors, ADR-0055). `importProject(raw)` in `@forge/core` runs the deterministic migration
table (`PROJECT_MIGRATIONS`), then moves any field the schema does not model into
`project.unmodelled` instead of letting Zod strip it, and reports `lost` (must stay
empty). A document newer than the build is refused. Reading never rewrites a file;
the upgraded document reaches disk the next time the author saves.
`pnpm --filter @forge/core forge:migrate projects/<id> --out <dir>` writes a migrated
copy (dry run without `--out`; never overwrites its source).

---

## 10. Status

STEP 35 shipped the toolkit and the CLI; STEP 36 adds the app shell and the
2D map editor (`packages/web-forge`, port 5176) plus the bridge's
`/forge/*` surface.

Verified for STEP 36: `scenario_99_system_test_bench.lua` was re-authored as
a project document and both versions were loaded into a live EE. Identical
inventory — 40 objects across 12 types — and **all 26 non-asteroid objects
at byte-identical positions**. The one deviation is deliberate: the original
draws its 14-asteroid belt from Lua's RNG at load time, which the forge
refuses to emit, so the forged belt is a seeded scatter in the same radius
band (13 752–16 498 GU against the original's 13 844–16 472).

STEP 37 added the narrative editor, STEP 38 every AI order plus object
variables, and STEP 39 the Ships tab (§5c) — every authoring setter of
`ShipTemplate`, firing-arc and deck-plan diagrams, and a 3D likeness.
Still to come: factions and models in STEP 40, live push in 41.

The map half is **verified against a live EE-2024.12.08**: the demo's
11-object `core` group spawned over `/exec.lua` with every authored
property intact — callsigns, station template and hull, planet radii,
asteroid sizes, zone label — and was removed cleanly afterwards.

ADR-0034's probe checklist is closed — all seven items answered against a
live server. The two that changed the design:

- **`setScenario` works.** `docs/ee-api-reference.md` §9.1 was wrong to
  call it absent. That makes ADR-0030's container scenario and ADR-0021's
  operator-driven resume *choices* rather than the only option; revisiting
  either needs its own ADR and is out of scope here.
- **Ship templates cannot come from a scenario**, which is why the fourth
  file and the restart exist (§1).

The full bundle is verified end-to-end on a freshly launched EE: the
scenario loads, `init()` completes, the T+0 beat runs, entering the zone
triggers the rule, the corsairs spawn on their custom templates and
faction, alert goes red, and destroying them fires `victory` — with **zero
errors in `EmptyEpsilon.log`**. The custom model registers and binds: it is
absent from EE's launch-time *"Model data: X is not used by any ship
template"* list, and no `Failed to find model data` appears.

Not checked here because it needs eyes on a screen rather than a log line:
that the bound mesh is the one you intended.

For STEP 39 the gate was run again on a headless EE (`headless=` with
`httpserver=8080`): the generated launch-time file loads clean, and both
Corsairs — including the Mk2, now emitted as a `copy()` restating only its
differences — spawn with the authored hull, shields, impulse, turn rate,
beam ranges and arcs, tube count and magazine, plus the two setters STEP 39
added that EE does read back (`getBeamWeaponEnergyPerFire`,
`getBeamWeaponHeatPerFire`).

Two things that session established, both now enforced: a template with no
model kills EE at load, and several `ShipTemplate` setters cannot be
verified through a getter at all (`docs/ee-api-reference.md` §15.4).
