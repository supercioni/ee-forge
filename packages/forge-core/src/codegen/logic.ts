import type {
  EEAction,
  EECatalog,
  EEObject,
  EEPointRef,
  EEPredicate,
  EEProject,
  EETargetRef,
} from "@forge/contracts";
import { placeResolver } from "./place.js";
import { findTarget, type DialogueRestore } from "../targets.js";
import {
  extensionFor,
  isExtensionAction,
  usesExodusSteps,
  type BuildMode,
  type ForgeExtension,
} from "../extensions.js";
import { emitDialogues } from "./dialogue.js";
import { usesSectorRuntime } from "../sector-runtime.js";
import { scopeOf, usesPersistence } from "../persistence.js";
import { emitPersistence } from "./persist.js";
import {
  CodegenError,
  bool,
  indentBlock,
  luaString,
  num,
  raw,
  renderGlobalCall,
  renderValue,
  str,
  validateCall,
  type CallSpec,
  type LuaValue,
} from "./lua.js";

/**
 * Emits the narrative half of a project: beats, rules, and GM buttons.
 *
 * Logic is data, not text (ADR-0034 §5). The same typed model feeds this
 * emitter and the TypeScript simulator in `src/logic/simulate.ts`, and a
 * parity test keeps the two honest.
 *
 * Two properties the emitted scheduler preserves from
 * `docs/authoring/scenarios.md`:
 *
 *  - `while`, not `if`: a long tick (or an unpause) fires every beat it
 *    skipped, in order, instead of dropping all but the last.
 *  - `pcall` around every beat and rule body: one bad action prints and
 *    the scenario keeps running.
 *
 * ## Why everything is a global
 *
 * EE's `addGMFunction` converts its callback through
 * `convert<ScriptSimpleCallback>`, which reads the closure's **first
 * upvalue and requires it to be a table** (`_ENV`). A callback that
 * captures any local first — a helper function, a state table — fails at
 * load with:
 *
 *   ??[convert<ScriptSimpleCallback>::param] Upvalue 1 of function is not a table
 *
 * Observed 2026-08-09: an earlier version of this emitter wrapped GM
 * bodies in a local `run()` helper, and `init()` died on the first
 * button. So the runtime helpers and the scenario state live in two
 * prefixed **globals** and every emitted expression addresses them by
 * their full name. Verbose, but a GM callback then closes over nothing
 * but `_ENV`, and no future action can reintroduce the bug.
 */

export interface RuntimeNames {
  /** Global table holding the helper functions. */
  readonly rt: string;
  /** Global table holding variables and the beat cursor. */
  readonly state: string;
  /** Global the generated map module publishes. */
  readonly map: string;
}

export function runtimeNames(projectId: string): RuntimeNames {
  const base = projectId.replace(/-/g, "_");
  return { rt: `${base}_rt`, state: `${base}_state`, map: `${base}_map` };
}

/** Fixed helper prelude, parameterised only by the two global names. */
export function luaRuntime(
  names: RuntimeNames,
  dialogueRestore: DialogueRestore = "ecs",
  sectors = false,
  persistence = false,
): string {
  const { rt, state, map } = names;
  // Which test tells a station from a ship differs per engine; only that
  // condition is target-specific, so only it is spliced in.
  const isStation =
    dialogueRestore === "typeName"
      ? `o.typeName == "SpaceStation"`
      : `o.components.docking_bay and o.components.physics and o.components.physics.type == "static"`;
  return `${rt} = {}
${state} = { vars = {}, obj_vars = {}, beat_idx = 1 }

function ${rt}.player() return getPlayerShip(-1) end
function ${rt}.alive(o) return o ~= nil and o:isValid() end

--- Handles for an action target: the player, one object, or a whole group.
function ${rt}.targets(kind, key)
  if kind == "player" then
    local p = ${rt}.player()
    if p == nil then return {} end
    return { p }
  elseif kind == "object" then
    local o = ${map}.objects[key]
    if o == nil then return {} end
    return { o }
  end
  return ${map}.groups[key] or {}
end

--- True only once an object has actually existed and then stopped being
--- valid — an object that was never spawned is not "destroyed".
function ${rt}.destroyed(id)${
    persistence
      ? `
  -- Campaign saves (ADR-0058): a destroyed object stays destroyed across a sector change and a restart (it is in the persisted dead set);
  -- an object that was merely unloaded is not destroyed.
  if ${rt}.persist.dead[id] then return true end
  if ${map}.unloaded[id] then return false end`
      : sectors
        ? `
  -- An object removed because the game left its sector was never destroyed (ADR-0056).
  if ${map}.unloaded[id] then return false end`
        : ""
  }
  local o = ${map}.objects[id]
  return o ~= nil and not o:isValid()
end

function ${rt}.group_wiped(name)${
    persistence
      ? `
  -- Wiped out = the group has appeared at least once and every member is destroyed (in the dead set, or its handle reports invalid and it was
  -- not merely unloaded). A group that was unloaded, or has not appeared yet, is not wiped out.
  if not ${rt}.persist.appeared[name] then return false end
  local ids = ${map}.group_ids[name] or {}
  if #ids == 0 then return false end
  for _, id in ipairs(ids) do
    if not ${rt}.destroyed(id) then return false end
  end
  return true
end`
      : `
  local g = ${map}.groups[name]
  if g == nil or #g == 0 then return false end${
    sectors
      ? `
  -- A group that was unloaded is not a group that was wiped out.
  for _, id in ipairs(${map}.group_ids[name] or {}) do
    if ${map}.unloaded[id] then return false end
  end`
      : ""
  }
  for _, o in ipairs(g) do
    if ${rt}.alive(o) then return false end
  end
  return true
end`
  }

${
    sectors
      ? `--- Sectors in play (ADR-0056).
${state}.transitions = 0
function ${rt}.current_sector() return ${map}.sector end

