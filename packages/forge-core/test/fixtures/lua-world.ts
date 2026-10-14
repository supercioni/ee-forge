import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EEProject } from "@forge/contracts";
import { loadCatalog } from "../../src/catalog/load.js";
import { buildProject } from "../../src/codegen/build.js";

/**
 * Runs the GENERATED Lua of a project against a mock world (Lua 5.4 through the system's liblua).
 *
 * The mock is only as faithful as it is small: objects are tables with `isValid`/`destroy`/`setPosition`…, anything else is a
 * chainable no-op. It never contacts EmptyEpsilon — a clean run here proves the generated code does what the model says, and
 * says NOTHING about the engine (that is what the isolated-clone runs are for).
 */
const here = dirname(fileURLToPath(import.meta.url));

export const luaAvailable = spawnSync("python3", [join(here, "run-lua.py"), "/dev/null"]).status !== 2;

const MOCK = String.raw`
local W = { time = 0, objs = {}, players = {}, messages = {}, victory = {}, destroyed = {} }
__W = W
local M = {}
M.__index = function(t, k)
  local m = rawget(M, k)
  if m ~= nil then return m end
  if type(k) == "string" and k:sub(1, 1) == "_" then return nil end -- a private field that is not set is just nil
  return function(self) return self end
end
function M.addCustomButton(self, station, id, caption, fn) W.buttons = W.buttons or {} W.buttons[#W.buttons + 1] = tostring(station) .. "~" .. tostring(caption) return self end
function M.setPosition(self, x, y) self._x, self._y = x, y; return self end
function M.getPosition(self) return self._x, self._y end
function M.setRotation(self, r) self._rot = r; return self end
function M.getRotation(self) return self._rot end
function M.isValid(self) return self._valid end
function M.destroy(self) self._valid = false; W.destroyed[#W.destroyed + 1] = self._cls; return self end
function M.setHull(self, h) self._hull = h; return self end
function M.getHull(self) return self._hull end
function M.getHullMax(self) return self._hullMax or 100 end
function M.setHullMax(self, v) self._hullMax = v; return self end
function M.getShieldCount(self) if self._sh ~= nil then return #self._sh end return nil end
function M.getShieldLevel(self, i) return self._sh and self._sh[i + 1] end
function M.getShieldMax(self, i) return self._shm and self._shm[i + 1] end
function M.setShields(self, ...) local a = { ... } for i, v in ipairs(a) do if self._sh ~= nil and self._sh[i] ~= nil then self._sh[i] = v end end return self end
function M.setShieldsMax(self, ...) local a = { ... } for i, v in ipairs(a) do if self._shm ~= nil and self._shm[i] ~= nil then self._shm[i] = v end end return self end
function M.hasSystem(self, name) return self._sys ~= nil and self._sys[name] ~= nil end
function M.getSystemHealth(self, name) if self._sys ~= nil then return self._sys[name] and self._sys[name].h or 0 end return 1 end
function M.setSystemHealth(self, name, v) if self._sys ~= nil and self._sys[name] ~= nil then self._sys[name].h = v end return self end
function M.getSystemHealthMax(self, name) return self._sys and self._sys[name] and self._sys[name].hm or nil end
function M.setSystemHealthMax(self, name, v) if self._sys ~= nil and self._sys[name] ~= nil then self._sys[name].hm = v end return self end
function M.getSystemHeat(self, name) return self._sys and self._sys[name] and self._sys[name].ht or nil end
function M.setSystemHeat(self, name, v) if self._sys ~= nil and self._sys[name] ~= nil then self._sys[name].ht = v end return self end
-- A player ship reads back the engineer's slider REQUEST (the engine snaps the instantaneous value to it), so only a command makes a change stick.
function M.getSystemPower(self, name) local s = self._sys and self._sys[name] if s == nil then return nil end if self._cls == "PlayerSpaceship" then return s.pwreq or 1 end return s.pw end
function M.commandSetSystemPowerRequest(self, name, v) if self._sys ~= nil and self._sys[name] ~= nil then self._sys[name].pwreq = v end return self end
function M.commandSetSystemCoolantRequest(self, name, v) if self._sys ~= nil and self._sys[name] ~= nil then self._sys[name].clreq = v end return self end
function M.setSystemPower(self, name, v) if self._sys ~= nil and self._sys[name] ~= nil then self._sys[name].pw = v end return self end
function M.getSystemCoolant(self, name) local s = self._sys and self._sys[name] if s == nil then return nil end if self._cls == "PlayerSpaceship" then return s.clreq or 0 end return s.cl end
function M.setSystemCoolant(self, name, v) if self._sys ~= nil and self._sys[name] ~= nil then self._sys[name].cl = v end return self end
function M.getEnergy(self) return self._en end
function M.setEnergyLevel(self, v) self._en = v; return self end
function M.getWeaponStorage(self, kind) return self._stock and self._stock[kind] end
function M.setWeaponStorage(self, kind, n) if self._stock ~= nil then self._stock[kind] = n end return self end
function M.getScanProbeCount(self) return self._probes end
function M.setScanProbeCount(self, n) if self._probes ~= nil then self._probes = n end return self end
function M.hasJumpDrive(self) return false end
function M.orderIdle(self) W.idle = (W.idle or 0) + 1; return self end
function M.orderAttack(self, target) self._attack = target; W.attacks = (W.attacks or 0) + 1; return self end
function M.getOwner(self) return self._owner end
local function ctor(cls)
  return function()
    local o = setmetatable({ _cls = cls, _valid = true, _x = 0, _y = 0, _rot = 0, _hull = 100, typeName = (not __ECS) and cls or nil, components = __ECS and {} or nil }, M)
    if cls == "CpuShip" or cls == "PlayerSpaceship" or cls == "SpaceStation" then
      o._sh, o._shm = { 200, 200 }, { 200, 200 }
    end
    if cls == "CpuShip" or cls == "PlayerSpaceship" then
      o._en = 1000
      o._sys = { reactor = { h = 1, hm = 1, ht = 0, pw = 1, cl = 0 }, impulse = { h = 1, hm = 1, ht = 0, pw = 1, cl = 0 } }
      o._stock = { Homing = 8, Nuke = 2, Mine = 4, EMP = 2, HVLI = 6 }
    end
    if cls == "PlayerSpaceship" then o._probes = 8 end
    W.objs[#W.objs + 1] = o
    if cls == "PlayerSpaceship" then W.players[#W.players + 1] = o end
    return o
  end
end
for _, cls in ipairs({ "Asteroid", "VisualAsteroid", "CpuShip", "PlayerSpaceship", "SpaceStation", "Planet", "Nebula", "Mine", "BlackHole", "WormHole", "Artifact", "SupplyDrop", "ScanProbe", "WarpJammer", "Zone" }) do _G[cls] = ctor(cls) end
function getAllObjects() local r = {} for _, o in ipairs(W.objs) do if o._valid then r[#r + 1] = o end end return r end
-- A mine / probe / missile fired by owner (a handle or nil), in the shape each engine exposes: typeName + getOwner() (2024), components (2026).
function W.temp(kind, owner, x, y)
  local o = setmetatable({ _cls = kind, _valid = true, _x = x or 0, _y = y or 0, _rot = 0, _hull = 1, _owner = owner }, M)
  if __ECS then
    o.components = {}
    if kind == "Mine" then o.components.delayed_explode_on_touch = { owner = owner }
    elseif kind == "ScanProbe" then o.components.allow_radar_link = { owner = owner }; o.components.lifetime = { lifetime = 600 }
    else o.components.explode_on_touch = { owner = owner }; o.components.missile_flight = {} end
  else
    o.typeName = kind
  end
  W.objs[#W.objs + 1] = o
  return o
end
-- ScriptStorage: strings only for the key/value pair as in EE 2024; a missing key is "" (2024) or nil (2026).
local STORE = __STORAGE_IN or {}
local ST = {}
function ST.get(self, k) local v = STORE[k] if v == nil and not __ECS then return "" end return v end
function ST.set(self, k, v) if type(v) ~= "string" then error("bad argument #2 to 'set' (string expected, got " .. type(v) .. ")") end STORE[k] = v return self end
function getScriptStorage() return ST end
__STORE = STORE
function getScenarioSetting(name) return (__SETTINGS or {})[name] end
-- JSON as the engines have it (toJSON / fromJSON), minimal but real.
local function jenc(v, out)
  local t = type(v)
  if t == "nil" then out[#out + 1] = "null"
  elseif t == "boolean" then out[#out + 1] = tostring(v)
  elseif t == "number" then out[#out + 1] = (math.type(v) == "integer") and string.format("%d", v) or string.format("%.17g", v)
  elseif t == "string" then
    out[#out + 1] = '"' .. v:gsub('[%c"\\]', function(c)
      local m = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
      return m[c] or string.format('\\u%04x', c:byte())
    end) .. '"'
  elseif t == "table" then
    local n, max = 0, 0
    for k in pairs(v) do n = n + 1; if type(k) == "number" and k > max then max = k end end
    if n == max then
      out[#out + 1] = "["
      for i = 1, n do if i > 1 then out[#out + 1] = "," end jenc(v[i], out) end
      out[#out + 1] = "]"
    else
      local keys = {}
      for k in pairs(v) do keys[#keys + 1] = tostring(k) end
      table.sort(keys)
      out[#out + 1] = "{"
      for i, k in ipairs(keys) do
        if i > 1 then out[#out + 1] = "," end
        jenc(k, out); out[#out + 1] = ":"
        local val = v[k]; if val == nil then val = v[tonumber(k)] end
        jenc(val, out)
      end
      out[#out + 1] = "}"
    end
  else error("cannot encode " .. t) end
end
-- EE 2024's toJSON raises "invalid key to 'next'" for a table that holds a nested table with two or more keys (measured live). Mirrored here so that
-- generated code can never lean on it: the campaign saves write their own JSON.
local function check2024(v, depth)
  if type(v) ~= "table" then return end
  local n = 0
  for _ in pairs(v) do n = n + 1 end
  if depth > 0 and n > 1 and #v ~= n then error("invalid key to 'next'") end
  for _, x in pairs(v) do check2024(x, depth + 1) end
end
function toJSON(v)
  if not __ECS then check2024(v, 0) end
  local out = {} jenc(v, out) return table.concat(out)
end
function fromJSON(text)
  local i = 1
  local function ws() i = text:find("%S", i) or #text + 1 end
  local val
  local function str()
    local j, out = i + 1, {}
    while true do
      local c = text:sub(j, j)
      if c == "" then error("[json.exception.parse_error.101] unterminated string") end
      if c == '"' then i = j + 1 return table.concat(out) end
      if c == "\\" then
        local e = text:sub(j + 1, j + 1)
        local map = { n = "\n", r = "\r", t = "\t", b = "\b", f = "\f" }
        if e == "u" then out[#out + 1] = utf8.char(tonumber(text:sub(j + 2, j + 5), 16)); j = j + 6
        else out[#out + 1] = map[e] or e; j = j + 2 end
      else out[#out + 1] = c; j = j + 1 end
    end
  end
  function val()
    ws()
    local c = text:sub(i, i)
    if c == "{" then
      local t = {}; i = i + 1; ws()
      if text:sub(i, i) == "}" then i = i + 1 return t end
      while true do
        ws(); if text:sub(i, i) ~= '"' then error("[json.exception.parse_error.101] expected string literal") end
        local k = str(); ws()
        if text:sub(i, i) ~= ":" then error("[json.exception.parse_error.101] expected ':'") end
        i = i + 1; t[k] = val(); ws()
        local d = text:sub(i, i); i = i + 1
        if d == "}" then return t end
        if d ~= "," then error("[json.exception.parse_error.101] expected ',' or '}'") end
      end
    elseif c == "[" then
      local t = {}; i = i + 1; ws()
      if text:sub(i, i) == "]" then i = i + 1 return t end
      while true do
        t[#t + 1] = val(); ws()
        local d = text:sub(i, i); i = i + 1
        if d == "]" then return t end
        if d ~= "," then error("[json.exception.parse_error.101] expected ',' or ']'") end
      end
    elseif c == '"' then return str()
    elseif text:sub(i, i + 3) == "true" then i = i + 4 return true
    elseif text:sub(i, i + 4) == "false" then i = i + 5 return false
    elseif text:sub(i, i + 3) == "null" then i = i + 4 return nil
    else
      local num = text:match("^-?%d+%.?%d*[eE]?[+-]?%d*", i)
      if num == nil or num == "" then error("[json.exception.parse_error.101] syntax error") end
      i = i + #num; return tonumber(num)
    end
  end
  local r = val(); ws()
  if i <= #text then error("[json.exception.parse_error.101] unexpected trailing text") end
  return r
end
function getPlayerShip(i) for _, p in ipairs(W.players) do if p._valid then return p end end end
function getScenarioTime() return W.time end
function globalMessage(t) W.messages[#W.messages + 1] = t end
function victory(f) W.victory[#W.victory + 1] = f end
function addGMFunction() end
function addGMMessage() end
function setBanner() end
function playSoundFile() end
function pauseGame() end
function getFactionInfo() return nil end
`;

