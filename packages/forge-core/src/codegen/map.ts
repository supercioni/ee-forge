import type {
  EECatalog,
  EEMapGroup,
  EEObject,
  EEProject,
  EESpawnOrder,
} from "@forge/contracts";
import { placeResolver, type PlaceResolver } from "./place.js";
import { startSectorOf, usesSectorJumps, usesSectorRuntime } from "../sector-runtime.js";
import { findTarget } from "../targets.js";
import { usesPersistence } from "../persistence.js";
import { runtimeNames } from "./logic.js";
import {
  bool,
  CodegenError,
  ctor,
  num,
  raw,
  renderChain,
  str,
  type CallSpec,
  type LuaValue,
} from "./lua.js";

/**
 * Emits `<project>_map.lua` — the spawn half of a project.
 *
 * Shape of the generated module:
 *
 *   <id>_map.objects        id → handle, populated as objects spawn
 *   <id>_map.groups         group id → array of handles
 *   <id>_map.spawn()        spawns every `on_start` group, returns handles
 *   <id>_map.spawn_group(g) spawns one group on demand, returns handles
 *
 * Both spawn functions **return the handles they created**. That is the
 * whole EXODUS integration story (ADR-0034 §4): a chapter wraps the call
 * in `bridge:track`, and nothing EXODUS-shaped leaks into this file.
 */

/** Calls shared by every object type, emitted in a stable order. */
function commonCalls(object: EEObject): CallSpec[] {
  const calls: CallSpec[] = [];
  if (object.callsign !== null) {
    calls.push({ method: "setCallSign", args: [str(object.callsign)] });
  }
  calls.push({
    method: "setPosition",
    args: [num(object.position.x), num(object.position.y)],
  });
  if ("rotation" in object && object.rotation !== null) {
    calls.push({ method: "setRotation", args: [num(object.rotation)] });
  }
  if ("faction" in object) {
    calls.push({ method: "setFaction", args: [str(object.faction)] });
  }
  if (object.description !== null) {
    calls.push({ method: "setDescription", args: [str(object.description)] });
  }
  return calls;
}

/**
 * The `CpuShip:order*` call for a spawn order.
 *
 * One arm per variant rather than a name lookup, so the exhaustiveness
 * check and the catalog check both bite: adding a fifth order to the
 * schema stops compiling here until it is emitted.
 */
function orderCall(
  order: EESpawnOrder,
  place: PlaceResolver,
  shipId: string,
): CallSpec {
  switch (order.kind) {
    case "idle":
      return { method: "orderIdle", args: [] };
    case "roaming":
      return { method: "orderRoaming", args: [] };
    case "stand_ground":
      return { method: "orderStandGround", args: [] };
    case "defend_location": {
      const point = place(order.position, `ship "${shipId}" defend-location order`);
      return { method: "orderDefendLocation", args: [num(point.x), num(point.y)] };
    }
  }
}

/**
 * Per-type calls. Every method named here is checked against the catalog
 * by `renderChain`, so a typo or a setter that does not exist on the class
 * fails the build rather than EE.
 */