--- Leave the current sector. Refuses an unknown destination BEFORE unloading anything; the same sector is a no-op (nothing
--- is unloaded, created or moved). Otherwise: unload the old sector, create the new one's At-mission-start groups, install
--- dialogues, place the same player ship at the arrival point (rotation only if given). Variables, fired rules and the clock are
--- not touched. The rule loop stops for this update (see tick_rules).
function ${rt}.change_sector(dest, x, y, rotation)
  if ${map}.sectors[dest] ~= true then
    print("[forge] change_sector refused: no sector called " .. tostring(dest))
    return false
  end
  if ${map}.sector == dest then return false end${
    persistence
      ? `
  -- Campaign saves (ADR-0058): the destination is built before the old sector is unloaded; a failure leaves the game exactly where it was.
  local made, why = ${map}.enter_sector(dest)
  if made == nil then
    ${rt}.persist.announce("Jump to " .. tostring(dest) .. " refused: " .. tostring(why) .. ". The ship stays where it is.")
    return false
  end`
      : `
  ${map}.enter_sector(dest)`
  }
  ${rt}.install_dialogues()${
    persistence
      ? `
  ${rt}.persist.relink(${rt}.persist.ids_of(dest))`
      : ""
  }
  local p = ${rt}.player()
  if p ~= nil then
    p:setPosition(x, y)
    if rotation ~= nil then
      p:setRotation(rotation)
      -- EE 2024 keeps a helm target: without this the ship turns back toward its old heading the moment it arrives (seen live, ADR-0056).
      if p.commandTargetRotation ~= nil then p:commandTargetRotation(rotation) end
    end
  end
  ${state}.transitions = ${state}.transitions + 1${
    persistence
      ? `
  -- The arrival checkpoint: the new sector is active and the ship is at the marker. A crash before this point resumes in the old sector.
  ${rt}.persist.checkpoint("arrival")`
      : ""
  }
  return true
end

`
      : ""
  }function ${rt}.zone_contains(id)
  local z, p = ${map}.objects[id], ${rt}.player()
  if not ${rt}.alive(z) or p == nil then return false end
  return z:isInside(p)
end

function ${rt}.near_point(x, y, dist)
  local p = ${rt}.player()
  if p == nil then return false end
  local px, py = p:getPosition()
  local dx, dy = px - x, py - y
  return (dx * dx + dy * dy) <= dist * dist
end

function ${rt}.near_object(id, dist)
  local o = ${map}.objects[id]
  if not ${rt}.alive(o) then return false end
  local ox, oy = o:getPosition()
  return ${rt}.near_point(ox, oy, dist)
end

--- Comms (ADR-0039). dlg holds one function per dialogue node; dlg_entries
--- maps a dialogue id to the node a hail opens on.
${rt}.dlg = {}
${rt}.dlg_entries = {}

function ${rt}.dlg_entry(id)
  local nodes = ${rt}.dlg[id]
  if nodes == nil then return nil end
  return nodes[${rt}.dlg_entries[id]]
end

--- Attach a dialogue to every handle in objs, or restore EE's own default
--- for the class when dialogue is nil.
---
--- setCommsScript("") does not restore anything — EE documents it as
--- *disabling* comms — and setCommsFunction takes precedence over any
--- script, so putting the default back means clearing the function first
--- and then selecting the default script from the ECS component profile.
--- EE 2026 no longer exposes typeName (API reference §16).
function ${rt}.set_dialogue(objs, dialogue)
  for _, o in ipairs(objs) do
    if ${rt}.alive(o) then
      if dialogue == nil then
        o:setCommsFunction(nil)
        if ${isStation} then
          o:setCommsScript("comms_station.lua")
        else
          o:setCommsScript("comms_ship.lua")
        end
      else
        o:setCommsScript("")
        o:setCommsFunction(${rt}.dlg_entry(dialogue))
      end
    end
  end
end

--- The object hails the player, rather than waiting to be hailed. EE
--- returns whether Relay accepted; the scenario has no retry policy, so
--- the answer is deliberately dropped.
function ${rt}.hail(id, text)
  local o, p = ${map}.objects[id], ${rt}.player()
  if ${rt}.alive(o) and p ~= nil then o:sendCommsMessage(p, text) end
end

--- Replaced by the emitted scenario when the project declares dialogues.
function ${rt}.install_dialogues() end

function ${rt}.hull_fraction()
  local p = ${rt}.player()
  if p == nil then return 1 end
  local max_hull = p:getHullMax()
  if max_hull == nil or max_hull <= 0 then return 1 end
  return p:getHull() / max_hull
end

function ${rt}.system_health(name)
  local p = ${rt}.player()
  if p == nil then return 1 end
  return p:getSystemHealth(name)
end

function ${rt}.scanned_simple(id)
  local o, p = ${map}.objects[id], ${rt}.player()
  if not ${rt}.alive(o) or p == nil then return false end
  return o:isScannedBy(p)
end

function ${rt}.scanned_full(id)
  local o, p = ${map}.objects[id], ${rt}.player()
  if not ${rt}.alive(o) or p == nil then return false end
  return o:isFullyScannedBy(p)
end

function ${rt}.var_get(name) return ${state}.vars[name] end

--- Variables belonging to one object, keyed by the project's own id.
--- Deliberately NOT fields on the EE handle: this table outlives the
--- object, so a rule can still ask what a ship's state was when it died.
function ${rt}.obj_vars(id)
  local t = ${state}.obj_vars[id]
  if t == nil then t = {}; ${state}.obj_vars[id] = t end
  return t
end

function ${rt}.obj_get(id, name) return ${rt}.obj_vars(id)[name] end

function ${rt}.run(label, fn)
  local ok, err = pcall(fn)
  if not ok then
    print("[forge] " .. label .. " failed: " .. tostring(err))
  end
end`;
}

// ---------------------------------------------------------------------------
// Target typing — lets the emitter type-check actions at build time
// ---------------------------------------------------------------------------