export interface LuaStep {
  readonly t: number;
  /** Real destruction from outside the scenario, as combat would do it: every handle of these groups. */
  readonly destroyGroups?: readonly string[];
  readonly destroyObjects?: readonly string[];
  readonly hull?: number;
  /** Raw Lua evaluated at this time (before the update), e.g. a probe of the runtime. Its result is appended to the snapshot line. */
  readonly probe?: string;
}

export interface LuaSnapshot {
  readonly t: number;
  readonly sector: string;
  readonly alive: readonly string[];
  readonly vars: Readonly<Record<string, string>>;
  readonly player: string;
  readonly victories: number;
  readonly hull: string;
  readonly probe: string;
  readonly destroyCalls: number;
}

export interface CampaignRun {
  readonly snaps: LuaSnapshot[];
  /** ScriptStorage after the run — what a restart would find on disk. */
  readonly storage: Record<string, string>;
}

export function runGeneratedLua(project: EEProject, target: string, steps: readonly LuaStep[]): LuaSnapshot[] {
  return runCampaignLua(project, target, steps).snaps;
}

const luaQuote = (text: string): string => `"${text.replace(/[\\"]/g, (c) => `\\${c}`).replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;

/**
 * One run of the scenario in a fresh Lua state, with the ScriptStorage a previous run left (a restart) and the scenario settings the player chose.
 * `storage` out is what that run left behind.
 */
export function runCampaignLua(
  project: EEProject,
  target: string,
  steps: readonly LuaStep[],
  options: { readonly storage?: Readonly<Record<string, string>>; readonly settings?: Readonly<Record<string, string>> } = {},
): CampaignRun {
  const built = buildProject(loadCatalog(target), { ...project, eeVersion: target }, { sourceHash: "test" });
  const g = project.id.replace(/-/g, "_");
  const files = built.files.map((f) => `[${JSON.stringify(f.name)}] = [=====[\n${f.contents}\n]=====]`).join(",\n");
  const scenario = built.files.find((f) => f.name.startsWith("scenario_"))?.name ?? "";
  const lines = steps
    .map((step) => {
      const destroys = [
        ...(step.destroyGroups ?? []).map((id) => `for _, o in ipairs(${g}_map.groups[${JSON.stringify(id)}] or {}) do o:destroy() end`),
        ...(step.destroyObjects ?? []).map((id) => `if ${g}_map.objects[${JSON.stringify(id)}] ~= nil then ${g}_map.objects[${JSON.stringify(id)}]:destroy() end`),
      ].join("\n");
      return `
