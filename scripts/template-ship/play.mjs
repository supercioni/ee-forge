#!/usr/bin/env node
/**
 * The engine half of the template-ship collaudo: start an ISOLATED EmptyEpsilon clone headless (private http and game ports,
 * the clone's own working directory), read what the scenario built, then drive the ship with the engine's own station commands.
 *
 *   node scripts/template-ship/play.mjs --engine 2026 --clone /mnt/c/ForgeCollaudo/T/e26 --http 19999 --scenario scenario_ship_test_2026.lua \
 *        [--ships A,B] [--out docs/verification/template-ship/2026-author-engine.json] [--stay]
 *
 * Three kinds of evidence, kept apart in the report:
 *   api       what the engine's getters return (getHullMax, getImpulseMaxSpeed, ...) — a getter can lie, so never alone
 *   behaviour what the ship DID: distance covered, turn rate measured from samples, damage per beam hit on a shield-less target
 *   log       the engine's own log: no "Failed to find", no "Duplicate ship template", no Lua error
 * Nothing of the user's EmptyEpsilon is touched: the clone's folder is passed in and must live under C:\ForgeCollaudo\T.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const ENGINE = arg("engine");
const CLONE = resolve(arg("clone") ?? "");
const HTTP = Number(arg("http"));
const SCENARIO = arg("scenario");
const SHIPS = (arg("ships", "A,B") ?? "A,B").split(",");
const STAY = process.argv.includes("--stay");
const OUT = arg("out");
const OVERRIDE = JSON.parse(arg("expect", "{}") ?? "{}");
if (!["2024", "2026"].includes(ENGINE ?? "") || !CLONE.startsWith("/mnt/c/ForgeCollaudo/T/") || !HTTP || !SCENARIO) throw new Error("usage: --engine 2024|2026 --clone /mnt/c/ForgeCollaudo/T/<clone> --http <port> --scenario <file.lua>");
const EXPECTED = JSON.parse(readFileSync(join(here, "expected.json"), "utf8"));
for (const [k, v] of Object.entries(OVERRIDE)) Object.assign(EXPECTED[k], v);
const winClone = `C:\\${CLONE.slice("/mnt/c/".length).replaceAll("/", "\\")}`;
const winHelpers = "C:\\ForgeCollaudo\\T";
for (const f of ["run.ps1", "lua.ps1"]) copyFileSync(join(here, "win", f), `/mnt/c/ForgeCollaudo/T/${f}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (args) => spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { encoding: "utf8" }).stdout.replace(/\r/g, "");
const pidFile = `${CLONE.replace(/\/[^/]+$/, "")}/pid-play-${ENGINE}.txt`;

const results = [];
const evidence = { api: [], behaviour: [], log: [] };
const check = (kind, label, ok, observed) => { evidence[kind].push({ label, ok: Boolean(ok), observed }); results.push(ok); console.log(`  ${ok ? "PASS" : "FAIL"} [${kind}] ${label}   ${JSON.stringify(observed)}`); };

let n = 0;
function lua(code) {
  n += 1;
  const file = `/mnt/c/ForgeCollaudo/T/_play${ENGINE}_${n % 4}.lua`;
  writeFileSync(file, code);
  const out = ps(["-File", `${winHelpers}\\lua.ps1`, String(HTTP), `${winHelpers}\\_play${ENGINE}_${n % 4}.lua`]).trim();
  if (out.startsWith("HTTPERR")) throw new Error(out);
  return out.startsWith('"') && out.endsWith('"') ? out.slice(1, -1) : out;
}
const num = (s) => Number(String(s).trim());

// The two engines differ in how a ship's numbers are read; the common getters exist on both (catalog, 2026 Entity / 2024 SpaceShip).
const PRELUDE = `
local function find(cs) for _, o in pairs(getAllObjects()) do if o ~= nil then local ok, c = pcall(function() return o:getCallSign() end); if ok and c == cs then return o end end end end
`;
const read = (cs, expr) => lua(`${PRELUDE} local s = find(${JSON.stringify(cs)}); if s == nil then return "MISSING" end; ${expr}`);

console.log(`\n== EE ${ENGINE}: ${SCENARIO} in ${CLONE}`);
const logFile = join(CLONE, "EmptyEpsilon.log");
writeFileSync(logFile, "");
const started = ps(["-File", `${winHelpers}\\run.ps1`, CLONE.split("/").pop(), SCENARIO, String(HTTP), pidFile.replace("/mnt/c/", "C:\\").replaceAll("/", "\\")]).trim();
console.log(started);
const pid = readFileSync(pidFile, "utf8").trim();
const stop = () => ps(["-Command", `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]);
let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  await sleep(2000);
  try { ready = lua(`return #getAllObjects() >= 0 and "up" or "no"`) === "up"; } catch { /* still starting */ }
}
if (!ready) { stop(); throw new Error("the engine did not answer"); }
await sleep(4000);

