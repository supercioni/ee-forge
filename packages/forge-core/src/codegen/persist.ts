import type { EEProject } from "@forge/contracts";
import { structuralFingerprint } from "../persistence.js";
import { startSectorOf } from "../sector-runtime.js";
import { findTarget } from "../targets.js";
import type { RuntimeNames } from "./logic.js";

/**
 * The Lua of campaign saves (ADR-0058): per-sector snapshots, frozen sectors, a checkpoint in the engine's ScriptStorage and a resume after a
 * restart. Emitted only for a project that turned `campaign.persistence` on; every other project generates the Lua it always did.
 *
 * It is emitted into the logic file after `beats` and `rules` (it reads their state) and publishes itself as `<rt>.persist`, so the map module's
 * `enter_sector` and the scenario's `init`/`update` reach it by name at run time. Everything is a global table for the same reason the rest of the
 * runtime is (GM callbacks may close over nothing but _ENV).
 */

const SHIP_LIKE = ["CpuShip", "SpaceStation", "PlayerSpaceship"];
const HULL_ONLY = ["WarpJammer"];
const SYSTEMS_AND_STOCK = ["CpuShip", "PlayerSpaceship"];
const MOVES = ["CpuShip", "SpaceStation", "PlayerSpaceship", "Artifact", "SupplyDrop", "WarpJammer"];

const q = (s: string): string => JSON.stringify(s);
const set = (items: readonly string[]): string => `{ ${items.map((i) => `${i} = true`).join(", ")} }`;