do
__W.time = ${step.t}
${destroys}
${step.hull === undefined ? "" : `getPlayerShip(-1):setHull(${step.hull})`}
local probe = ""
${step.probe === undefined ? "" : `probe = tostring(${step.probe})`}
local ok, err = pcall(update, 1)
if not ok then out[#out + 1] = "ERROR " .. tostring(err) end
out[#out + 1] = snap(${step.t}, probe)
end`;
    })
    .join("\n");
  const lua = (o: Readonly<Record<string, string>> | undefined): string =>
    `{ ${Object.entries(o ?? {}).map(([k, v]) => `[${luaQuote(k)}] = ${luaQuote(v)}`).join(", ")} }`;
  const script = `__ECS = ${target === "EE-2026.09.22PR"}
__STORAGE_IN = ${lua(options.storage)}
__SETTINGS = ${lua(options.settings)}
${MOCK}
__files = {
${files}
}
function require(n) local f = __files[n]; if f ~= nil then assert(load(f, n))() end end
assert(load(__files[${JSON.stringify(scenario)}], "scenario"))()
local out = {}
local function snap(t, probe)
  local ids = {}
  for id, o in pairs(${g}_map.objects) do if o ~= nil and o:isValid() then ids[#ids + 1] = id end end
  table.sort(ids)
  local vars = {}
  for k, v in pairs(${g}_state.vars) do vars[#vars + 1] = k .. "=" .. tostring(v) end
  table.sort(vars)
  local p = getPlayerShip(-1)
  local px, py, hull = "-", "-", "-"
  if p ~= nil then px, py = p:getPosition() hull = p:getHull() end
  return table.concat({ tostring(t), tostring(${g}_map.sector), table.concat(ids, ","), table.concat(vars, ","), px .. "," .. py, #__W.victory, tostring(hull), probe, #__W.destroyed }, "|")
end
init()
out[#out + 1] = snap(-1, "")
${lines}
out[#out + 1] = "STORAGE|" .. toJSON(__STORE)
return table.concat(out, "\\n")
`;
  const dir = mkdtempSync(join(tmpdir(), "forge-lua-"));
  try {
    const file = join(dir, "run.lua");
    writeFileSync(file, script);
    const run = spawnSync("python3", [join(here, "run-lua.py"), file], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(`Lua run failed (${run.status}): ${run.stderr}\n${run.stdout}`);
    const lines = run.stdout.trim().split("\n");
    const storageLine = lines.find((l) => l.startsWith("STORAGE|"));
    const storage = storageLine === undefined ? {} : (JSON.parse(storageLine.slice("STORAGE|".length)) as Record<string, string>);
    const snaps = lines
      .filter((l) => !l.startsWith("STORAGE|"))
      .filter((l) => l.includes("|") || l.startsWith("ERROR"))
      .map((line) => {
        if (line.startsWith("ERROR")) throw new Error(line);
        const [t, sector, alive, vars, player, victories, hull, probe, destroyCalls] = line.split("|");
        return {
          t: Number(t),
          sector: sector ?? "",
          alive: (alive ?? "").split(",").filter(Boolean),
          vars: Object.fromEntries((vars ?? "").split(",").filter(Boolean).map((kv) => kv.split("=") as [string, string])),
          player: player ?? "",
          victories: Number(victories),
          hull: hull ?? "",
          probe: probe ?? "",
          destroyCalls: Number(destroyCalls),
        };
      });
    return { snaps, storage };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
