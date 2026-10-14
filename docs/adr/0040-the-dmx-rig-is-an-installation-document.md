# 0040 — The DMX rig is an installation document, not a project one

**Status:** Accepted.
**Date:** 2026-08-17 (Phase 5, EE FORGE).

## Context

EXODUS exists to make the bridge physical — panels, switches, status
lights. DMX lighting is the last item on that list the editor did not
touch: it was configured by editing `hardware.ini` by hand, with no
validation, and no way to tell whether a rule was right short of turning
the lamps on.

Three facts, established before any design:

- **DMX has no Lua API.** Nothing in the generated catalog for
  EE-2024.12.08, global or method. It cannot be emitted as scenario Lua.
- It is configured entirely by **`hardware.ini`** — beside
  `EmptyEpsilon.exe` on Windows, `~/.emptyepsilon/` elsewhere. The pinned
  install ships one: `DMX512SerialDevice` on `COM9`, a four-channel spot.
- **Every trigger it offers is ship telemetry** — hull, shields, alert,
  systems, tubes. There is no cue for "when this story beat fires".

The reference is EE's wiki, cross-checked against this build: `strings` on
the binary confirms all six device names and the whole ini vocabulary
(`min_value`, `max_value`, `on_time`, `off_time`, `min_input`, `max_input`,
`min_output`, `max_output`, `condition`, `target`, `channels`). The
per-system triggers are **composed at runtime** — `reactorHacked` is not in
the binary, but `reactor` and `Hacked` are.

## Decision

**The rig is its own document, `projects/dmx-rig.json`, beside the
projects rather than inside one.**

A rig describes the room's lights. Two groups running the same scenario
have different wiring, and since no trigger is scenario-specific there is
nothing about it to put in a `project.json`. It sits next to
`ee-library.json`, which is the other "facts about this installation"
document, and gets a fourth editor view alongside Map, Narrative and Ships.

**Values carry their format as a tag.** `0.5`, `$af` and `[255]` are three
spellings, and the install's own file mixes them on one line
(`$ff, $ff, $ff, 1`). Inferring a format from the text would rewrite an
author's file on the first save.

**The reader reports what it cannot understand**, exactly as
`scan/lua-data.ts` does with EE's data scripts. An import that silently
dropped a section would lose work the author can still see in their own
file. The oracle is the shipped `hardware.ini`: read, write, read again,
and the document must match — with the two quirks the wiki omits, a
trailing `#` comment and that mixed value list.

**Building writes to `build/`; installing is opt-in and backs up first.**
Unlike the scenario files, which are artefacts of a document, `hardware.ini`
is a singleton somebody may have wired by hand.

### The preview, and where it stops

`evaluateRig` is pure and tested, and the editor renders live channel bars
from it against the running ship — the bridge already polls most of what
EE's own cues are built from. Two limits are stated rather than hidden:

- **Some triggers have no Lua getter in this build**, so they cannot be
  previewed: `Impulse` and `Warp` (only `getImpulseMaxSpeed` and
  `getWarpSpeed` exist, which are the hull's maxima, not the current
  request), `Jumped`, `InNebula`, `IsJammed`, `SelfDestruct`,
  `SelfDestructCountdown`, and the loading/unloading/firing tube states.
  They are listed as unreadable instead of shown as zero, which would read
  as "off" rather than "unknown".
- **Events are not previewed.** They fire on a change over time; the
  preview is a snapshot.

**DMX and EE's Lua disagree about one system name.** DMX's prefix is
`maneuvering`; EE's `ESystem` key is `maneuver`. Probed 2026-08-17: on an
undamaged ship `getSystemHealth("maneuver")` reads 1.0 while
`"maneuvering"` reads 0.0 — identical to a nonsense name, because EE
answers 0 for a system it does not know rather than raising. Without
`EE_TO_DMX_SYSTEM` five triggers would have sat at zero and looked merely
undamaged.

