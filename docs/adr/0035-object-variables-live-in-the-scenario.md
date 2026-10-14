# 0035 — Object variables live in the scenario, not on the EE handle

**Status:** Accepted.
**Date:** 2026-08-11 (Phase 5 STEP 38).

## Context

EE FORGE's narrative model (ADR-0034 §5) has variables, but only global
ones: `EELogicSchema.variables` is a flat list and `set_variable` /
`variable_equals` address them by name. That is enough for chapter-level
state ("briefed", "alarm level") and useless for the thing authors
actually reach for — state that belongs to *one object*: has this raider
noticed us, how many runs has this freighter made, is this station still
holding cargo.

Today the workaround is a global with the object's id baked into its name
(`kraylor_1_alerted`). It works and it is wrong in three ways: the name
does not move when the object is renamed, the inspector cannot show it
next to the object it describes, and nothing stops two objects from
sharing a name by accident.

So: variables declared on the object. The question this ADR settles is
**where the value lives at runtime**.

## Decision

Object variables are declared in the project document on the object that
owns them, and stored at runtime in the **generated scenario's own state
table**, keyed by the project's object id:

```lua
forge_demo_state = { vars = {}, obj_vars = {}, beat_idx = 1 }

forge_demo_state.obj_vars["corsair_a"]["alerted"] = false   -- seeded at init
forge_demo_rt.obj_vars(id)["alerted"] = true                -- written by an action
forge_demo_rt.obj_get("corsair_a", "alerted") == true       -- read by a predicate
```

An action takes an `EETargetRef`, so a group target writes to every
member; the ids are resolved **at build time** from the document, because
group membership is already known there. The emitted Lua therefore needs
no handle lookup and works whether or not the objects have spawned.

Predicates read a single object. "Any member" and "every member" are
different questions and guessing which one an author meant is worse than
making them say; a scoped variant can be added later without changing
what exists.

## Alternatives considered

**Set the field on the EE object** — `corsair_a.alerted = true`. This is
idiomatic EmptyEpsilon: its own stock scenarios do it freely
(`playerFighter.maxCargo = 3` in `scenario_53_escape.lua`,
`odin.target = shipyard_gamma` in `scenario_08_atlantis.lua`), and a live
probe confirms EE accepts arbitrary fields on a handle. Rejected for two
reasons:

1. **The value dies with the object.** A rule like *"if the wing was
   alerted before it was destroyed, escalate"* could not be written at
   all. The scenario-side table outlives the handle, and a test pins that
   property precisely because it is the one that decides this.
2. **The simulator could not reproduce it.** The emitter and the
   TypeScript dry-run are two executors of one model
   (`packages/ee-forge/CLAUDE.md`), and a parity test holds them
   together. State living on an EE handle is state the dry-run can only
   approximate — and a dry-run that quietly diverges is worse than none.

A third, smaller reason: writing a field on a handle is not a documented
API call but a property of EE's script binding. Depending on it would put
weight on behaviour the reference does not describe, which is the same
class of risk the "never invent EE API" rule exists to avoid.

**Mirror to both** — write the scenario table *and* the handle field, so
hand-written Lua and comms scripts can read it. Rejected as premature:
nothing in EXODUS needs it today, and two copies of one value is a
consistency problem waiting to be discovered at the worst moment. If a
comms script ever needs to read an object variable, it can read the
scenario's table, which is a global with a documented shape.

## Consequences

- Object variables are readable after destruction, and the dry-run
  reports them (`SimResult.objectVariables`) including for objects that
  died.
- They are invisible to hand-written Lua that does not look in
  `<id>_state.obj_vars`. Accepted, and documented in
  `docs/authoring/ee-forge.md`.
- `target: {ref:"player"}` resolves to the project's own PlayerSpaceship;
  a map with none — or more than one — is a build error naming the
  problem, rather than a silent write to a key nothing reads.
- Every object in every existing project gains `variables: []`. The
  schema uses `.nullable()` rather than `.optional()` throughout
  (`docs/schema-conventions.md`), so the field is always present.