const report = { engine: ENGINE, clone: CLONE, scenario: SCENARIO, startedAt: new Date().toISOString(), ships: {} };
try {
  for (const key of SHIPS) {
    const want = EXPECTED[key];
    const cs = want.callsign;
    console.log(`\n-- ship ${key}: ${cs} (${want.name})`);
    const present = read(cs, `return "present"`);
    check("api", `${cs} exists in the engine`, present === "present", present);
    if (present !== "present") continue;
    const hull = num(read(cs, `return tostring(s:getHullMax())`));
    const impulse = num(read(cs, `return tostring(s:getImpulseMaxSpeed())`));
    const turn = num(read(cs, `return tostring(s:getRotationMaxSpeed())`));
    const beams = read(cs, `local t = {}; for i = 0, 7 do local r = s:getBeamWeaponRange(i); if r ~= nil and r > 0 then t[#t+1] = i .. ":" .. s:getBeamWeaponRange(i) .. "/" .. s:getBeamWeaponDamage(i) .. "/" .. s:getBeamWeaponCycleTime(i) end end; return table.concat(t, " ")`);
    const typeName = read(cs, `return tostring(s:getTypeName())`);
    const shield0 = num(read(cs, `return tostring(s:getShieldMax(0))`));
    const tubes = num(read(cs, `return tostring(s:getWeaponTubeCount())`));
    const jump = read(cs, `return tostring(s:hasJumpDrive())`);
    report.ships[key] = { hull, impulse, turn, beams, typeName, shield0, tubes, jump };
    check("api", `${cs}: template name the engine resolved = "${want.name}"`, typeName === want.name, typeName);
    check("api", `${cs}: hull ${want.hull}`, hull === want.hull, hull);
    check("api", `${cs}: impulse speed ${want.impulse}`, impulse === want.impulse, impulse);
    check("api", `${cs}: rotation speed ${want.turn}`, turn === want.turn, turn);
    const beam0 = (beams.split(" ")[0] ?? "").split(":")[1]?.split("/").map(Number) ?? [];
    check("api", `${cs}: beam 0 range ${want.beamRange} / damage ${want.beamDamage}`, beam0[0] === want.beamRange && beam0[1] === want.beamDamage, beams);
    if (want.shield1 !== undefined) check("api", `${cs}: shield 1 = ${want.shield1}`, shield0 === want.shield1, shield0);
    if (key === "A") {
      check("api", `${cs}: the original's other values survived the copy (2 shields of 200, 5 tubes, jump drive)`, shield0 === 200 && tubes === 5 && jump === "true", { shield0, tubes, jump });
    }

    // ---- model (2026 only: the component is readable; EE 2024 has no getter for it, so there it is NOT verified by API)
    if (ENGINE === "2026") {
      const mesh = read(cs, `local m = s.components.mesh_render; return m and tostring(m.mesh) or "none"`);
      const wantModel = want.model ?? null;
      report.ships[key].mesh = mesh;
      if (wantModel !== null) check("api", `${cs}: mesh_render.mesh mentions the model ${wantModel}`, mesh.includes(wantModel), mesh);
      else console.log(`  info  ${cs}: mesh_render.mesh = ${mesh}`);
    }

    // ---- behaviour: movement. Full impulse straight ahead for 14 s, then the speed from two samples taken in GAME time
    // (every HTTP call costs a second of wall time, so wall-clock arithmetic would be wrong by a factor of two).
    const heading0 = num(read(cs, `return tostring(s:getRotation())`));
    read(cs, `s:commandImpulse(1); return "ok"`);
    await sleep(14000);
    const sample = () => read(cs, `local x, y = s:getPosition(); return getScenarioTime() .. "," .. x .. "," .. y .. "," .. s:getRotation()`).split(",").map(Number);
    const p1 = sample();
    await sleep(1000);
    const p2 = sample();
    const speed = Math.hypot(p2[1] - p1[1], p2[2] - p1[2]) / (p2[0] - p1[0]);
    check("behaviour", `${cs}: cruising speed after 14+ s at full impulse ≈ ${want.impulse} (±3%)`, Math.abs(speed - want.impulse) <= want.impulse * 0.03, { speed: Number(speed.toFixed(1)), gameSeconds: Number((p2[0] - p1[0]).toFixed(2)) });
    read(cs, `s:commandImpulse(0); return "ok"`);

    // ---- behaviour: turn rate. Ask for +150° and sample heading with its game time; the plateau is the median of the largest steps.
    const target = (heading0 + 150) % 360;
    read(cs, `s:commandTargetRotation(${target}); return "ok"`);
    const samples = [];
    for (let i = 0; i < 14; i += 1) { const q = sample(); samples.push([q[0], q[3]]); await sleep(100); }
    const rates = [];
    for (let i = 1; i < samples.length; i += 1) {
      let d = Math.abs(samples[i][1] - samples[i - 1][1]); if (d > 180) d = 360 - d;
      const dt = samples[i][0] - samples[i - 1][0];
      if (dt > 0.2 && d > 1) rates.push(d / dt);
    }
    const top = rates.sort((a, b) => b - a).slice(0, 3);
    const plateau = top.length === 0 ? 0 : top[Math.floor(top.length / 2)];
    const best = top[0] ?? 0;
    check("behaviour", `${cs}: turn rate measured while rotating ≈ ${want.turn}°/s (±15%)`, Math.abs(plateau - want.turn) <= want.turn * 0.15, { plateau: Number(plateau.toFixed(1)), peak: Number(best.toFixed(1)), samples: samples.length });
    await sleep(3500);

    // ---- behaviour: a beam. A shield-less hostile dummy 1200 u dead ahead; the first drop of its hull is one beam shot.
    const here2 = read(cs, `local x, y = s:getPosition(); return x .. "," .. y .. "," .. s:getRotation()`).split(",").map(Number);
    const rad = (here2[2] * Math.PI) / 180;
    const ex = here2[0] + Math.cos(rad) * 1200, ey = here2[1] + Math.sin(rad) * 1200;
    const dummyCs = `DUMMY-${key}`;
    lua(`local d = CpuShip():setTemplate("MT52 Hornet"):setFaction("Kraylor"):setCallSign("${dummyCs}"):setPosition(${ex}, ${ey}):orderIdle(); d:setShieldsMax(0); d:setHullMax(5000); d:setHull(5000); return "ok"`);
    const dh0 = num(lua(`${PRELUDE} return tostring(find("${dummyCs}"):getHull())`));
    read(cs, `s:commandSetTarget(find("${dummyCs}")); return "ok"`);
    const hulls = [];
    for (let i = 0; i < 40; i += 1) {
      await sleep(250);
      hulls.push(num(lua(`${PRELUDE} local d = find("${dummyCs}"); return d and tostring(d:getHull()) or "-1"`)));
      if (hulls.at(-1) < dh0) break;
    }
    const dealt = dh0 - hulls.at(-1);
    // Every beam whose arc covers the target fires at once: the first drop of the hull is the sum of those beams' damages.
    const inArc = read(cs, `local t = find("${dummyCs}"); local sx, sy = s:getPosition(); local tx, ty = t:getPosition(); local bearing = (math.deg(math.atan2(ty - sy, tx - sx)) - s:getRotation() + 540) % 360 - 180; local sum, names = 0, {}; for i = 0, 7 do local r = s:getBeamWeaponRange(i); if r ~= nil and r > 0 then local dir = s:getBeamWeaponDirection(i); local arc = s:getBeamWeaponArc(i); local diff = math.abs((bearing - dir + 540) % 360 - 180); if diff <= arc / 2 and r >= 1200 then sum = sum + s:getBeamWeaponDamage(i); names[#names+1] = i .. "=" .. s:getBeamWeaponDamage(i) end end end; return sum .. "|" .. table.concat(names, ",")`);
    const [sum, which] = inArc.split("|");
    check("behaviour", `${cs}: the first hit takes ${sum} hull from a shield-less target (the beams in arc: ${which}), and ${want.beamDamage} of it is beam 0's`, Math.abs(dealt - Number(sum)) <= 0.5 && which.split(",").some((w) => w.startsWith("0=") && Number(w.slice(2)) === want.beamDamage), { before: dh0, after: hulls.at(-1), dealt });
    lua(`${PRELUDE} local d = find("${dummyCs}"); if d then d:destroy() end return "ok"`);
    report.ships[key].behaviour = { cruiseSpeed: speed, turnPlateau: plateau, beamShotDamage: dealt };
  }
} finally {
  await sleep(1500);
  const logText = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  if (!STAY) stop();
  await sleep(1500);
  const logAfter = existsSync(logFile) ? readFileSync(logFile, "utf8") : logText;
  const bad = logAfter.split(/\r?\n/).filter((l) => /Failed to find|Duplicate ship template|ERROR|can not be created during a scenario|Lua error|attempt to/i.test(l));
  check("log", "the engine log has no missing model, duplicate template or script error", bad.length === 0, bad.slice(0, 5));
  report.log = logAfter.split(/\r?\n/).filter((l) => /\[(ERROR|WARNING)/.test(l) && !/No value added to the stack|serial|COM\d|joystick|Failed to open game state log/i.test(l)).slice(0, 20);
}
report.evidence = evidence;
report.passed = results.filter(Boolean).length;
report.failed = results.filter((r) => !r).length;
if (OUT) { mkdirSync(dirname(resolve(OUT)), { recursive: true }); writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`); }
console.log(`\nEE ${ENGINE}: ${report.passed}/${results.length} checks passed`);
process.exit(report.failed === 0 ? 0 : 1);