function typeCalls(
  object: EEObject,
  mapGlobal: string,
  place: PlaceResolver,
): CallSpec[] {
  const calls: CallSpec[] = [];
  switch (object.type) {
    case "PlayerSpaceship":
    case "SpaceStation":
      calls.push({ method: "setTemplate", args: [str(object.template)] });
      break;
    case "CpuShip":
      calls.push({ method: "setTemplate", args: [str(object.template)] });
      // After setTemplate on purpose: the template carries a default AI,
      // so a per-ship choice has to land second to win.
      if (object.ai !== null) calls.push({ method: "setAI", args: [str(object.ai)] });
      // A ship with no order is an Idle ship, and EE's Idle "doesn't
      // target or attack nearby enemies" — so this call is what decides
      // whether a spawned fleet does anything at all.
      if (object.order !== null) calls.push(orderCall(object.order, place, object.id));
      break;
    case "Asteroid":
    case "VisualAsteroid":
      if (object.size !== null) calls.push({ method: "setSize", args: [num(object.size)] });
      break;
    case "Planet":
      calls.push({ method: "setPlanetRadius", args: [num(object.radius)] });
      if (object.surfaceTexture !== null) {
        calls.push({ method: "setPlanetSurfaceTexture", args: [str(object.surfaceTexture)] });
      }
      if (object.cloudTexture !== null) {
        calls.push({ method: "setPlanetCloudTexture", args: [str(object.cloudTexture)] });
      }
      if (object.atmosphereTexture !== null) {
        calls.push({
          method: "setPlanetAtmosphereTexture",
          args: [str(object.atmosphereTexture)],
        });
      }
      if (object.atmosphereColor !== null) {
        const [r, g, b] = object.atmosphereColor;
        calls.push({ method: "setPlanetAtmosphereColor", args: [num(r), num(g), num(b)] });
      }
      if (object.axialRotationTime !== null) {
        calls.push({ method: "setAxialRotationTime", args: [num(object.axialRotationTime)] });
      }
      if (object.distanceFromMovementPlane !== null) {
        calls.push({
          method: "setDistanceFromMovementPlane",
          args: [num(object.distanceFromMovementPlane)],
        });
      }
      // setOrbit must come after setPosition: EE locks the orbital radius
      // to the distance between the two objects at the moment of the call.
      if (object.orbit !== null) {
        calls.push({
          method: "setOrbit",
          args: [
            raw(`${mapGlobal}.objects[${JSON.stringify(object.orbit.targetId)}]`),
            num(object.orbit.orbitTimeS),
          ],
        });
      }
      break;
    case "Nebula":
    case "Mine":
    case "BlackHole":
      break;
    case "WormHole": {
      const exit = place(object.targetPosition, `wormhole "${object.id}" exit`);
      calls.push({ method: "setTargetPosition", args: [num(exit.x), num(exit.y)] });
      break;
    }
    case "Artifact":
      if (object.model !== null) calls.push({ method: "setModel", args: [str(object.model)] });
      if (object.spin !== null) calls.push({ method: "setSpin", args: [num(object.spin)] });
      if (object.allowPickup !== null) {
        calls.push({ method: "allowPickup", args: [bool(object.allowPickup)] });
      }
      if (object.radarTraceIcon !== null) {
        calls.push({ method: "setRadarTraceIcon", args: [str(object.radarTraceIcon)] });
      }
      if (object.radarTraceScale !== null) {
        calls.push({ method: "setRadarTraceScale", args: [num(object.radarTraceScale)] });
      }
      if (object.radarTraceColor !== null) {
        const [r, g, b] = object.radarTraceColor;
        calls.push({ method: "setRadarTraceColor", args: [num(r), num(g), num(b)] });
      }
      break;
    case "SupplyDrop":
      if (object.energy !== null) calls.push({ method: "setEnergy", args: [num(object.energy)] });
      for (const w of object.weaponStorage) {
        calls.push({ method: "setWeaponStorage", args: [str(w.weapon), num(w.amount)] });
      }
      break;
    case "ScanProbe":
      if (object.speed !== null) calls.push({ method: "setSpeed", args: [num(object.speed)] });
      if (object.lifetime !== null) {
        calls.push({ method: "setLifetime", args: [num(object.lifetime)] });
      }
      if (object.target !== null) {
        const aim = place(object.target, `probe "${object.id}" target`);
        calls.push({ method: "setTarget", args: [num(aim.x), num(aim.y)] });
      }
      // EE hard-faults on getOwner() for an unowned probe, so an authored
      // probe always gets the player ship as its owner.
      if (object.ownedByPlayer) {
        calls.push({ method: "setOwner", args: [raw("getPlayerShip(-1)")] });
      }
      break;
    case "WarpJammer":
      if (object.range !== null) calls.push({ method: "setRange", args: [num(object.range)] });
      if (object.hull !== null) calls.push({ method: "setHull", args: [num(object.hull)] });
      break;
    case "Zone": {
      const coords: LuaValue[] = [];
      for (const p of object.points) {
        coords.push(num(p.x), num(p.y));
      }
      calls.push({ method: "setPoints", args: coords });
      if (object.color !== null) {
        const [r, g, b] = object.color;
        calls.push({ method: "setColor", args: [num(r), num(g), num(b)] });
      }
      if (object.label !== null) calls.push({ method: "setLabel", args: [str(object.label)] });
      break;
    }
  }
  return calls;
}

/**
 * Order a group's objects so an orbit parent is always spawned before its
 * satellite. Anything else keeps authored order, so diffs stay readable.
 */
function orderByOrbitDependency(objects: readonly EEObject[]): EEObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const emitted = new Set<string>();
  const out: EEObject[] = [];

  const visit = (object: EEObject, stack: Set<string>): void => {
    if (emitted.has(object.id)) return;
    if (stack.has(object.id)) {
      throw new CodegenError(`orbit cycle detected at object "${object.id}"`);
    }
    stack.add(object.id);
    if (object.type === "Planet" && object.orbit !== null) {
      const parent = byId.get(object.orbit.targetId);
      if (parent !== undefined) visit(parent, stack);
    }
    stack.delete(object.id);
    emitted.add(object.id);
    out.push(object);
  };

  for (const object of objects) visit(object, new Set());
  return out;
}