function objectsById(project: EEProject): Map<string, EEObject> {
  const map = new Map<string, EEObject>();
  for (const group of project.map.groups) {
    for (const object of group.objects) map.set(object.id, object);
  }
  return map;
}

/**
 * Which EE classes a target can resolve to. Used to reject, at build time,
 * an action that calls a method the target does not have — e.g.
 * `set_system_health` on a SpaceStation, which inherits from
 * ShipTemplateBasedObject and never from SpaceShip.
 */
function targetClasses(project: EEProject, ref: EETargetRef): string[] {
  switch (ref.ref) {
    case "player":
      return ["PlayerSpaceship"];
    case "object": {
      const object = objectsById(project).get(ref.objectId);
      if (object === undefined) {
        throw new CodegenError(`action targets unknown object "${ref.objectId}"`);
      }
      return [object.type];
    }
    case "group": {
      const group = project.map.groups.find((g) => g.id === ref.groupId);
      if (group === undefined) {
        throw new CodegenError(`action targets unknown group "${ref.groupId}"`);
      }
      return [...new Set(group.objects.map((o) => o.type))];
    }
  }
}

function targetsExpr(names: RuntimeNames, ref: EETargetRef): string {
  switch (ref.ref) {
    case "player":
      return `${names.rt}.targets("player", nil)`;
    case "object":
      return `${names.rt}.targets("object", ${luaString(ref.objectId)})`;
    case "group":
      return `${names.rt}.targets("group", ${luaString(ref.groupId)})`;
  }
}

