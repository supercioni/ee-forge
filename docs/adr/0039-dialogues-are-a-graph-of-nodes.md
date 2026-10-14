# 0039 — Comms dialogues are a graph of nodes, emitted as globals

**Status:** Accepted.
**Date:** 2026-08-16 (Phase 5, EE FORGE).

## Context

Conversation is EmptyEpsilon's main narrative channel: a station gives the
mission, a trader haggles, an enemy demands surrender. The editor could
author maps, hulls, beats and rules, but nothing that speaks — the only way
to write a conversation was Lua by hand, outside the project document,
which breaks the rule that `project.json` is the single source of truth
(ADR-0034).

EE's surface, from the generated catalog:

| Call | Kind | Does |
| --- | --- | --- |
| `SpaceObject:setCommsFunction(cb)` | method | callback invoked on hail |
| `SpaceObject:setCommsScript(name)` | method | a script file; `""` **disables** comms |
| `setCommsMessage(text)` | global | the line the object says |
| `addCommsReply(text, cb)` | global | one reply button |
| `commsSwitchToGM()` | global | hands the chat to the GM |
| `SpaceObject:sendCommsMessage(target, msg)` | method | the object hails the ship |

## Decision

**A dialogue is a flat list of nodes with jumps, not a nested tree.**

Every comms script EE ships ends its branches with `addCommsReply(_("Back"),
commsStationMainMenu)`. A tree cannot express that without copying the menu
into each branch; a graph can, it edits in a table like rules and beats, and
it diffs. A reply's destination is a tagged record — another node, the GM, or
EE's stock station menu.

**A node with no replies is the end of the conversation.** There is
deliberately no "hang up" target: the crew reads the line and closes the
window, which is what EE's own scripts do, and modelling the ending as a
terminal node means the author writes a farewell instead of the window
vanishing.

**A reply carries conditions and actions**, and they are the *same*
`EEPredicate` and `EEAction` records a rule carries. `LogicOwner` grew a
`dialogueReply` case so the record editor, `setField` and the
"pick it on the map" flow work inside a conversation with no new machinery.
A guarded reply is simply not offered — EE has no disabled button, and an
option that answers "you cannot do that" teaches the crew the option exists.

**Attached three ways**: a `dialogueId` on the object (CpuShip,
SpaceStation, Artifact), a `set_dialogue` action for mid-scenario changes,
and `hail_player` for the object calling first.

### Every emitted callback closes over `_ENV` and nothing else

This governs the shape of the whole emitter. Probed live, 2026-08-16:

```lua
local captured = 42
obj:setCommsFunction(function() return captured end)
--> ??[convert<ScriptSimpleCallback>::param] Upvalue 1 of function is not a table

obj:setCommsFunction(function() setCommsMessage("hi") end)   --> accepted
```

`setCommsFunction` uses the same `convert<ScriptSimpleCallback>` as
`addGMFunction`, with the same restriction — the finding that already forced
the runtime and the state into two prefixed globals (`logic.ts`). So node
functions live at `<rt>.dlg[dialogue][node]` and every reply body addresses
them by full name. `comms_source` and `comms_target` arrive as
**parameters**, which are not upvalues.

A test asserts the emitted dialogue block contains no `local` at all, and
the generated text has been run through EE's real converter.

### Restoring EE's default is not `setCommsScript("")`

EE documents the empty string as *disabling* comms, and `setCommsFunction`
takes precedence over any script. So `set_dialogue` with no dialogue clears
the function and then names the class's own script, choosing it from
`typeName` — a direct member, not a call (probed: `"SpaceStation"`,
`"CpuShip"`).

### The one call the catalog cannot vouch for

`commsStationMainMenu` belongs to `comms_station.lua`, not to EE's scripting
API, so the `services` reply emits it raw. A comms script's body **is its
own entry point** — the file ends by calling that function with globals that
are nil outside a hail — so a scenario loads it as `pcall(require,
"comms_station.lua")`: the definitions run, the trailing call fails
harmlessly, and the `pcall` absorbs exactly that. Emitted only when a reply
actually uses it.

## Consequences

Attaching a dialogue to a station **replaces EE's service menu** — no
missile restocking, repairs, supply drops or reinforcements — because that
menu is the class's default comms script and a comms function overrides it.
The inspector says so at the field, and a `services` reply hands it back.
The build warns when a non-station offers that reply, since the stock menu
expects a `SpaceStation`.

The simulator reports dialogues as **not simulated**: a dry run has nobody
to choose a reply, and pretending otherwise would make it lie. `set_dialogue`
is applied, because which dialogue an object carries is plain state.

## Alternatives considered

**A nested tree.** More obvious to read, and it maps to the JSON an author
might expect. Rejected because it cannot return to the main menu without
duplicating it, which is the one shape every EE comms script has.

**Reusing `setCommsScript` with a generated per-object file.** EE would
handle the entry point for us, and locals would be allowed. Rejected: it
means a Lua file per talking object, spread across the install, when the
whole bundle is otherwise three files (ADR-0034 §3).

**Its own condition and action vocabulary for replies.** Smaller surface,
and a reply arguably wants fewer verbs than a rule. Rejected because the
interesting replies are exactly the ones that spawn the ambush or complete
the chapter — the actions that already exist.