function renderObject(
  catalog: EECatalog,
  object: EEObject,
  mapGlobal: string,
  indent: string,
  place: PlaceResolver,
  sectors: boolean,
  persist: boolean,
): string {
  const calls = [...commonCalls(object), ...typeCalls(object, mapGlobal, place)];
  const chain = renderChain(catalog, object.type, ctor(object.type), calls, {
    indent: `${indent}  `,
  });
  const tracked = `track(created, ${JSON.stringify(object.id)}, ${chain})`;
  // With sectors in play the same player ship goes on through every jump: a group that holds it must not make a second one.
  if (sectors && object.type === "PlayerSpaceship") {
    const skip = persist ? ` and not (opts ~= nil and opts.skip ~= nil and opts.skip[${JSON.stringify(object.id)}])` : "";
    return `${indent}if M.objects[${JSON.stringify(object.id)}] == nil${skip} then\n${indent}  ${tracked}\n${indent}end`;
  }
  // Campaign saves (ADR-0058): an object recorded as destroyed is never rebuilt — no callback, no reward.
  if (persist) {
    return `${indent}if not (opts ~= nil and opts.skip ~= nil and opts.skip[${JSON.stringify(object.id)}]) then\n${indent}  ${tracked}\n${indent}end`;
  }
  return `${indent}${tracked}`;
}

function renderGroup(
  catalog: EECatalog,
  group: EEMapGroup,
  mapGlobal: string,
  place: PlaceResolver,
  sectors: boolean,
  persist: boolean,
): string {
  const objects = orderByOrbitDependency(group.objects);
  const lines = objects.map((o) => renderObject(catalog, o, mapGlobal, "    ", place, sectors, persist));
  return [
    `  if name == ${JSON.stringify(group.id)} then`,
    `    -- ${group.label}`,
    ...lines,
    `  end`,
  ].join("\n");
}