/** `for … do if alive(o) then o:call(...) end end`, catalog-checked per class. */
function forEachTarget(
  catalog: EECatalog,
  project: EEProject,
  names: RuntimeNames,
  ref: EETargetRef,
  calls: readonly CallSpec[],
  body?: (objectVar: string) => string,
): string {
  for (const className of targetClasses(project, ref)) {
    for (const call of calls) validateCall(catalog, className, call);
  }
  const inner =
    body !== undefined
      ? body("o")
      : calls.map((c) => `o:${c.method}(${c.args.map(renderValue).join(", ")})`).join("\n");
  return `for _, o in ipairs(${targetsExpr(names, ref)}) do
  if ${names.rt}.alive(o) then
${indentBlock(inner, "    ")}
  end
end`;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export function emitPredicate(
  catalog: EECatalog,
  project: EEProject,
  names: RuntimeNames,
  predicate: EEPredicate,
  /** The sector the rule owning this predicate is scoped to (ADR-0058), or null/undefined for a global one. */
  scope: string | null = null,
): string {
  const byId = objectsById(project);
  const requireObject = (id: string): EEObject => {
    const object = byId.get(id);
    if (object === undefined) {
      throw new CodegenError(`predicate references unknown object "${id}"`);
    }
    return object;
  };
  const { rt } = names;

  switch (predicate.kind) {
    case "always":
      return "true";
    case "elapsed":
      // Campaign saves (ADR-0058): a global rule counts the campaign clock (which survives a restart), a scoped one its sector's own clock.
      if (usesPersistence(project)) {
        return `${rt}.persist.${scope === null ? "now" : "sector_now"}() >= ${renderValue(num(predicate.seconds))}`;
      }
      return `getScenarioTime() >= ${renderValue(num(predicate.seconds))}`;
    case "object_destroyed":
      requireObject(predicate.objectId);
      return `${rt}.destroyed(${luaString(predicate.objectId)})`;
    case "group_destroyed": {
      if (!project.map.groups.some((g) => g.id === predicate.groupId)) {
        throw new CodegenError(`predicate references unknown group "${predicate.groupId}"`);
      }
      return `${rt}.group_wiped(${luaString(predicate.groupId)})`;
    }
    case "player_in_zone": {
      const zone = requireObject(predicate.zoneId);
      if (zone.type !== "Zone") {
        throw new CodegenError(
          `player_in_zone expects a Zone, but "${predicate.zoneId}" is a ${zone.type}`,
        );
      }
      return `${rt}.zone_contains(${luaString(predicate.zoneId)})`;
    }
    case "player_near_object":
      requireObject(predicate.objectId);
      return `${rt}.near_object(${luaString(predicate.objectId)}, ${renderValue(num(predicate.distance))})`;
    case "player_near_point":
    {
      const point = placeResolver(project)(predicate.position, "a player-near-point trigger");
      return `${rt}.near_point(${renderValue(num(point.x))}, ${renderValue(num(point.y))}, ${renderValue(num(predicate.distance))})`;
    }
    case "player_hull_below":
      return `${rt}.hull_fraction() < ${renderValue(num(predicate.fraction))}`;
    case "player_system_below":
      validateCall(catalog, "PlayerSpaceship", {
        method: "getSystemHealth",
        args: [str(predicate.system)],
      });
      return `${rt}.system_health(${luaString(predicate.system)}) < ${renderValue(num(predicate.fraction))}`;
    case "object_scanned": {
      const object = requireObject(predicate.objectId);
      const method = predicate.full ? "isFullyScannedBy" : "isScannedBy";
      // Throws for e.g. a full scan of a SpaceStation, which has no
      // isFullyScannedBy — that method lives on SpaceShip.
      validateCall(catalog, object.type, { method, args: [raw("p")] });
      return `${rt}.${predicate.full ? "scanned_full" : "scanned_simple"}(${luaString(predicate.objectId)})`;
    }
    case "variable_equals":
      return `${rt}.var_get(${luaString(predicate.name)}) == ${renderValue(literal(predicate.value))}`;
    case "variable_at_least":
      return `(${rt}.var_get(${luaString(predicate.name)}) or 0) >= ${renderValue(num(predicate.value))}`;
    case "object_variable_equals":
      return `${rt}.obj_get(${luaString(predicate.objectId)}, ${luaString(predicate.name)}) == ${renderValue(literal(predicate.value))}`;
    case "object_variable_at_least":
      return `(${rt}.obj_get(${luaString(predicate.objectId)}, ${luaString(predicate.name)}) or 0) >= ${renderValue(num(predicate.value))}`;
    case "current_sector":
      if (!project.map.sectors.some((sector) => sector.id === predicate.sectorId)) {
        throw new CodegenError(`"current sector is" names unknown sector "${predicate.sectorId}"`);
      }
      return `${rt}.current_sector() == ${luaString(predicate.sectorId)}`;
  }
}

function literal(value: string | number | boolean): LuaValue {
  if (typeof value === "number") return num(value);
  if (typeof value === "boolean") return bool(value);
  return str(value);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * How one build treats the actions an extension owns. Threaded to every
 * action emitter; the default (no extensions, vanilla) is what a caller that
 * never heard of extensions gets, and it is the only default that cannot
 * quietly produce a scenario needing something the author did not choose.
 */
export interface BuildContext {
  readonly mode: BuildMode;
  readonly extensions: readonly ForgeExtension[];
  /** Hands out `s1`, `s2`, … in emission order: a stable key per action site. */
  readonly nextSite: () => string;
}

export function makeBuildContext(
  mode: BuildMode = "vanilla",
  extensions: readonly ForgeExtension[] = [],
): BuildContext {
  let n = 0;
  return { mode, extensions, nextSite: () => `s${(n += 1)}` };
}

function emitExtensionAction(
  catalog: EECatalog,
  project: EEProject,
  names: RuntimeNames,
  action: Extract<EEAction, { kind: `exodus_${string}` }>,
  build: BuildContext,
): string {
  if (!project.requires.includes("exodus")) {
    throw new CodegenError(
      `action "${action.kind}" requires the exodus tier — add "exodus" to the project's requires[] or use a vanilla action`,
    );
  }
  const stepId = action.stepId;
  if (stepId !== null && !project.logic.exodusSteps.some((step) => step.id === stepId)) {
    throw new CodegenError(`action "${action.kind}" names step "${stepId}", which this project does not define`);
  }
  if (build.mode === "vanilla") {
    // The alternative replaces the action outright; no extension is involved.
    if (stepId === null) {
      throw new CodegenError(
        `action "${action.kind}" has no without-EXODUS step, so a vanilla build has nothing to put in its place`,
      );
    }
    return `${names.rt}.step_fallback(${luaString(stepId)})`;
  }
  const extension = extensionFor(build.extensions, action);
  if (extension === null) {
    throw new CodegenError(
      `action "${action.kind}" needs the EXODUS extension, which is not registered for this build — ` +
        `register it, or build in vanilla mode`,
    );
  }
  return extension.emitAction(action, { stepId, siteKey: build.nextSite() }, { catalog, project, names });
}

export function emitAction(
  catalog: EECatalog,
  project: EEProject,
  names: RuntimeNames,
  action: EEAction,
  build: BuildContext = makeBuildContext(),
): string {
  if (isExtensionAction(action)) return emitExtensionAction(catalog, project, names, action, build);

  switch (action.kind) {
    case "global_message":
      return renderGlobalCall(
        catalog,
        "globalMessage",
        action.timeoutS === null
          ? [str(action.text)]
          : [str(action.text), num(action.timeoutS)],
      );
    case "banner":
      return renderGlobalCall(catalog, "setBanner", [str(action.text)]);
    case "gm_message":
      return renderGlobalCall(catalog, "addGMMessage", [str(action.text)]);
    case "play_sound":
      return renderGlobalCall(catalog, "playSoundFile", [str(action.file)]);
    case "victory":
      return renderGlobalCall(catalog, "victory", [str(action.faction)]);
    case "pause_game":
      return renderGlobalCall(catalog, "pauseGame", []);
    case "save_checkpoint":
      // Campaign saves (ADR-0058). The build refuses this action when the project has them off, so the runtime table exists whenever this is emitted.
      return `${names.rt}.persist.checkpoint("action")`;
    case "ship_log":
      return forEachTarget(catalog, project, names, { ref: "player" }, [
        { method: "addToShipLog", args: [str(action.text), str(action.color)] },
      ]);
    case "set_alert_level":
      return forEachTarget(catalog, project, names, { ref: "player" }, [
        { method: "commandSetAlertLevel", args: [str(action.level)] },
      ]);
    case "spawn_group": {
      if (!project.map.groups.some((g) => g.id === action.groupId)) {
        throw new CodegenError(`spawn_group references unknown group "${action.groupId}"`);
      }
      // The group's objects exist only now, so this is where they can be
      // given the dialogues they declare (ADR-0039). Idempotent, and a
      // no-op for a project with none.
      return `${names.map}.spawn_group(${luaString(action.groupId)})\n${names.rt}.install_dialogues()`;
    }
    case "set_dialogue": {
      if (
        action.dialogueId !== null &&
        !project.logic.dialogues.some((d) => d.id === action.dialogueId)
      ) {
        throw new CodegenError(
          `set_dialogue references unknown dialogue "${action.dialogueId}"`,
        );
      }
      // Through the runtime helper rather than forEachTarget: restoring
      // EE's default needs the object's own class at runtime, and only a
      // handle knows that.
      {
        const call = `${names.rt}.set_dialogue(${targetsExpr(names, action.target)}, ${
          action.dialogueId === null ? "nil" : luaString(action.dialogueId)
        })`;
        // Campaign saves (ADR-0058): a dialogue a Forge action set is part of what a checkpoint keeps.
        const ids = usesPersistence(project) ? safeObjectIds(project, action.target) : null;
        if (ids === null) return call;
        return `${call}\n${names.rt}.persist.note_dialogue({ ${ids.map((id) => luaString(id)).join(", ")} }, ${
          action.dialogueId === null ? "nil" : luaString(action.dialogueId)
        })`;
      }
    }
    case "hail_player": {
      if (!objectsById(project).has(action.objectId)) {
        throw new CodegenError(`hail_player references unknown object "${action.objectId}"`);
      }
      return `${names.rt}.hail(${luaString(action.objectId)}, ${luaString(action.text)})`;
    }
    case "destroy":
      return forEachTarget(catalog, project, names, action.target, [
        { method: "destroy", args: [] },
      ]);
    case "change_sector": {
      if (!project.map.sectors.some((sector) => sector.id === action.sectorId)) {
        throw new CodegenError(`change_sector names unknown sector "${action.sectorId}"`);
      }
      const marker = project.map.markers.find((m) => m.id === action.arrivalMarkerId);
      if (marker === undefined) {
        throw new CodegenError(`change_sector arrives at unknown marker "${action.arrivalMarkerId}"`);
      }
      if (marker.sector !== action.sectorId) {
        throw new CodegenError(
          `change_sector to "${action.sectorId}" arrives at marker "${marker.id}", which is not filed under that sector`,
        );
      }
      // The marker is resolved here, like every place (ADR-0038): the Lua carries the coordinates, not the marker.
      return `${names.rt}.change_sector(${luaString(action.sectorId)}, ${renderValue(num(marker.position.x))}, ${renderValue(num(marker.position.y))}, ${
        action.rotation === null ? "nil" : renderValue(num(action.rotation))
      })`;
    }
    case "set_variable":
      return `${names.state}.vars[${luaString(action.name)}] = ${renderValue(literal(action.value))}`;
    case "add_variable":
      return `${names.state}.vars[${luaString(action.name)}] = (${names.state}.vars[${luaString(action.name)}] or 0) + ${renderValue(num(action.delta))}`;
    case "set_ai":
      return forEachTarget(catalog, project, names, action.target, [
        { method: "setAI", args: [str(action.ai)] },
      ]);
    case "set_object_variable":
      return emitObjectVariable(
        project,
        names,
        action.target,
        action.name,
        (slot) => `${slot} = ${renderValue(literal(action.value))}`,
      );
    case "add_object_variable":
      return emitObjectVariable(
        project,
        names,
        action.target,
        action.name,
        (slot) => `${slot} = (${slot} or 0) + ${renderValue(num(action.delta))}`,
      );
    case "order_idle":
    case "order_roaming":
    case "order_stand_ground":
    case "order_roaming_at":
    case "order_defend_location":
    case "order_fly_towards":
    case "order_fly_towards_blind":
    case "order_attack":
    case "order_dock":
    case "order_retreat":
    case "order_defend_target":
    case "order_fly_formation":
      return emitOrder(catalog, project, names, action);
    case "set_hull":
      return forEachTarget(catalog, project, names, action.target, [
        { method: "setHull", args: [num(action.value)] },
      ]);
    case "damage_hull": {
      // Needs the current value, so it reads before it writes; both methods
      // are still validated against every class the target can resolve to.
      const calls: CallSpec[] = [
        { method: "getHull", args: [] },
        { method: "setHull", args: [num(0)] },
      ];
      return forEachTarget(
        catalog,
        project,
        names,
        action.target,
        calls,
        (o) => `${o}:setHull(math.max(0, ${o}:getHull() - ${renderValue(num(action.amount))}))`,
      );
    }
    case "set_system_health":
      return forEachTarget(catalog, project, names, action.target, [
        { method: "setSystemHealth", args: [str(action.system), num(action.value)] },
      ]);
    case "set_system_heat":
      return forEachTarget(catalog, project, names, action.target, [
        { method: "setSystemHeat", args: [str(action.system), num(action.value)] },
      ]);

  }
}

/** The `CpuShip:order*` method each order action maps to, and its arguments. */
function emitOrder(
  catalog: EECatalog,
  project: EEProject,
  names: RuntimeNames,
  action: Extract<EEAction, { kind: `order_${string}` }>,
): string {
  const handle = (objectId: string): string => {
    if (!objectsById(project).has(objectId)) {
      throw new CodegenError(`order targets unknown object "${objectId}"`);
    }
    return `${names.map}.objects[${luaString(objectId)}]`;
  };

  // A marker never reaches EE (ADR-0038): it becomes the same literal pair
  // a hand-typed point would have produced.
  const place = placeResolver(project);
  const placePair = (ref: EEPointRef, where: string): LuaValue[] => {
    const point = place(ref, where);
    return [num(point.x), num(point.y)];
  };

  // One order, one shape: the record already carries exactly what the EE
  // method takes, so there is nothing left to check here. An order aimed at
  // something that is not a CpuShip still fails — forEachTarget validates
  // the call against every class the target can resolve to.
  let call: CallSpec;
  switch (action.kind) {
    case "order_idle":
      call = { method: "orderIdle", args: [] };
      break;
    case "order_roaming":
      call = { method: "orderRoaming", args: [] };
      break;
    case "order_stand_ground":
      call = { method: "orderStandGround", args: [] };
      break;
    case "order_roaming_at":
      call = {
        method: "orderRoamingAt",
        args: placePair(action.position, `a ${action.kind} action`),
      };
      break;
    case "order_defend_location":
      call = {
        method: "orderDefendLocation",
        args: placePair(action.position, `a ${action.kind} action`),
      };
      break;
    case "order_fly_towards":
      call = {
        method: "orderFlyTowards",
        args: placePair(action.position, `a ${action.kind} action`),
      };
      break;
    case "order_fly_towards_blind":
      call = {
        method: "orderFlyTowardsBlind",
        args: placePair(action.position, `a ${action.kind} action`),
      };
      break;
    case "order_retreat":
      call = { method: "orderRetreat", args: [raw(handle(action.objectId))] };
      break;
    case "order_defend_target":
      call = { method: "orderDefendTarget", args: [raw(handle(action.objectId))] };
      break;
    case "order_attack":
      call = { method: "orderAttack", args: [raw(handle(action.objectId))] };
      break;
    case "order_dock":
      call = { method: "orderDock", args: [raw(handle(action.objectId))] };
      break;
    case "order_fly_formation":
      call = {
        method: "orderFlyFormation",
        args: [raw(handle(action.leaderId)), num(action.offset.x), num(action.offset.y)],
      };
      break;
  }
  // Entity methods exist on every ECS entity, but orders require ai_controller.
  for (const className of targetClasses(project, action.target)) {
    if (className !== "CpuShip") throw new CodegenError(`${call.method} requires a CpuShip, got ${className}`);
  }
  const emitted = forEachTarget(catalog, project, names, action.target, [call]);
  if (!usesPersistence(project)) return emitted;
  // Campaign saves (ADR-0058): remember the last order a Forge action gave, by object ids, so a resume can give it again.
  const ids = safeObjectIds(project, action.target);
  if (ids === null) return emitted;
  const xy = (ref: EEPointRef): string => {
    const [x, y] = placePair(ref, `a ${action.kind} action`);
    return `x = ${renderValue(x ?? num(0))}, y = ${renderValue(y ?? num(0))}`;
  };
  let spec: string;
  switch (action.kind) {
    case "order_roaming_at":
    case "order_defend_location":
    case "order_fly_towards":
    case "order_fly_towards_blind":
      spec = `{ m = ${luaString(call.method)}, ${xy(action.position)} }`;
      break;
    case "order_retreat":
    case "order_defend_target":
    case "order_attack":
    case "order_dock":
      spec = `{ m = ${luaString(call.method)}, id = ${luaString(action.objectId)} }`;
      break;
    case "order_fly_formation":
      spec = `{ m = ${luaString(call.method)}, id = ${luaString(action.leaderId)}, ox = ${renderValue(num(action.offset.x))}, oy = ${renderValue(num(action.offset.y))} }`;
      break;
    default:
      spec = `{ m = ${luaString(call.method)} }`;
  }
  return `${emitted}\n${names.rt}.persist.note_order({ ${ids.map((id) => luaString(id)).join(", ")} }, ${spec})`;
}

/** The object ids a target names, or null when it cannot be told statically (a player target with several player ships). */
function safeObjectIds(project: EEProject, target: EETargetRef): string[] | null {
  try {
    return targetObjectIds(project, target);
  } catch {
    return null;
  }
}

/**
 * Write an object variable for every object a target resolves to.
 *
 * Resolved to literal ids at build time rather than through handles: group
 * membership is known from the document, so the emitted Lua needs no
 * lookup and works whether or not the objects have spawned — which is what
 * lets a variable outlive the object it belongs to.
 */
function emitObjectVariable(
  project: EEProject,
  names: RuntimeNames,
  target: EETargetRef,
  variable: string,
  assign: (slot: string) => string,
): string {
  const ids = targetObjectIds(project, target);
  if (ids.length === 1) {
    const only = ids[0] ?? "";
    return assign(`${names.rt}.obj_vars(${luaString(only)})[${luaString(variable)}]`);
  }
  const list = ids.map((id) => luaString(id)).join(", ");
  return `for _, id in ipairs({ ${list} }) do
${indentBlock(assign(`${names.rt}.obj_vars(id)[${luaString(variable)}]`), "  ")}
end`;
}

/**
 * The object ids a target names, statically.
 *
 * `player` resolves to the project's own PlayerSpaceship: object variables
 * are keyed by map-object id, so a player ship the map does not spawn has
 * no key to write to — and saying so is better than inventing one.
 */
function targetObjectIds(project: EEProject, target: EETargetRef): string[] {
  switch (target.ref) {
    case "object":
      if (!objectsById(project).has(target.objectId)) {
        throw new CodegenError(`object variable targets unknown object "${target.objectId}"`);
      }
      return [target.objectId];
    case "group": {
      const group = project.map.groups.find((g) => g.id === target.groupId);
      if (group === undefined) {
        throw new CodegenError(`object variable targets unknown group "${target.groupId}"`);
      }
      return group.objects.map((o) => o.id);
    }
    case "player": {
      const players = [...objectsById(project).values()].filter(
        (o) => o.type === "PlayerSpaceship",
      );
      const only = players[0];
      if (players.length !== 1 || only === undefined) {
        throw new CodegenError(
          players.length === 0
            ? "object variable targets the player, but this map spawns no PlayerSpaceship — use a global variable instead"
            : "object variable targets the player, but this map spawns more than one PlayerSpaceship — name the object",
        );
      }
      return [only.id];
    }
  }
}

// ---------------------------------------------------------------------------
// Beats, rules, GM buttons
// ---------------------------------------------------------------------------

function emitActions(
  catalog: EECatalog,
  project: EEProject,
  names: RuntimeNames,
  actions: readonly EEAction[],
  build: BuildContext,
): string {
  if (actions.length === 0) return "-- (no actions)";
  return actions.map((a) => emitAction(catalog, project, names, a, build)).join("\n");
}

/**
 * The without-EXODUS step runtime and the project's step table (ADR-0049).
 *
 * A step's phase only moves forward: `idle` → `fallback` → `settled`, or
 * `idle` → `skipped`. `step_settle` is the single place a step pays out
 * (`success`), and it refuses a second call — so whoever owns the step
 * (EXODUS, or the alternative once EXODUS could not take it) settles it at
 * most once, and a late EXODUS answer has nothing left to pay.
 */
function emitSteps(
  catalog: EECatalog,
  project: EEProject,
  names: RuntimeNames,
  build: BuildContext,
): string {
  const { rt, state } = names;
  const runtime = `-- === Without-EXODUS alternatives (ADR-0049) ===
${rt}.steps = {}
${state}.steps = {}
${state}.timers = {}

function ${rt}.step_state(id)
  local st = ${state}.steps[id]
  if st == nil then st = { phase = "idle" }; ${state}.steps[id] = st end
  return st
end

--- The step's outcome happened. Pays out once. \`via\` says who made it so:
--- "service" (the service reported it), "handoff" (the request was handed to the
--- service, which confirmed nothing) or "alternative" (the author's fallback ran).
function ${rt}.step_settle(id, via)
  local st = ${rt}.step_state(id)
  if st.phase == "settled" then return end
  st.phase = "settled"
  st.via = via or "alternative"
  local step = ${rt}.steps[id]
  if step ~= nil and step.success ~= nil then ${rt}.run("step " .. id .. " success", step.success) end
end

--- EXODUS cannot take this step: its alternative starts, once.
function ${rt}.step_fallback(id)
  local st = ${rt}.step_state(id)
  if st.phase ~= "idle" then return end
  local step = ${rt}.steps[id]
  if step == nil or step.kind == "none" then st.phase = "skipped"; return end
  st.phase = "fallback"
  if step.kind == "immediate" then
    ${rt}.run("step " .. id, step.alt)
    ${rt}.step_settle(id, "alternative")
  elseif step.kind == "wait" then
    table.insert(${state}.timers, { at = getScenarioTime() + step.seconds, id = id })
  elseif step.kind == "gm" then
    if step.message ~= "" then addGMMessage(step.message) end
    addGMFunction(step.label, step.press)
  end
end

--- The GM pressed the step's button.
function ${rt}.step_press(id)
  local st = ${rt}.step_state(id)
  if st.phase ~= "fallback" or st.pressed then return end
  st.pressed = true
  ${rt}.run("step " .. id, ${rt}.steps[id].alt)
  ${rt}.step_settle(id, "alternative")
end

function ${rt}.tick_steps(now)
  local keep = {}
  for _, timer in ipairs(${state}.timers) do
    if now >= timer.at then
      if ${rt}.step_state(timer.id).phase == "fallback" then
        ${rt}.run("step " .. timer.id, ${rt}.steps[timer.id].alt)
        ${rt}.step_settle(timer.id, "alternative")
      end
    else
      keep[#keep + 1] = timer
    end
  end
  ${state}.timers = keep
end`;

  const entries = project.logic.exodusSteps.map((step, index) => {
    const alternative = step.alternative;
    const kind = alternative === null ? "none" : alternative.kind;
    const alt =
      alternative === null || alternative.kind === "none"
        ? "nil"
        : `function()
${indentBlock(emitActions(catalog, project, names, alternative.actions, build), "    ")}
  end`;
    const success =
      step.onSuccess.length === 0
        ? "nil"
        : `function()
${indentBlock(emitActions(catalog, project, names, step.onSuccess, build), "    ")}
  end`;
    const gm = alternative !== null && alternative.kind === "gm" ? alternative : null;
    // The press callback is a named global so its sole upvalue is _ENV,
    // which is all EE's callback conversion accepts.
    const press =
      gm === null
        ? ""
        : `function ${rt}_gm_${index + 1}() ${rt}.step_press(${luaString(step.id)}) end\n`;
    return `${press}${rt}.steps[${luaString(step.id)}] = {
  kind = ${luaString(kind)},
  essential = ${step.essential ? "true" : "false"},
  answer_s = ${step.answerWithinS === null ? "nil" : renderValue(num(step.answerWithinS))},
  seconds = ${alternative !== null && alternative.kind === "wait" ? renderValue(num(alternative.seconds)) : "0"},
  label = ${luaString(gm?.label ?? "")},
  message = ${luaString(gm?.message ?? "")},
  alt = ${alt},
  success = ${success},
  press = ${gm === null ? "nil" : `${rt}_gm_${index + 1}`},
}`;
  });

  return `${runtime}\n\n${entries.length === 0 ? "-- (no steps recorded)" : entries.join("\n\n")}`;
}

export function emitLogic(
  catalog: EECatalog,
  project: EEProject,
  build: BuildContext = makeBuildContext(),
): string {
  const { logic } = project;
  const names = runtimeNames(project.id);
  const { rt, state, map } = names;

  const beats = [...logic.beats].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const persistence = usesPersistence(project);
  const beatEntries = beats
    .map(
      (beat) => `  {
    id = ${luaString(beat.id)},
    at = ${renderValue(num(beat.at))},${scopeOf(beat) === null ? "" : `\n    sector = ${luaString(scopeOf(beat) ?? "")},`}
    -- ${beat.label}
    fn = function()
${indentBlock(emitActions(catalog, project, names, beat.actions, build), "      ")}
    end,
  },`,
    )
    .join("\n");

  const ruleEntries = logic.rules
    .map((rule) => {
      const predicates = [rule.when, ...rule.conditions]
        .map((p) => emitPredicate(catalog, project, names, p, scopeOf(rule)))
        .map((expr) => `(${expr})`);
      return `  {
    id = ${luaString(rule.id)},
    once = ${rule.once ? "true" : "false"},
    fired = false,
    was_true = false,${scopeOf(rule) === null ? "" : `\n    sector = ${luaString(scopeOf(rule) ?? "")},`}
    -- ${rule.label}
    when = function()
      return ${predicates.join(" and ")}
    end,
    fn = function()
${indentBlock(emitActions(catalog, project, names, rule.actions, build), "      ")}
    end,
  },`;
    })
    .join("\n");

  const variableLines = logic.variables
    .map((v) => `${state}.vars[${luaString(v.name)}] = ${renderValue(literal(v.initial))}`)
    .join("\n");

  // Object variables are seeded from the map, not from the logic: they are
  // declared on the object that owns them, so they arrive with it.
  const objectVariableLines = project.map.groups
    .flatMap((group) => group.objects)
    .flatMap((object) =>
      object.variables.map(
        (v) =>
          `${state}.obj_vars[${luaString(object.id)}] = ${state}.obj_vars[${luaString(
            object.id,
          )}] or {}\n${state}.obj_vars[${luaString(object.id)}][${luaString(
            v.name,
          )}] = ${renderValue(literal(v.initial))}`,
      ),
    )
    .join("\n");

  // Dialogues. The two emitters are handed in rather than imported by
  // `dialogue.ts`, which would make the modules circular.
  const dialogues = emitDialogues(catalog, project, names, {
    predicate: (predicate) => emitPredicate(catalog, project, names, predicate),
    actions: (actions) => emitActions(catalog, project, names, actions, build),
  });

  const dialogueEntries =
    logic.dialogues.length === 0
      ? `-- (no dialogues)`
      : logic.dialogues
          .map(
            (dialogue) =>
              `${rt}.dlg_entries[${luaString(dialogue.id)}] = ${luaString(dialogue.entry)}`,
          )
          .join("\n");

  // One line per object that names a dialogue. `set_dialogue` skips a
  // handle that has not spawned yet, so calling this before an on_call
  // group arrives is harmless — and calling it again after is what makes
  // the group's objects pick theirs up.
  const dialogueInstalls = project.map.groups
    .flatMap((group) => group.objects)
    .filter(
      (object): object is typeof object & { dialogueId: string } =>
        "dialogueId" in object && object.dialogueId !== null,
    )
    .map(
      (object) =>
        `  ${rt}.set_dialogue(${rt}.targets("object", ${luaString(object.id)}), ${luaString(object.dialogueId)})`,
    )
    .join("\n");

  const steps = usesExodusSteps(project) ? emitSteps(catalog, project, names, build) : "";

  // Each callback body references only globals, so its sole upvalue is
  // _ENV — see the module docstring for why EE requires that.
  const gmButtons = logic.gmButtons
    .map(
      (button) =>
        `  ${renderGlobalCall(catalog, "addGMFunction", [
          str(button.label),
          raw(`function()
    ${rt}.run(${luaString(`gm:${button.id}`)}, function()
${indentBlock(emitActions(catalog, project, names, button.actions, build), "      ")}
    end)
  end`),
        ])}`,
    )
    .join("\n");

  return `${luaRuntime(names, findTarget(catalog.eeVersion)?.dialogueRestore, usesSectorRuntime(project), persistence)}

-- === Variables ===
${variableLines === "" ? "-- (none)" : variableLines}

-- === Object variables (declared on the objects that own them) ===
${objectVariableLines === "" ? "-- (none)" : objectVariableLines}

-- === Beats (time-keyed, in ascending order) ===
local beats = {
${beatEntries}
}

-- === Rules (edge-triggered: fire when the predicate turns true) ===
local rules = {
${ruleEntries}
}
${persistence ? `\n${emitPersistence(project, names, project.eeVersion)}\n` : ""}
-- === Dialogues (ADR-0039) ===
${dialogues}

${dialogueEntries}
${steps === "" ? "" : `\n${steps}\n`}
-- Attach the dialogues the map objects declare. Called from init() after
-- spawn() and again after every spawn_group, so a group that arrives
-- mid-scenario gets its conversations too. Idempotent.
${rt}.install_dialogues = function()
${dialogueInstalls === "" ? "  -- (none)" : dialogueInstalls}
end

--- Register the GM console buttons this project declares.
--- EE accepts addGMFunction only from a loaded scenario, never over the
--- HTTP API, and only for callbacks whose sole upvalue is _ENV.
local function install_gm_buttons()
${gmButtons === "" ? "  -- (none)" : gmButtons}
end
${persistence ? `${rt}.install_gm_buttons = install_gm_buttons
` : ""}
--- Walk the scheduler. A "while" loop, not an "if": a long tick or an
--- unpause fires every beat it skipped, in order.
${
    persistence
      ? `-- Campaign saves (ADR-0058): global beats run on the campaign clock; a beat scoped to a sector runs on that sector's own clock, only while it is active.
local gbeats, sbeats = {}, {}
for _, beat in ipairs(beats) do
  if beat.sector == nil then
    gbeats[#gbeats + 1] = beat
  else
    sbeats[beat.sector] = sbeats[beat.sector] or {}
    table.insert(sbeats[beat.sector], beat)
  end
end
local function tick_beats(t)
  while ${state}.beat_idx <= #gbeats and t >= gbeats[${state}.beat_idx].at do
    local beat = gbeats[${state}.beat_idx]
    ${state}.beat_idx = ${state}.beat_idx + 1
    ${rt}.run("beat " .. beat.id, beat.fn)
  end
  local sector = ${map}.sector
  local list = sbeats[sector]
  if list ~= nil then
    local P = ${rt}.persist
    local idx = P.sbeat[sector] or 1
    while idx <= #list and P.sector_now() >= list[idx].at do
      local beat = list[idx]
      idx = idx + 1
      P.sbeat[sector] = idx
      ${rt}.run("beat " .. beat.id, beat.fn)
      -- a jump inside the beat changed the active sector: this list belongs to the one that was left
      if ${map}.sector ~= sector then break end
      idx = P.sbeat[sector] or idx
    end
  end
end`
      : `local function tick_beats(t)
  while ${state}.beat_idx <= #beats and t >= beats[${state}.beat_idx].at do
    local beat = beats[${state}.beat_idx]
    ${rt}.run("beat " .. beat.id, beat.fn)
    ${state}.beat_idx = ${state}.beat_idx + 1
  end
end`
  }

local function tick_rules()${usesSectorRuntime(project) ? `
  local transitions = ${state}.transitions` : ""}
  for _, rule in ipairs(rules) do${usesSectorRuntime(project) ? `
    -- A jump happened in this update: the rules after it belong to the old sector. They wait for the next update, in the new world.
    if ${state}.transitions ~= transitions then break end` : ""}
    if not (rule.once and rule.fired)${persistence ? ` and (rule.sector == nil or rule.sector == ${map}.sector)` : ""} then
      local ok, value = pcall(rule.when)
      if ok then
        if value and not rule.was_true then
          ${rt}.run("rule " .. rule.id, rule.fn)
          rule.fired = true
        end
        rule.was_true = value
      else
        print("[forge] rule " .. rule.id .. " predicate failed: " .. tostring(value))
      end
    end
  end
end`;
}