**One scale was unverified.** Settled 2026-08-19 from EE's source, and
the wiki was wrong: every system trigger is the **raw member**
(`systems[n].health`, `heat_level`, `hacked_level`, `coolant_level`), and
`Power` is `power_level / 3.0f`. Only hull, energy and the shields are
percentages. The reader had been multiplying all five by 100, so a healthy
reactor read 100 against a rule written `reactorHealth < 0.5` and the
preview disagreed with EE. See the third amendment.

## Amendment, 2026-08-19 — the model is EE's parser, not EE's wiki

The first cut modelled the wiki page. Read against `src/hardware/` at
`EE-2024.12.08`, the wiki turned out to be a subset, and an editor that can
only express a subset is an editor that quietly forbids things EE allows.

Four gaps, all now closed:

- **Device settings.** Only `port`, `channels` and `ip` were modelled, and
  only the first was reachable in the UI. EE's six devices read eleven
  distinct keys between them — `universe`, `multicast`, `resend_delay`,
  `username`, `userfile`, `virtual_types`. They were being dropped on
  import without a warning, which is the one thing the reader is supposed
  never to do.
- **Conditions compare.** `condition = Hull < 30` is legal and is the rule
  most rigs actually want; the model held a bare trigger name and the
  reader rejected anything else as an unknown trigger.
- **Two effects were wrong.** `noise` was missing entirely, and `blink` was
  missing both its levels.
- **Events take a full effect**, through the same `createEffect()` a state
  uses — not the static value list they were modelled as. They also had no
  UI at all, so they survived a round trip but could not be authored.

**Devices became a discriminated union keyed on the device.** The
alternative — one object with every key nullable — was rejected because EE
hands the whole `[hardware]` section to the chosen device's `configure()`,
which drops what it does not recognise *without a word*. A `universe` on a
serial device is not an unset setting; it is a dead line no one will ever
be told about. A union makes it unrepresentable, and the reader warns when
an imported file contains one.

**EE's defaults now get written out explicitly.** `channels = 512` and
`resend_delay = 25` were previously absent-and-implied; the build states
them. Behaviour is identical and the file reads without having to remember
what a missing line meant.

**One EE bug is recorded rather than imitated.** Its condition parser takes
the compare value from one character past the operator, so `==` and `!=`
always compare against 0 whatever was written. The schema keeps the
author's number, the editor warns beside the field, and the preview
evaluates what they meant — a preview that reproduced the bug would teach
it as a rule.

## Second amendment, 2026-08-19 — a colour is three levels, and levels are per channel

Asked for channel roles and a colour picker. Checking how a value list
actually reaches a fixture's channels turned up the mechanism the whole
feature rests on, and two bugs in the first cut.

**EE builds one state per channel and slices *every* setting to feed it**,
taking `values[idx % values.size()]`. Not just `value`: any key may be a
comma list. And a short list **wraps rather than padding** — `value = 1` on
an RGB fixture lights all three, white.

That is why a colour needs no new field. It is three levels lined up with
the three channels an author labelled red, green and blue.

**Fixtures gained roles**, and `EEDmxChannel` became `EEDmxFixture` with
`slots: {channel, role}[]` — `channel.channels[i]` had run out of road. The
ini section is still `[channels]`, which is EE's name for it.

**The colour is a projection, never a field.** It is read out of the
primaries and written back into them, so "pick a swatch" and "type the
three numbers" are one array seen twice and cannot drift. That is the
existing rule about derived data, applied where an author would most like
to have both. A colour never touches white or intensity: they are channels,
not parts of the mix.

**Levels became per-channel lists; times did not.** A one-entry list is the
"same everywhere" case, which is exactly what EE's modulo already means, so
the common file is unchanged. The line is drawn at what a level *is*:
nobody wires a fixture whose red blinks faster than its green, but "pulse
red on alert" is the bridge cue.

**`virtual_types` left the device schema.** It says what colour to draw
each channel, which is the same fact as a fixture's roles; the build now
derives it, and an imported one seeds the roles instead of being a second
copy. Roles are otherwise never guessed — the shipped file's own comment
says "red, blue, green, intensity" and the importer still leaves them
blank, because a comment is not evidence.