export function emitMap(catalog: EECatalog, project: EEProject): string {
  const mapGlobal = `${project.id.replace(/-/g, "_")}_map`;
  const groups = project.map.groups;
  const sectors = usesSectorRuntime(project);
  const start = startSectorOf(project);
  // With a start sector, only its *At mission start* groups and the Shared ones exist at the start; without one (every
  // project before ADR-0056) all of them do, exactly as before.
  const startGroups = groups
    .filter((g) => g.when === "on_start" && (!sectors || start === null || g.sector === null || g.sector === start))
    .map((g) => g.id);

  // Built once for the whole file: markers are resolved here and never
  // reach EE, so the emitted Lua is literal coordinates as it always was.
  const place = placeResolver(project);
  const persist = usesPersistence(project);
  const body = groups.map((g) => renderGroup(catalog, g, mapGlobal, place, sectors, persist)).join("\n");
  const lua = (value: string): string => JSON.stringify(value);
  const sectorTables = !sectors
    ? ""
    : `
-- === Sectors in play (ADR-0056) ===
-- The sector the game is in. Only a Change sector action moves it.
M.sector = ${start === null ? "nil" : lua(start)}
M.sectors = { ${project.map.sectors.map((sec) => `[${lua(sec.id)}] = true`).join(", ")} }
-- group id -> its sector (false = Shared, never unloaded), when it appears, and the objects it holds.
M.group_sector = { ${groups.map((g) => `[${lua(g.id)}] = ${g.sector === null ? "false" : lua(g.sector)}`).join(", ")} }
M.group_when = { ${groups.map((g) => `[${lua(g.id)}] = ${lua(g.when)}`).join(", ")} }
M.group_order = { ${groups.map((g) => lua(g.id)).join(", ")} }
M.group_ids = { ${groups.map((g) => `[${lua(g.id)}] = { ${g.objects.map((o) => lua(o.id)).join(", ")} }`).join(", ")} }
-- Objects that go through every jump: the player ship.
M.keep = { ${groups.flatMap((g) => g.objects).filter((o) => o.type === "PlayerSpaceship").map((o) => `[${lua(o.id)}] = true`).join(", ")} }
-- id -> true for an object removed BECAUSE the game left its sector. Recorded before destroy() is called, so nothing that
-- looks at validity (a predicate, a callback) can mistake the removal for a destruction.
M.unloaded = M.unloaded or {}
`;
  const jumps = usesSectorJumps(project);
  const flavour = findTarget(catalog.eeVersion)?.dialogueRestore ?? "ecs";
  const sectorTrackLine = sectors ? "\n  M.unloaded[id] = nil" : "";
  const rtName = runtimeNames(project.id).rt;
  const sectorGuard = !sectors
    ? ""
    : `  local home = M.group_sector[name]
  if home ~= nil and home ~= false and home ~= M.sector${persist ? " and not (opts ~= nil and opts.force)" : ""} then
    print("[forge] spawn_group " .. tostring(name) .. " refused: it belongs to sector " .. tostring(home) .. " and the game is in " .. tostring(M.sector))
    return {}
  end
`;

  // How the engine says what a temporary object is and who fired it. EE 2024 objects carry `typeName` and `getOwner()`; EE 2026 objects
  // are entities whose components hold the owner (`explode_on_touch.owner` for a missile, `delayed_explode_on_touch.owner` for a
  // mine, `allow_radar_link.owner` for a probe). Read from the live engines (ADR-0057).
  const temporaryOf =
    flavour === "typeName"
      ? `local TEMPORARY_KINDS = { Mine = true, ScanProbe = true, HomingMissile = true, Nuke = true, HVLI = true, EMPMissile = true }
local function temporary_of(o)
  local kind = o.typeName
  if kind == nil or not TEMPORARY_KINDS[kind] then return nil end
  local owner = nil
  if o.getOwner ~= nil then owner = o:getOwner() end
  return kind, owner
end`
      : `local function temporary_of(o)
  local c = o.components
  if c == nil then return nil end
  if c.delayed_explode_on_touch then return "Mine", c.delayed_explode_on_touch.owner end
  if c.explode_on_touch and c.missile_flight then return "Missile", c.explode_on_touch.owner end
  if c.allow_radar_link and c.lifetime and not c.player_control then return "ScanProbe", c.allow_radar_link.owner end
  return nil
end`;
  const temporaryFunctions = !jumps
    ? ""
    : `
-- === The crew's mines, probes and missiles (ADR-0057) ===
-- Not placed by the map, so not in M.objects: they belong to whoever fired them. A jump removes the ones fired by the ship that stays,
-- by a Shared object, or by an object of the sector being left. An object whose owner is not known is NEVER removed.
M.TEMPORARY_PERIOD = 2
M.temporary = {}
M.temporary_next = 0
${temporaryOf}

--- Handles that count as "this sector's side": the kept ship(s), every Shared object and the objects of \`sector\`.
local function sector_owners(sector)
  local owners = {}
  for _, name in ipairs(M.group_order) do
    local home = M.group_sector[name]
    if home == false or home == sector then
      for _, id in ipairs(M.group_ids[name] or {}) do
        local h = M.objects[id]
        if h ~= nil and h:isValid() then owners[#owners + 1] = h end
      end
    end
  end
  for id in pairs(M.keep) do
    local h = M.objects[id]
    if h ~= nil and h:isValid() then owners[#owners + 1] = h end
  end
  return owners
end

--- Record every mine, probe or missile whose owner is one of this sector's side. The registry is what lets a jump still recognise an
--- object whose owner died in the meantime (the engine forgets an owner that no longer exists, so it could not be told apart later).
function M.watch_temporaries()
  local owners = sector_owners(M.sector)
  -- pairs, not ipairs: EE 2024 hands back a list with nil holes where an object is already gone, and ipairs would stop at the first one.
  for _, o in pairs(getAllObjects()) do
    if o ~= nil and o:isValid() then
      local kind, owner = temporary_of(o)
      if kind ~= nil and owner ~= nil then
        for _, h in ipairs(owners) do
          if h == owner then M.temporary[tostring(o)] = o; break end
        end
      end
    end
  end
  for key, h in pairs(M.temporary) do
    if not h:isValid() then M.temporary[key] = nil end
  end
end

--- Called from update(): a scan at most every M.TEMPORARY_PERIOD seconds of scenario time, never every frame.
function M.watch_if_due(now)
  if now < M.temporary_next then return end
  M.temporary_next = now + M.TEMPORARY_PERIOD
  local ok, err = pcall(M.watch_temporaries)
  if not ok then print("[forge] watching mines, probes and missiles failed: " .. tostring(err)) end
end

--- Remove what the registry holds (after one last scan). destroy() is silent: no explosion, no damage (checked live).
function M.sweep_temporaries()
  M.watch_temporaries()
  local removed = 0
  for key, h in pairs(M.temporary) do
    M.temporary[key] = nil
    if h:isValid() then h:destroy(); removed = removed + 1 end
  end
  if removed > 0 then print("[forge] change_sector removed " .. removed .. " mine/probe/missile object(s) of the sector being left") end
  return removed
end
`;

  const sectorFunctions = !sectors
    ? ""
    : `
--- Remove one group's objects because the game left its sector. Each id is recorded in M.unloaded BEFORE destroy() is called;
--- the handle and the group entry are forgotten, so "destroyed" and "wiped out" stay false for what was merely unloaded.
function M.unload_group(name)
  for _, id in ipairs(M.group_ids[name] or {}) do
    local obj = M.objects[id]
    if obj ~= nil and not M.keep[id] then
      M.unloaded[id] = true
      M.objects[id] = nil
      if obj:isValid() then obj:destroy() end
    end
  end
  M.groups[name] = nil
end

--- Leave the current sector for \`dest\`: unload the previous sector's groups (never Shared ones, never the player ship), then create
--- the destination's At-mission-start groups from their initial settings. When a rule spawns it groups keep waiting for their rules.
function M.enter_sector(dest)
  local previous = M.sector${jumps ? `
  -- The crew's mines, probes and missiles belong to the sector being left: they go FIRST, while their owners are still alive and known.
  local swept_ok, swept_err = pcall(M.sweep_temporaries)
  if not swept_ok then print("[forge] change_sector: could not clear the old sector's mines, probes and missiles: " .. tostring(swept_err)) end` : ""}${persist ? `
  -- Campaign saves (ADR-0058). Nothing of the old sector is touched until the destination exists:
  -- (1) the old sector's final state is read (a failure refuses the jump), (2) a checkpoint with it is written while the old sector is still the
  -- active one, (3) the destination is built from its snapshot or its initial settings (a failure removes what was made and refuses the jump),
  -- and only then (4) the old sector is unloaded.
  local P = ${rtName}.persist
  if P.mode == "on" then
    local ok_c, err_c = pcall(P.capture_active)
    if not ok_c then return nil, "the state of the sector being left could not be read: " .. tostring(err_c) end
    P.checkpoint("before the jump")
  end
  local built, built_err = P.build_sector(dest)
  if built == nil then return nil, built_err end` : ""}
  if previous ~= nil then
    for _, name in ipairs(M.group_order) do
      if M.group_sector[name] == previous then M.unload_group(name) end
    end
  end
  M.sector = dest${persist ? `
  ${rtName}.persist.enter_state(dest)
  return built
end` : `
  local created = {}
  for _, name in ipairs(M.group_order) do
    if M.group_sector[name] == dest and M.group_when[name] == "on_start" then
      for _, obj in ipairs(M.spawn_group(name)) do created[#created + 1] = obj end
    end
  end
  return created
end`}
${temporaryFunctions}
`;

  return `${mapGlobal} = ${mapGlobal} or {}
local M = ${mapGlobal}

M.project = ${JSON.stringify(project.id)}
-- id -> handle for every object this map has spawned. Logic and orbit
-- targets resolve through here; entries survive destruction (the handle
-- reports isValid() == false), which is what lets a "destroyed" predicate
-- tell "gone" apart from "never spawned".
M.objects = M.objects or {}
-- group id -> array of handles, refreshed on every spawn of that group.
M.groups = M.groups or {}
${sectorTables}
local function track(created, id, obj)
  M.objects[id] = obj${sectorTrackLine}
  created[#created + 1] = obj
  return obj
end

--- Spawn one named group. Returns the handles it created.
function M.spawn_group(name${persist ? ", opts" : ""})
${sectorGuard}  local created = {}
${body === "" ? "  -- (project declares no groups)" : body}
  M.groups[name] = created${persist ? `
  ${rtName}.persist.appeared[name] = true` : ""}
  return created
end

--- Spawn every group marked on_start, in declaration order.
--- Returns all handles created, so the caller can track them.
function M.spawn()
  local all = {}
  local start_groups = { ${startGroups.map((g) => JSON.stringify(g)).join(", ")} }
  for _, name in ipairs(start_groups) do
    for _, obj in ipairs(M.spawn_group(name)) do
      all[#all + 1] = obj
    end
  end
  return all
end

${sectorFunctions}--- Destroy every object this map spawned and forget the handles.
function M.wipe()
  for id, obj in pairs(M.objects) do
    if obj ~= nil and obj:isValid() then obj:destroy() end
    M.objects[id] = nil
  end
  for name, _ in pairs(M.groups) do M.groups[name] = nil end
end
`;
}