export function emitPersistence(project: EEProject, names: RuntimeNames, target: string): string {
  const { rt, state, map } = names;
  const base = project.id.replace(/-/g, "_");
  const start = startSectorOf(project) ?? "";
  const types = project.map.groups
    .flatMap((g) => g.objects.map((o) => `[${q(o.id)}] = ${q(o.type)}`))
    .join(", ");
  // EE 2024 names a crew position by its enum string ("Engineering"); EE 2026 by a lowercase key ("engineering") — read from each engine's own documentation.
  const station = findTarget(target)?.dialogueRestore === "typeName" ? "Engineering" : "engineering";
  return `-- === Campaign persistence (ADR-0058) ===
-- State of every sector and of the campaign, kept in ScriptStorage as one JSON document per checkpoint (two slots, a head pointing at the good one).
-- A sector that is not the active one does not exist in the world: its objects are unloaded and come back from the snapshot, so it is frozen.
local P = {}
${rt}.persist = P
P.VERSION = 1
P.PROJECT = ${q(project.id)}
P.TARGET = ${q(target)}
P.FINGERPRINT = ${q(structuralFingerprint(project))}
P.START = ${q(start)}
P.KEY = ${q(`forge/${project.id}/`)}
P.TYPES = { ${types} }
local SHIP_LIKE = ${set(SHIP_LIKE)}
local HULL_ONLY = ${set(HULL_ONLY)}
local SYSTEMS_AND_STOCK = ${set(SYSTEMS_AND_STOCK)}
local MOVES = ${set(MOVES)}
local SYSTEMS = { "reactor", "beamweapons", "missilesystem", "maneuver", "impulse", "warp", "jumpdrive", "frontshield", "rearshield" }
local STOCK = { "Homing", "Nuke", "Mine", "EMP", "HVLI" }
local unpack = table.unpack or unpack

P.mode = "off"          -- "on" while a campaign is being saved
P.game = nil            -- the game id ("c1", "c2" …)
P.seq = 0               -- checkpoints written for this game
P.slot = nil            -- the slot written last ("a" / "b")
P.clock_base = 0        -- campaign clock = clock_base + scenario time
P.sclock = {}           -- sector -> seconds it was the active one
P.sbeat = {}            -- sector -> index of its next scoped beat
P.dead = {}             -- object id -> true: destroyed, never rebuilt
P.appeared = {}         -- group id -> true: has been spawned at least once
P.orders = {}           -- object id -> the last order a Forge action gave it
P.dialogues = {}        -- object id -> dialogue id (or false) set by a Forge action
P.sectors = {}          -- sector id -> snapshot of a visited sector (not the active one's live state)
P.shared = {}           -- object id -> snapshot of a Shared object / the player ship
P.last_error = nil

-- Our own JSON writer. The engines' toJSON is NOT used: EE 2024's raises "invalid key to 'next'" for any table that holds a nested table with two or more
-- keys (measured, docs/verification/campaign-persistence), and 2024's fromJSON reads integers beyond 32 bits wrongly. Reading uses fromJSON (checked on both).
local function esc(text)
  return (text:gsub('[%c"\\\\]', function(c)
    if c == '"' then return '\\\\"' elseif c == "\\\\" then return "\\\\\\\\" elseif c == "\\n" then return "\\\\n" elseif c == "\\r" then return "\\\\r" elseif c == "\\t" then return "\\\\t" end
    return string.format("\\\\u%04x", c:byte())
  end))
end
local function enc(v, out, depth)
  local t = type(v)
  if depth > 40 then error("a saved value is nested too deeply") end
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then out[#out + 1] = "null"
    elseif v == math.floor(v) and v > -2147483648 and v < 2147483648 then out[#out + 1] = string.format("%d", v)
    else out[#out + 1] = string.format("%.17g", v) end
  elseif t == "boolean" then out[#out + 1] = v and "true" or "false"
  elseif t == "string" then out[#out + 1] = '"' .. esc(v) .. '"'
  elseif t == "table" then
    local n, max, ints = 0, 0, true
    for k in pairs(v) do
      n = n + 1
      if type(k) == "number" and k == math.floor(k) and k > 0 then if k > max then max = k end else ints = false end
    end
    if n > 0 and ints and n == max then
      out[#out + 1] = "["
      for i = 1, n do
        if i > 1 then out[#out + 1] = "," end
        enc(v[i], out, depth + 1)
      end
      out[#out + 1] = "]"
    else
      local keys = {}
      for k in pairs(v) do keys[#keys + 1] = tostring(k) end
      table.sort(keys)
      out[#out + 1] = "{"
      for i, k in ipairs(keys) do
        if i > 1 then out[#out + 1] = "," end
        out[#out + 1] = '"' .. esc(k) .. '":'
        local val = v[k]
        if val == nil then val = v[tonumber(k)] end
        enc(val, out, depth + 1)
      end
      out[#out + 1] = "}"
    end
  else
    error("cannot save a " .. t)
  end
end
function P.encode(v)
  local out = {}
  enc(v, out, 0)
  return table.concat(out)
end

local function try(f, ...)
  local ok, v = pcall(f, ...)
  if ok then return v end
  return nil
end
local function isnum(v) return type(v) == "number" end

function P.now() return P.clock_base + getScenarioTime() end
function P.sector_now() return P.sclock[${map}.sector] or 0 end
function P.advance(delta)
  local s = ${map}.sector
  if s ~= nil and isnum(delta) then P.sclock[s] = (P.sclock[s] or 0) + delta end
end

P.trail = {}            -- the last things the save system said (also kept in ScriptStorage under forge/<project>/messages)
P.trail_ok = true       -- false when the game plays without saving: then nothing at all is written
function P.announce(text)
  print("[forge] " .. text)
  pcall(function() globalMessage(text) end)
  local p = ${rt}.player()
  if p ~= nil then pcall(function() p:addToShipLog(text, "255,255,255") end) end
  -- Every engine shows a message for a moment and forgets it; this is what someone looking at the file (or a support tool) can still read.
  P.trail[#P.trail + 1] = text
  while #P.trail > 8 do table.remove(P.trail, 1) end
  if P.trail_ok then pcall(function() getScriptStorage():set(P.KEY .. "messages", P.encode(P.trail)) end) end
end

-- ----------------------------------------------------------------- objects
--- The supported properties of one live object (everything the engine lets a script read AND write back; see the property matrix).
function P.capture_object(id, o)
  local t = P.TYPES[id]
  local s = {}
  if MOVES[t] then
    local x, y = o:getPosition()
    s.x, s.y, s.r = x, y, try(o.getRotation, o)
  end
  if SHIP_LIKE[t] or HULL_ONLY[t] then
    s.hull, s.hullMax = try(o.getHull, o), try(o.getHullMax, o)
  end
  if SHIP_LIKE[t] then
    local n = try(o.getShieldCount, o)
    if isnum(n) and n > 0 then
      s.sh, s.shm = {}, {}
      for i = 0, n - 1 do
        s.sh[#s.sh + 1] = try(o.getShieldLevel, o, i) or 0
        s.shm[#s.shm + 1] = try(o.getShieldMax, o, i) or 0
      end
    end
  end
  if SYSTEMS_AND_STOCK[t] then
    local e = try(o.getEnergy, o)
    if isnum(e) then s.en = e end
    local sys = {}
    for _, name in ipairs(SYSTEMS) do
      if try(o.hasSystem, o, name) then
        local h = try(o.getSystemHealth, o, name)
        if isnum(h) then
          sys[name] = { h = h, hm = try(o.getSystemHealthMax, o, name), ht = try(o.getSystemHeat, o, name), pw = try(o.getSystemPower, o, name), cl = try(o.getSystemCoolant, o, name) }
        end
      end
    end
    if next(sys) ~= nil then s.sys = sys end
    local stock = {}
    for _, kind in ipairs(STOCK) do
      local n = try(o.getWeaponStorage, o, kind)
      if isnum(n) then stock[kind] = n end
    end
    if next(stock) ~= nil then s.stock = stock end
    local probes = try(o.getScanProbeCount, o)
    if isnum(probes) then s.probes = probes end
    if try(o.hasJumpDrive, o) then s.jump = try(o.getJumpDriveCharge, o) end
  end
  return s
end

--- A crew command (the station's own control) on a ship: a method in EE 2024, a global taking the ship in EE 2026; the method form is tried first. A missing one is skipped.
local function command(o, name, ...)
  local f = o[name]
  if f ~= nil then return pcall(f, o, ...) end
  f = _ENV[name]
  if f ~= nil then return pcall(f, o, ...) end
  return false
end

--- Put the supported properties back. Each one is its own pcall: a property the engine refuses does not stop the others.
function P.restore_object(id, o, s)
  local t = P.TYPES[id]
  if s.hullMax ~= nil then pcall(o.setHullMax, o, s.hullMax) end
  if s.hull ~= nil then pcall(o.setHull, o, s.hull) end
  if s.shm ~= nil then pcall(o.setShieldsMax, o, unpack(s.shm)) end
  if s.sh ~= nil then pcall(o.setShields, o, unpack(s.sh)) end
  if s.sys ~= nil then
    for name, v in pairs(s.sys) do
      if v.hm ~= nil then pcall(o.setSystemHealthMax, o, name, v.hm) end
      if v.h ~= nil then pcall(o.setSystemHealth, o, name, v.h) end
      if v.ht ~= nil then pcall(o.setSystemHeat, o, name, v.ht) end
      if v.pw ~= nil then pcall(o.setSystemPower, o, name, v.pw) end
      if v.cl ~= nil then pcall(o.setSystemCoolant, o, name, v.cl) end
      -- On a player ship the engine snaps the instantaneous value back to the engineer's slider on the next tick (measured: a restored 2.0 came back as 1.0),
      -- so the slider request itself is what is written there.
      if t == "PlayerSpaceship" then
        if v.pw ~= nil then command(o, "commandSetSystemPowerRequest", name, v.pw) end
        if v.cl ~= nil then command(o, "commandSetSystemCoolantRequest", name, v.cl) end
      end
    end
  end
  if s.en ~= nil then
    if o.setEnergyLevel ~= nil then pcall(o.setEnergyLevel, o, s.en) else pcall(o.setEnergy, o, s.en) end
  end
  if s.stock ~= nil then
    for kind, n in pairs(s.stock) do pcall(o.setWeaponStorage, o, kind, n) end
  end
  if s.probes ~= nil then pcall(o.setScanProbeCount, o, s.probes) end
  if s.jump ~= nil then pcall(o.setJumpDriveCharge, o, s.jump) end
  if s.x ~= nil and s.y ~= nil then
    pcall(o.setPosition, o, s.x, s.y)
    if s.r ~= nil then
      pcall(o.setRotation, o, s.r)
      if t == "PlayerSpaceship" and o.commandTargetRotation ~= nil then pcall(o.commandTargetRotation, o, s.r) end
    end
  end
end

--- Read the objects of the groups matching \`wanted(sector)\` into \`into\`; mark as destroyed what is gone without having been unloaded.
local function capture_groups(wanted, into)
  for _, name in ipairs(${map}.group_order) do
    if wanted(${map}.group_sector[name]) then
      for _, id in ipairs(${map}.group_ids[name] or {}) do
        local o = ${map}.objects[id]
        if o ~= nil then
          if o:isValid() then
            into[id] = P.capture_object(id, o)
          elseif not ${map}.unloaded[id] then
            P.dead[id] = true
            into[id] = nil
          end
        end
      end
    end
  end
end

function P.capture_shared()
  local into = {}
  capture_groups(function(home) return home == false end, into)
  for id in pairs(${map}.keep) do
    local o = ${map}.objects[id]
    if o ~= nil then
      if o:isValid() then into[id] = P.capture_object(id, o) elseif not ${map}.unloaded[id] then P.dead[id] = true end
    end
  end
  P.shared = into
end

local function capture_rules(sector)
  local out = {}
  for _, r in ipairs(rules) do
    if r.sector == sector then out[r.id] = { f = r.fired, w = r.was_true } end
  end
  return out
end

local function restore_rules(sector, saved)
  for _, r in ipairs(rules) do
    if r.sector == sector then
      local v = saved ~= nil and saved[r.id] or nil
      r.fired = v ~= nil and v.f == true or false
      r.was_true = v ~= nil and v.w == true or false
    end
  end
end

--- Snapshot of one sector as it is NOW (objects, scoped rules, its clock and beat cursor).
function P.capture_sector(sector)
  local objects = {}
  capture_groups(function(home) return home == sector end, objects)
  return { clock = P.sclock[sector] or 0, beat = P.sbeat[sector] or 1, rules = capture_rules(sector), objects = objects }
end

--- Everything that must be true before the active sector is left: its snapshot, the Shared objects, the destroyed set.
function P.capture_active()
  local sec = ${map}.sector
  P.capture_shared()
  P.sectors[sec] = P.capture_sector(sec)
end

-- ------------------------------------------------------------ the document
function P.document()
  P.capture_active()
  local sec = ${map}.sector
  return {
    v = P.VERSION, project = P.PROJECT, target = P.TARGET, fingerprint = P.FINGERPRINT, game = P.game, seq = P.seq, sector = sec,
    clock = P.now(), vars = ${state}.vars, ovars = ${state}.obj_vars, dead = P.dead, appeared = P.appeared, orders = P.orders, dialogues = P.dialogues,
    grules = capture_rules(nil), gbeat = ${state}.beat_idx, shared = P.shared, sectors = P.sectors,
  }
end

local function read_key(key)
  local v = getScriptStorage():get(key)
  if v == nil or v == "" then return nil end
  return v
end

--- Why a decoded document cannot be used: "damaged" (not a readable save of this project's format) or "incompatible" (readable, but made for another
--- format, project, build or structure). Returns nil when it can be used. The two are kept apart on purpose: they call for different things from the crew.
function P.validate(doc, game, seq)
  if type(doc) ~= "table" then return "damaged", "it is not a saved campaign" end
  if doc.v ~= P.VERSION then return "incompatible", "it was written by another format version (" .. tostring(doc.v) .. ", this scenario reads " .. P.VERSION .. ")" end
  if doc.project ~= P.PROJECT then return "incompatible", "it belongs to another project (" .. tostring(doc.project) .. ")" end
  if doc.target ~= P.TARGET then return "incompatible", "it was made for another EmptyEpsilon build (" .. tostring(doc.target) .. ")" end
  if doc.fingerprint ~= P.FINGERPRINT then return "incompatible", "the project has changed structurally since it was saved (sectors, groups, objects, rules, beats or variables were added, removed or re-filed)" end
  if doc.game ~= game then return "damaged", "it is filed under a different game" end
  if seq ~= nil and doc.seq ~= seq then return "damaged", "its checkpoint number does not match its head" end
  if type(doc.sector) ~= "string" or not ${map}.sectors[doc.sector] then return "damaged", "it names a sector this project does not have" end
  if type(doc.vars) ~= "table" or type(doc.sectors) ~= "table" or type(doc.shared) ~= "table" then return "damaged", "it is missing parts" end
  return nil
end

--- Read one game. Recovery policy, in this order: (1) the slot the head points at; (2) the other slot, an OLDER checkpoint; (3) when the head itself
--- cannot be read, the valid slot with the higher checkpoint number. Returns the document (with ._slot, ._fallback = how it was recovered, ._newest = the
--- checkpoint number that was lost), or nil, kind ("damaged" / "incompatible") and a reason.
function P.read_game(game)
  local function slot_doc(slot, seq)
    local text = read_key(P.KEY .. game .. "/" .. slot)
    if text == nil then return nil, "empty", "slot " .. slot .. " is empty" end
    local ok, doc = pcall(fromJSON, text)
    if not ok then return nil, "damaged", "slot " .. slot .. ": its text is not valid JSON" end
    local kind, why = P.validate(doc, game, seq)
    if kind ~= nil then return nil, kind, "slot " .. slot .. ": " .. why end
    doc._slot = slot
    return doc
  end
  local headText = read_key(P.KEY .. game .. "/head")
  local okh, head = false, nil
  if headText ~= nil then okh, head = pcall(fromJSON, headText) end
  local reasons = {}
  local first = nil
  local function note(kind, why)
    reasons[#reasons + 1] = why
    if first == nil and kind ~= "empty" then first = kind end
  end
  if okh and type(head) == "table" and (head.slot == "a" or head.slot == "b") and isnum(head.seq) then
    local doc, kind, why = slot_doc(head.slot, head.seq)
    if doc ~= nil then return doc end
    note(kind, why)
    local other = head.slot == "a" and "b" or "a"
    local older, okind, owhy = slot_doc(other, nil)
    if older ~= nil and older.seq < head.seq then
      older._fallback, older._newest = true, head.seq
      return older
    end
    note(okind or "damaged", owhy or ("slot " .. other .. " is not older than the head"))
  else
    note("damaged", headText == nil and ("game " .. game .. " has no head") or ("the head of game " .. game .. " is unreadable"))
    local best = nil
    for _, slot in ipairs({ "a", "b" }) do
      local doc, kind, why = slot_doc(slot, nil)
      if doc ~= nil then
        if best == nil or doc.seq > best.seq then best = doc end
      else
        note(kind, why)
      end
    end
    if best ~= nil then
      best._fallback, best._newest = "head", nil
      return best
    end
  end
  -- the kind is that of the newest checkpoint that could not be used (an empty slot says nothing about damage)
  local kind = first or "damaged"
  return nil, kind, table.concat(reasons, "; ")
end

local function read_index()
  local text = read_key(P.KEY .. "index")
  if text == nil then return { next = 1, games = {}, last = nil } end
  local ok, index = pcall(fromJSON, text)
  if not ok or type(index) ~= "table" or type(index.games) ~= "table" then return nil, "the list of saved campaigns is unreadable" end
  return index
end

local function write_index(index)
  getScriptStorage():set(P.KEY .. "index", P.encode(index))
end

--- Write one checkpoint: the inactive slot first, then the head. Returns true when the Lua side completed (the engine reports nothing about the disk).
function P.checkpoint(reason)
  if P.mode ~= "on" or P.game == nil then return false end
  local ok, err = pcall(function()
    local doc = P.document()
    P.seq = P.seq + 1
    doc.seq = P.seq
    local slot = (P.slot == "a") and "b" or "a"
    local text = P.encode(doc)
    local st = getScriptStorage()
    st:set(P.KEY .. P.game .. "/" .. slot, text)
    st:set(P.KEY .. P.game .. "/head", P.encode({ slot = slot, seq = P.seq, sector = doc.sector, clock = doc.clock, bytes = #text }))
    P.slot = slot
    local index = read_index() or { next = 1, games = {} }
    index.last = P.game
    write_index(index)
    P.last_bytes = #text
  end)
  if not ok then
    P.last_error = tostring(err)
    print("[forge] checkpoint (" .. tostring(reason) .. ") failed: " .. tostring(err))
    return false
  end
  return true
end

function P.manual_save()
  if P.mode ~= "on" then P.announce("Saving is off for this game (the scenario was started with Campaign = Do not save).") return end
  if P.checkpoint("manual") then
    -- Only what the script can observe: the checkpoint was prepared and handed to ScriptStorage. The engine does not report whether the file was written.
    P.announce("Checkpoint " .. P.seq .. " sent to the save file (campaign " .. tostring(P.game) .. ", sector " .. tostring(${map}.sector) .. "). The game cannot confirm it reached the disk.")
  else
    P.announce("The checkpoint could not be prepared: " .. tostring(P.last_error) .. ". The previous checkpoint is still the latest one.")
  end
end

-- --------------------------------------------------- building a sector
local function forget_group_objects(name)
  for _, id in ipairs(${map}.group_ids[name] or {}) do
    local o = ${map}.objects[id]
    if o ~= nil and not ${map}.keep[id] then
      ${map}.objects[id] = nil
      if o:isValid() then pcall(o.destroy, o) end
    end
  end
  ${map}.groups[name] = nil
end

--- Make the objects of \`dest\` exist: from the snapshot when the sector was visited, from the initial settings when it was not. All or nothing:
--- a failure removes what was made and leaves everything else as it was. Returns the handles made, or nil and the reason.
function P.build_sector(dest)
  local snap = P.sectors[dest]
  local created, attempted, was_appeared = {}, {}, {}
  local ok, err = pcall(function()
    for _, name in ipairs(${map}.group_order) do
      if ${map}.group_sector[name] == dest then
        local make = false
        if snap == nil then make = ${map}.group_when[name] == "on_start" else make = P.appeared[name] == true end
        if make then
          attempted[#attempted + 1] = name
          was_appeared[name] = P.appeared[name]
          for _, o in ipairs(${map}.spawn_group(name, { force = true, skip = P.dead })) do created[#created + 1] = o end
        end
      end
    end
    if snap ~= nil then
      for id, s in pairs(snap.objects) do
        local o = ${map}.objects[id]
        if o ~= nil then P.restore_object(id, o, s) end
      end
    end
  end)
  if not ok then
    for _, name in ipairs(attempted) do
      forget_group_objects(name)
      P.appeared[name] = was_appeared[name]
    end
    P.last_error = tostring(err)
    return nil, tostring(err)
  end
  return created
end

--- The time and rule state of the sector just entered: from its snapshot, or fresh on a first visit.
function P.enter_state(dest)
  local snap = P.sectors[dest]
  P.sclock[dest] = snap ~= nil and snap.clock or 0
  P.sbeat[dest] = snap ~= nil and snap.beat or 1
  restore_rules(dest, snap ~= nil and snap.rules or nil)
end

--- Orders and dialogues a Forge action gave, put back once everything they refer to exists.
function P.relink(ids)
  for _, id in ipairs(ids) do
    local o = ${map}.objects[id]
    local spec = P.orders[id]
    if o ~= nil and o:isValid() and spec ~= nil then
      local ok = pcall(function()
        local m = spec.m
        local function target()
          local t = ${map}.objects[spec.id]
          if t == nil or not t:isValid() then error("target " .. tostring(spec.id) .. " no longer exists") end
          return t
        end
        if m == "orderIdle" then o:orderIdle()
        elseif m == "orderRoaming" then o:orderRoaming()
        elseif m == "orderStandGround" then o:orderStandGround()
        elseif m == "orderRoamingAt" then o:orderRoamingAt(spec.x, spec.y)
        elseif m == "orderDefendLocation" then o:orderDefendLocation(spec.x, spec.y)
        elseif m == "orderFlyTowards" then o:orderFlyTowards(spec.x, spec.y)
        elseif m == "orderFlyTowardsBlind" then o:orderFlyTowardsBlind(spec.x, spec.y)
        elseif m == "orderRetreat" then o:orderRetreat(target())
        elseif m == "orderDefendTarget" then o:orderDefendTarget(target())
        elseif m == "orderAttack" then o:orderAttack(target())
        elseif m == "orderDock" then o:orderDock(target())
        elseif m == "orderFlyFormation" then o:orderFlyFormation(target(), spec.ox, spec.oy)
        end
      end)
      if not ok then
        print("[forge] resume: the order " .. tostring(spec.m) .. " of " .. id .. " points at something that no longer exists; it holds position instead")
        pcall(o.orderIdle, o)
      end
    end
    local d = P.dialogues[id]
    if o ~= nil and o:isValid() and d ~= nil then
      if d == false then ${rt}.set_dialogue({ o }, nil) else ${rt}.set_dialogue({ o }, d) end
    end
  end
end

function P.ids_of(sector)
  local ids = {}
  for _, name in ipairs(${map}.group_order) do
    if ${map}.group_sector[name] == sector then
      for _, id in ipairs(${map}.group_ids[name] or {}) do ids[#ids + 1] = id end
    end
  end
  return ids
end

--- A Forge order action ran: remember it by ids (never by handle).
function P.note_order(ids, spec)
  for _, id in ipairs(ids) do P.orders[id] = spec end
end
function P.note_dialogue(ids, dialogue)
  for _, id in ipairs(ids) do P.dialogues[id] = dialogue == nil and false or dialogue end
end

-- ------------------------------------------------------------ start / resume
local function setting()
  local v = nil
  pcall(function() v = getScenarioSetting("Campaign") end)
  if v == nil or v == "" then v = "Resume" end
  return v
end

local function register_game(index)
  local n = index.next or 1
  local id = string.format("c%d", n)
  index.next = n + 1
  index.games[#index.games + 1] = id
  index.last = id
  return id
end

--- Find the game to resume: the latest one. Returns the document, or nil and a status: { kind = "none" } when there is nothing to resume (a first start),
--- else { kind = "damaged" | "incompatible" | "index", game, why }.
function P.find_latest()
  local index, why = read_index()
  if index == nil then return nil, { kind = "index", why = why } end
  if index.last == nil then return nil, { kind = "none" } end
  local doc, kind, reason = P.read_game(index.last)
  if doc == nil then return nil, { kind = kind, game = index.last, why = reason } end
  return doc
end

function P.resume(doc)
  P.mode = "on"
  P.game, P.seq = doc.game, doc.seq
  P.slot = doc._slot
  P.clock_base = (doc.clock or 0) - getScenarioTime()
  ${state}.vars, ${state}.obj_vars = doc.vars, doc.ovars or {}
  P.dead, P.appeared, P.orders, P.dialogues = doc.dead or {}, doc.appeared or {}, doc.orders or {}, doc.dialogues or {}
  P.sectors, P.shared = doc.sectors, doc.shared
  ${state}.beat_idx = doc.gbeat or 1
  ${map}.sector = doc.sector
  restore_rules(nil, doc.grules)
  -- Shared objects and the player ship: from the project, then the saved state.
  for _, name in ipairs(${map}.group_order) do
    if ${map}.group_sector[name] == false and ${map}.group_when[name] == "on_start" then
      ${map}.spawn_group(name, { force = true, skip = P.dead })
    end
  end
  for id, s in pairs(P.shared) do
    local o = ${map}.objects[id]
    if o ~= nil then P.restore_object(id, o, s) end
  end
  local built, err = P.build_sector(doc.sector)
  if built == nil then error("could not rebuild sector " .. doc.sector .. ": " .. tostring(err)) end
  P.enter_state(doc.sector)
end

--- A new saved campaign beside whatever exists. Used for a first start, for Campaign = New and for the explicit choice after a blocked resume.
function P.start_new(prefix)
  local index, ireason = read_index()
  if index == nil then
    -- The list of campaigns is unreadable: a new game would write over it. Play without saving instead.
    P.mode = "off"
    P.trail_ok = false
    ${map}.spawn()
    P.after_boot()
    P.announce("Campaign saves are OFF for this game: " .. tostring(ireason) .. ". Nothing was written.")
    return
  end
  P.mode = "on"
  P.game = register_game(index)
  write_index(index)
  P.clock_base = -getScenarioTime()
  ${map}.sector = P.START
  ${map}.spawn()
  P.enter_state(P.START)
  P.after_boot()
  P.checkpoint("new campaign")
  P.announce((prefix or "") .. "New campaign " .. P.game .. " started in sector " .. tostring(${map}.sector) .. "; checkpoint 1 sent to the save file.")
end

-- A resume that cannot happen stops the campaign BEFORE anything is built: no object, no player ship, no rule or timer runs, nothing is written to the
-- saves. The crew is told what is wrong and how to go on; a new campaign (beside the old one, which is never touched) is an explicit choice.
local KIND_TEXT = {
  damaged = "is damaged and cannot be read",
  incompatible = "was made by a different version or structure of this scenario",
  rebuild = "was read, but could not be rebuilt",
  index = "cannot be found: the list of saved campaigns is unreadable",
}
-- The engines show a global message only on a crew station, never on the ship-selection screen (measured in a real window: it showed "Waiting for server to
-- spawn a ship" and nothing else). So a blocked game holds ONE stock ship, named NO CAMPAIGN, that belongs to no sector and no campaign: the crew can select it,
-- read the message on its station and in its log, and choose from its Engineering station. Nothing else exists, and nothing runs.
function P.make_holding()
  local ok, ship = pcall(function()
    return PlayerSpaceship():setTemplate("MP52 Hornet"):setFaction("Human Navy"):setCallSign("NO CAMPAIGN"):setPosition(0, 0)
  end)
  if not ok or ship == nil then return end
  P.holding = ship
  if ship.addCustomButton ~= nil then
    if P.blocked ~= nil and P.blocked.kind ~= "index" then
      pcall(function() ship:addCustomButton(${q(station)}, "forge_new_campaign", "Start a NEW campaign", ${base}_persist_new) end)
    end
    pcall(function() ship:addCustomButton(${q(station)}, "forge_play_unsaved", "Play without saving", ${base}_persist_off) end)
  end
end
function P.drop_holding()
  local h = P.holding
  P.holding = nil
  if h ~= nil then pcall(function() if h:isValid() then h:destroy() end end) end
end

function P.block(status)
  P.mode = "blocked"
  P.blocked = status
  P.blocked_for = 10      -- the first reminder comes 10 s after the start, then every 20 s: a crew that has just reached a station sees it soon
  P.pending = nil
  P.trail_ok = status.kind ~= "index"
  local what = status.kind == "index" and "The saved campaigns " .. KIND_TEXT.index or ("The saved campaign " .. tostring(status.game) .. " " .. (KIND_TEXT[status.kind] or "cannot be resumed"))
  P.blocked_text = "CAMPAIGN NOT RESUMED. " .. what .. ". Nothing is running and nothing was changed. "
    .. (status.kind == "index"
      and "To go on: end this game and fix or move the save file, or press 'Play without saving' (Engineering station of the ship NO CAMPAIGN, or the GM)."
      or "To start a new campaign: press 'Start a NEW campaign' (Engineering station of the ship NO CAMPAIGN, or the GM), or end this game, choose this scenario again, set Campaign = New and start. The old save is kept.")
  -- A station shows a message as a banner one line high at the top of the screen and clips what does not fit (measured in a real window: a four-line message showed only its last line),
  -- so the reminder is ONE short line; the long text above goes to the log, the GM and the file.
  P.blocked_short = status.kind == "index"
    and "CAMPAIGN NOT RESUMED: the list of saved campaigns is unreadable. Nothing runs. Engineering: 'Play without saving'."
    or ("CAMPAIGN NOT RESUMED: saved campaign " .. tostring(status.game) .. " " .. (status.kind == "damaged" and "is damaged" or status.kind == "incompatible" and "is from another version of this scenario" or "could not be rebuilt") .. ". Nothing runs. Engineering: 'Start a NEW campaign'.")
  print("[forge] resume blocked (" .. tostring(status.kind) .. "): " .. tostring(status.why))
  -- A paused game does not run update(): the reminders and the choice below would never be carried out. Nothing else runs in this mode, so there is nothing to protect by pausing.
  pcall(unpauseGame)
  P.make_holding()
  P.announce(P.blocked_text)
  P.announce("Details: " .. tostring(status.why))
  pcall(function() addGMMessage(P.blocked_text) end)
  pcall(function() addGMFunction("Play without saving", ${base}_persist_off) end)
  if status.kind ~= "index" then pcall(function() addGMFunction("Start a NEW campaign", ${base}_persist_new) end) end
end

local function after_choice()
  ${rt}.install_dialogues()
  P.relink_all()
  ${rt}.install_gm_buttons()
end
local function choose_new()
  P.blocked = nil
  P.start_new("Old save kept. NO CAMPAIGN station: press Return, choose the new ship. ")
  after_choice()
end
local function choose_off()
  P.blocked = nil
  P.mode = "off"
  P.trail_ok = false
  P.clock_base = -getScenarioTime()
  ${map}.spawn()
  P.after_boot()
  after_choice()
  P.announce("Playing WITHOUT saving; saved campaigns untouched. NO CAMPAIGN station: press Return, choose the new ship.")
end

--- Called every update: while the resume is blocked, nothing else runs (returns true) and the message is repeated. A choice (a button on the holding ship or
--- the GM console) is only noted by the button and carried out here, so the ship whose button was pressed is not removed from inside its own callback.
function P.blocked_tick(delta)
  if P.mode ~= "blocked" then return false end
  if P.pending ~= nil then
    local what = P.pending
    P.pending = nil
    P.drop_holding()
    if what == "new" then choose_new() else choose_off() end
    return true
  end
  P.blocked_for = P.blocked_for + (isnum(delta) and delta or 0)
  if P.blocked_for >= 20 then
    P.blocked_for = 0
    pcall(function() globalMessage(P.blocked_short) end)
    -- measured in a real window: a crew sees a message as the banner at the top of a station; the ship's log keeps it
    local p = ${rt}.player()
    if p ~= nil then pcall(function() p:addToShipLog(P.blocked_short, "255,255,255") end) end
  end
  return true
end

function ${base}_persist_new()
  local P = ${rt}.persist
  if P.mode ~= "blocked" or P.blocked == nil or P.blocked.kind == "index" then P.announce("A new campaign cannot be started from here.") return end
  P.pending = "new"
end
function ${base}_persist_off()
  local P = ${rt}.persist
  if P.mode ~= "blocked" then P.announce("Nothing to change: the game is already running.") return end
  P.pending = "off"
end

--- Called from init() instead of the map's spawn().
function P.boot()
  local want = setting()
  if want == "Off" then
    P.mode = "off"
    P.trail_ok = false
    ${map}.spawn()
    P.after_boot()
    print("[forge] campaign saves are off for this game (Campaign = Do not save)")
    return
  end
  local doc, status = nil, nil
  if want == "Resume" then doc, status = P.find_latest() end
  if doc ~= nil then
    local ok, err = pcall(P.resume, doc)
    if ok then
      P.after_boot()
      -- one line each: a station clips a banner to its last line (measured), so nothing important is at the start of a long text
      if doc._fallback == "head" then
        P.announce("Campaign " .. tostring(P.game) .. " resumed from checkpoint " .. tostring(P.seq) .. ": the pointer to the newest checkpoint was unreadable; the newest readable one was recovered.")
      elseif doc._fallback then
        P.announce("Campaign " .. tostring(P.game) .. " resumed from checkpoint " .. tostring(P.seq) .. ": the newest one (" .. tostring(doc._newest) .. ") could not be used, the one before it was recovered. Progress after checkpoint " .. tostring(P.seq) .. " is lost.")
      else
        P.announce("Campaign " .. tostring(P.game) .. " resumed from checkpoint " .. tostring(P.seq) .. ", sector " .. tostring(${map}.sector) .. ".")
      end
      return
    end
    -- A resume that failed half way is not left running: whatever it made is removed and the campaign is blocked, not replaced.
    pcall(${map}.wipe)
    ${map}.unloaded, ${map}.groups = {}, {}
    status = { kind = "rebuild", game = doc.game, why = tostring(err) }
    P.dead, P.appeared, P.orders, P.dialogues, P.sectors, P.shared = {}, {}, {}, {}, {}, {}
    P.clock_base = 0
  end
  if status ~= nil and status.kind ~= "none" then
    P.block(status)
    return
  end
  P.start_new(status ~= nil and "No saved campaign yet: this is a first start. " or nil)
end

function P.after_boot()
  P.install_ui()
end

function P.relink_all()
  local ids = {}
  for id in pairs(${map}.objects) do ids[#ids + 1] = id end
  P.relink(ids)
end

-- Buttons: a custom button on the player ship's Engineering station and a GM button. Both call a global (their only upvalue is _ENV).
function ${base}_persist_save() ${rt}.persist.manual_save() end
function P.install_ui()
  local p = ${rt}.player()
  if p ~= nil and p.addCustomButton ~= nil then
    pcall(function() p:addCustomButton(${q(station)}, "forge_save_checkpoint", "Save checkpoint", ${base}_persist_save) end)
  end
  pcall(function() addGMFunction("Save checkpoint", ${base}_persist_save) end)
end
`;
}