### The two bugs it exposed

- **The preview zero-filled instead of wrapping.** A fixture wider than its
  value list showed the extra channels dark, which reads as "off" rather
  than as EE's "same again". A test had pinned the wrong behaviour.
- **`Variable` was treated as a set of inputs to maximise.** EE's Variable
  effect reads exactly one variable
  (`controller->getVariableValue(variable_name, input)`); a comma list is
  the per-channel split again. The reader now drops a rule whose input list
  contains an unknown trigger rather than removing the bad entry, because
  dropping one silently re-aligns every channel after it.

## Third amendment, 2026-08-19 — what the source says about firing, timing and scale

Prompted by a rig owner reporting that `TubeFiring` does nothing. It does
not, and chasing why turned up three more things.

**`TubeFiring[n]` is HVLI-only.** The first explanation here — that the
firing state is too brief to sample — was wrong, and the rig owner's
question ("could it not be a state?") is what sent us to the source.
`weaponTube.cpp` only enters `WTS_Firing` for an HVLI; every other missile
type goes loaded → empty untouched. And for an HVLI it lasts the whole
5-shot burst, about six seconds, so a **`[state]` works fine** — it is an
event that suits it badly, not the trigger that is broken.

That produced `DMX_TRIGGER_CAVEATS`, a map from trigger to the sentence
explaining it, shown beside both a rule's condition and an event's
trigger. A trigger that is valid, selectable and silent *in the author's
setup* is worse than a missing one, and a label like "never fires" would
have been a second wrong answer. The reason travels with the name.

For a shot of any missile type, `<TubeLoaded[n]` is the trigger that
works: firing empties the tube.

**The system scales were wrong, and the wiki caused it.** EE hands its own
DMX the raw member; only hull, energy and shields are percentages. Every
`reactorHealth`-style rule in the preview was reading 100× too high.
Fixed in one place, pinned by tests, and the range is now in the API
reference as a table.

**Events ignore a move of 0.1 or less**, on the variable's own scale. On a
0-100 variable that is a tenth of a percent; on a 0..1 one — a system's
health, or `ShieldsCalibrating` — an event needs a **10% move** to fire.
Worth knowing before writing an event on a fraction.

**A repeat trigger restarts the runtime.** `Timer::start()` sets a fresh
expiry with no guard for an already-running timer, so sustained damage
keeps an impact effect alive rather than letting it lapse mid-burst. That
is the behaviour a flicker-on-hit wants, and it was previously an open
question in the authoring guide.

**`ShieldsCalibrating` was missing** from the trigger list — present in the
binary between `ShieldsUp` and `Impulse`, absent from the wiki's table.
Added, and marked unreadable since no Lua getter exposes the calibration
delay.

## Consequences

The editor gains a view that is not about a scenario at all, which is a
first — every other view edits `project.json`. The toolbar's DMX tab says
so in its tooltip, and the view's own copy explains why.

`evaluateRig` is deliberately more than the preview needs: it is the shape
EXODUS would use if it ever drove fixtures itself, which is the natural
next step now that the cues can be authored. That is not this ADR.

## Alternatives considered

**A `dmx` section inside `project.json`.** The obvious reading of "add DMX
to the editor", and wrong: it would ship one group's wiring with the
content, and there is no scenario-specific trigger to justify the coupling.

**A richer, EXODUS-shaped model with narrative triggers** — "flash amber
when chapter three starts". Tempting, and impossible to hand to EE: it
would be inventing configuration `hardware.ini` cannot express. If EXODUS
drives the lights one day, that model belongs to EXODUS, not to a file EE
parses.

**Extending the bridge's existing ship snapshot** rather than a second
query. Rejected because that snapshot feeds the cockpits every tick, and
the preview needs two extra calls per system plus one per tube — a cost
worth paying only while somebody has the DMX view open.
