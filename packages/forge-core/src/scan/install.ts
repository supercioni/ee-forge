import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  EE_AI_STATES,
  EE_MISSILE_SIZES,
  EE_MISSILE_TYPES,
  EE_TEMPLATE_KINDS,
  EELibrarySchema,
  SHIP_SYSTEM_NAMES,
  type EEBeamDef,
  type EEFactionRef,
  type EELibrary,
  type EEMissileType,
  type EEModelRef,
  type EEResourceIndex,
  type EETemplateRef,
  type EETubeDef,
} from "@forge/contracts";
import { inheritByCopy } from "../template-copy.js";
import {
  firstNumber,
  firstString,
  parseDataScript,
  parseStatements,
  type LuaCall,
  type LuaStatement,
} from "./lua-data.js";

/**
 * Builds an {@link EELibrary} — the index of what an EE install already
 * contains — by reading the install's own data scripts and resource tree.
 *
 * Nothing here writes to the install. The scan is read-only by design
 * (ADR-0034 §3): EE FORGE never mutates game files.
 */

/**
 * The EE build this toolkit is pinned to.
 *
 * Lives beside the scanner because both the CLI and the bridge's rescan
 * route need it, and two copies of a version string drift.
 */
export const DEFAULT_EE_VERSION = "EE-2026.09.22PR";

export interface ScanOptions {
  /** Root of the EE install (the directory holding `scripts/`). */
  readonly eeInstall: string;
  readonly eeVersion: string;
  readonly scannedAt?: string;
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Paths inside `resources/` use forward slashes, the way EE setters want. */
function resourceKey(resourcesDir: string, path: string): string {
  return relative(resourcesDir, path).split(sep).join("/");
}

// ---------------------------------------------------------------------------
// .pack archives
// ---------------------------------------------------------------------------

/**
 * List the entries of an EE `.pack` archive.
 *
 * Format, per the install's own `packs/pack_gen.py`:
 *   int32be version, int32be file_count,
 *   file_count × { uint8 name_len, name bytes, int32be offset, int32be size },
 *   then the blobs.
 *
 * Only the name table is read — the editor needs an inventory, not pixels.
 */
export function listPackEntries(packPath: string): string[] {
  const buffer = readFileSync(packPath);
  if (buffer.length < 8) return [];
  const count = buffer.readInt32BE(4);
  const names: string[] = [];
  let offset = 8;
  for (let i = 0; i < count; i += 1) {
    if (offset + 1 > buffer.length) break;
    const nameLength = buffer.readUInt8(offset);
    offset += 1;
    if (offset + nameLength + 8 > buffer.length) break;
    names.push(buffer.toString("utf8", offset, offset + nameLength));
    offset += nameLength + 8;
  }
  return names;
}

// ---------------------------------------------------------------------------
// Ship templates
// ---------------------------------------------------------------------------

interface TemplateAccumulator {
  ref: EETemplateRef;
  /** True when the name is a Lua expression the scanner cannot resolve. */
  computedName: boolean;
  /** Setters whose arguments the reader could not resolve. */
  unreadable: Set<string>;
}

/**
 * EE's `transport.lua` builds 25 templates inside nested loops with names
 * like `"Transport" .. type .. "x" .. cnt`. A static reader cannot resolve
 * those without executing Lua, so they are reported rather than guessed at.
 * Real template names never contain `..`, quotes, or parentheses.
 */
function isComputedName(name: string): boolean {
  return /\.\.|["'()]/.test(name);
}

// --- argument readers ------------------------------------------------------
//
// `null` from the parser means "this argument was not a literal" — a
// variable, an expression, a call. Every reader returns null for that too,
// and every case that needs a value it did not get records the setter as
// unreadable. A library that quietly substitutes a default stops being
// evidence about the install.

function argString(call: LuaCall, index: number): string | null {
  // The literal check is what separates a real string from an expression
  // the parser kept verbatim. Without it, `setLocaleName(string.format(…))`
  // is stored as the characters `string.format(…)`.
  if (call.literal[index] !== true) return null;
  const value = call.args[index];
  return typeof value === "string" ? value : null;
}

function argNumber(call: LuaCall, index: number): number | null {
  if (call.literal[index] !== true) return null;
  const value = call.args[index];
  return typeof value === "number" ? value : null;
}

function argBoolean(call: LuaCall, index: number): boolean | null {
  if (call.literal[index] !== true) return null;
  const value = call.args[index];
  return typeof value === "boolean" ? value : null;
}

/**
 * A string argument matched against an enum, ignoring case.
 *
 * EE's own conversion is case-insensitive — probed live 2026-08-20:
 * `getSystemHealth("Maneuver")` and `getSystemHealth("maneuver")` both read
 * the same system, while `"maneuvering"` and `"bogus"` both read 0. The
 * install relies on it: `corvette.lua` writes `addRoomSystem(…,
 * "BeamWeapons")` where our canonical spelling is `beamweapons`. The
 * canonical value is what gets stored, so the library reads one way.
 */
function argEnum<T extends string>(
  options: readonly T[],
  call: LuaCall,
  index: number,
): T | null {
  const value = argString(call, index);
  if (value === null) return null;
  const folded = value.toLowerCase();
  return options.find((option) => option.toLowerCase() === folded) ?? null;
}

/** Every literal number in the call, for the variadic setters. */
function argNumbers(call: LuaCall): number[] {
  return call.args.filter(
    (a, i): a is number => call.literal[i] === true && typeof a === "number",
  );
}

/** Every literal string in the call, for the variadic setters. */
function argStrings(call: LuaCall): string[] {
  return call.args.filter(
    (a, i): a is string => call.literal[i] === true && typeof a === "string",
  );
}

// --- indexed sub-records ---------------------------------------------------

function blankBeam(index: number): EEBeamDef {
  return {
    index,
    arc: 0,
    direction: 0,
    range: 0,
    cycleTime: 0,
    damage: 0,
    turret: null,
    texture: null,
    energyPerFire: null,
    heatPerFire: null,
  };
}

function blankTube(index: number): EETubeDef {
  return {
    index,
    direction: null,
    loadTime: null,
    size: null,
    exclusiveFor: null,
    allow: [],
    disallow: [],
  };
}

function upsertBeam(
  accumulator: TemplateAccumulator,
  index: number,
  patch: Partial<EEBeamDef>,
): void {
  const beams = [...accumulator.ref.beams];
  const at = beams.findIndex((b) => b.index === index);
  const next = { ...(at === -1 ? blankBeam(index) : beams[at] ?? blankBeam(index)), ...patch };
  if (at === -1) beams.push(next);
  else beams[at] = next;
  accumulator.ref = { ...accumulator.ref, beams };
}

/**
 * EE's own templates always call `setTubes` first, but a per-tube setter
 * reaching a template that has not is not a parse failure — EE would apply
 * it to a tube that exists by default. `8.0` is the constructor's load time.
 */
function upsertTube(
  accumulator: TemplateAccumulator,
  index: number,
  patch: Partial<EETubeDef>,
): void {
  const tubes = accumulator.ref.tubes ?? { count: 0, loadTime: 8, perTube: [] };
  const perTube = [...tubes.perTube];
  const at = perTube.findIndex((t) => t.index === index);
  const next = { ...(at === -1 ? blankTube(index) : perTube[at] ?? blankTube(index)), ...patch };
  if (at === -1) perTube.push(next);
  else perTube[at] = next;
  accumulator.ref = { ...accumulator.ref, tubes: { ...tubes, perTube } };
}

function setWeaponStorage(
  accumulator: TemplateAccumulator,
  weapon: EEMissileType,
  amount: number,
): void {
  const storage = accumulator.ref.weaponStorage.filter((s) => s.weapon !== weapon);
  accumulator.ref = { ...accumulator.ref, weaponStorage: [...storage, { weapon, amount }] };
}

// --- the reader ------------------------------------------------------------

/**
 * Apply one chained statement's calls to a template being accumulated.
 *
 * Covers the whole `ShipTemplate` script surface, because the library is
 * what an author copies a stock hull *from* (ADR-0041): a setter this
 * function ignores is a field that silently reverts to EE's default in the
 * copy. `test/scan.test.ts` walks the registered method list to keep the
 * two in step.
 */
function applyTemplateCalls(
  accumulator: TemplateAccumulator,
  statement: LuaStatement,
): void {
  const set = (patch: Partial<EETemplateRef>): void => {
    accumulator.ref = { ...accumulator.ref, ...patch };
  };
  /** Record a setter whose arguments were not literals, and move on. */
  const unreadable = (method: string): void => {
    accumulator.unreadable.add(method);
  };
  /**
   * A one-argument setter: take the value, and say so when the argument
   * was *there* but did not resolve.
   *
   * Absent and unresolvable both read as null, and only the second is
   * worth reporting — `setLocaleName(string.format(…))` loses a display
   * name, while a template that simply never called it has lost nothing.
   */
  const optional = <T>(call: LuaCall, read: () => T | null): T | null => {
    const value = read();
    if (value === null && call.args.length > 0 && call.literal[0] !== true) {
      unreadable(call.method);
    }
    return value;
  };

  for (const call of statement.calls) {
    switch (call.method) {
      // --- identity ---
      case "setName":
      case "copy": {
        const name = argString(call, 0);
        if (name === null) unreadable(call.method);
        else if (isComputedName(name)) accumulator.computedName = true;
        else set({ name });
        break;
      }
      case "setLocaleName":
        set({ localeName: optional(call, () => argString(call, 0)) });
        break;
      case "setType": {
        const kind = argEnum(EE_TEMPLATE_KINDS, call, 0);
        if (kind === null) unreadable(call.method);
        else set({ kind });
        break;
      }
      case "setClass":
        set({
          className: argString(call, 0),
          subclassName: argString(call, 1),
        });
        break;
      case "setDescription":
        set({ description: optional(call, () => argString(call, 0)) });
        break;
      case "setModel":
        set({ model: optional(call, () => argString(call, 0)) });
        break;
      case "setRadarTrace":
        set({ radarTrace: optional(call, () => argString(call, 0)) });
        break;
      case "hidden":
        set({ hidden: true });
        break;
      case "setDefaultAI":
        set({ defaultAI: optional(call, () => argEnum(EE_AI_STATES, call, 0)) });
        break;

      // --- hull ---
      case "setHull":
        set({ hull: optional(call, () => argNumber(call, 0)) });
        break;
      case "setShields":
        set({ shields: argNumbers(call) });
        break;
      case "setEnergyStorage":
        set({ energyStorage: optional(call, () => argNumber(call, 0)) });
        break;
      case "setRepairCrewCount":
        set({ repairCrewCount: optional(call, () => argNumber(call, 0)) });
        break;

      // --- movement ---
      case "setSpeed": {
        const impulse = argNumber(call, 0);
        const turn = argNumber(call, 1);
        const acceleration = argNumber(call, 2);
        if (impulse === null || turn === null || acceleration === null) {
          unreadable(call.method);
          break;
        }
        set({
          speed: {
            impulse,
            turn,
            acceleration,
            reverseSpeed: argNumber(call, 3),
            reverseAcceleration: argNumber(call, 4),
          },
        });
        break;
      }
      case "setCombatManeuver": {
        const boost = argNumber(call, 0);
        const strafe = argNumber(call, 1);
        if (boost === null || strafe === null) unreadable(call.method);
        else set({ combatManeuver: { boost, strafe } });
        break;
      }
      case "setWarpSpeed":
        set({ warpSpeed: optional(call, () => argNumber(call, 0)) });
        break;
      case "setJumpDrive": {
        const enabled = argBoolean(call, 0);
        if (enabled === null) {
          unreadable(call.method);
          break;
        }
        const jump = accumulator.ref.jumpDrive;
        set({
          jumpDrive: {
            enabled,
            minRange: jump?.minRange ?? null,
            maxRange: jump?.maxRange ?? null,
          },
        });
        break;
      }
      case "setJumpDriveRange": {
        const minRange = argNumber(call, 0);
        const maxRange = argNumber(call, 1);
        if (minRange === null || maxRange === null) {
          unreadable(call.method);
          break;
        }
        const jump = accumulator.ref.jumpDrive;
        set({ jumpDrive: { enabled: jump?.enabled ?? true, minRange, maxRange } });
        break;
      }
      case "setCloaking":
        set({ cloaking: optional(call, () => argBoolean(call, 0)) });
        break;
      case "setImpulseSoundFile":
        set({ impulseSoundFile: optional(call, () => argString(call, 0)) });
        break;

      // --- beams ---
      // `setBeam` and `setBeamWeapon` have identical signatures; EE's own
      // templates use the older name 164 times to setBeamWeapon's 30.
      case "setBeam":
      case "setBeamWeapon": {
        const index = argNumber(call, 0);
        const arc = argNumber(call, 1);
        const direction = argNumber(call, 2);
        const range = argNumber(call, 3);
        const cycleTime = argNumber(call, 4);
        const damage = argNumber(call, 5);
        if (
          index === null ||
          arc === null ||
          direction === null ||
          range === null ||
          cycleTime === null ||
          damage === null
        ) {
          unreadable(call.method);
          break;
        }
        upsertBeam(accumulator, index, { arc, direction, range, cycleTime, damage });
        break;
      }
      case "setBeamWeaponTurret": {
        const index = argNumber(call, 0);
        const arc = argNumber(call, 1);
        const direction = argNumber(call, 2);
        const rotationRate = argNumber(call, 3);
        if (index === null || arc === null || direction === null || rotationRate === null) {
          unreadable(call.method);
          break;
        }
        upsertBeam(accumulator, index, { turret: { arc, direction, rotationRate } });
        break;
      }
      case "setBeamTexture": {
        const index = argNumber(call, 0);
        const texture = argString(call, 1);
        if (index === null || texture === null) unreadable(call.method);
        else upsertBeam(accumulator, index, { texture });
        break;
      }
      case "setBeamWeaponEnergyPerFire": {
        const index = argNumber(call, 0);
        const energyPerFire = argNumber(call, 1);
        if (index === null || energyPerFire === null) unreadable(call.method);
        else upsertBeam(accumulator, index, { energyPerFire });
        break;
      }
      case "setBeamWeaponHeatPerFire": {
        const index = argNumber(call, 0);
        const heatPerFire = argNumber(call, 1);
        if (index === null || heatPerFire === null) unreadable(call.method);
        else upsertBeam(accumulator, index, { heatPerFire });
        break;
      }

      // --- tubes ---
      case "setTubes": {
        const count = argNumber(call, 0);
        const loadTime = argNumber(call, 1);
        if (count === null || loadTime === null) {
          unreadable(call.method);
          break;
        }
        set({
          tubes: { count, loadTime, perTube: accumulator.ref.tubes?.perTube ?? [] },
        });
        break;
      }
      case "setTubeLoadTime": {
        const index = argNumber(call, 0);
        const loadTime = argNumber(call, 1);
        if (index === null || loadTime === null) unreadable(call.method);
        else upsertTube(accumulator, index, { loadTime });
        break;
      }
      case "setTubeDirection": {
        const index = argNumber(call, 0);
        const direction = argNumber(call, 1);
        if (index === null || direction === null) unreadable(call.method);
        else upsertTube(accumulator, index, { direction });
        break;
      }
      case "setTubeSize": {
        const index = argNumber(call, 0);
        const size = argEnum(EE_MISSILE_SIZES, call, 1);
        if (index === null || size === null) unreadable(call.method);
        else upsertTube(accumulator, index, { size });
        break;
      }
      case "setWeaponTubeExclusiveFor": {
        const index = argNumber(call, 0);
        const exclusiveFor = argEnum(EE_MISSILE_TYPES, call, 1);
        if (index === null || exclusiveFor === null) unreadable(call.method);
        else upsertTube(accumulator, index, { exclusiveFor });
        break;
      }
      case "weaponTubeAllowMissle": {
        const index = argNumber(call, 0);
        const weapon = argEnum(EE_MISSILE_TYPES, call, 1);
        if (index === null || weapon === null) {
          unreadable(call.method);
          break;
        }
        const tube = accumulator.ref.tubes?.perTube.find((t) => t.index === index);
        upsertTube(accumulator, index, {
          allow: [...new Set([...(tube?.allow ?? []), weapon])],
        });
        break;
      }
      case "weaponTubeDisallowMissle": {
        const index = argNumber(call, 0);
        const weapon = argEnum(EE_MISSILE_TYPES, call, 1);
        if (index === null || weapon === null) {
          unreadable(call.method);
          break;
        }
        const tube = accumulator.ref.tubes?.perTube.find((t) => t.index === index);
        upsertTube(accumulator, index, {
          disallow: [...new Set([...(tube?.disallow ?? []), weapon])],
        });
        break;
      }
      case "setWeaponStorage": {
        const weapon = argEnum(EE_MISSILE_TYPES, call, 0);
        const amount = argNumber(call, 1);
        if (weapon === null || amount === null) unreadable(call.method);
        else setWeaponStorage(accumulator, weapon, amount);
        break;
      }

      // --- deck plan ---
      case "addRoom":
      case "addRoomSystem": {
        const x = argNumber(call, 0);
        const y = argNumber(call, 1);
        const width = argNumber(call, 2);
        const height = argNumber(call, 3);
        if (x === null || y === null || width === null || height === null) {
          unreadable(call.method);
          break;
        }
        const system =
          call.method === "addRoomSystem" ? argEnum(SHIP_SYSTEM_NAMES, call, 4) : null;
        if (call.method === "addRoomSystem" && system === null) {
          unreadable(call.method);
          break;
        }
        set({ rooms: [...accumulator.ref.rooms, { x, y, width, height, system }] });
        break;
      }
      case "addDoor": {
        const x = argNumber(call, 0);
        const y = argNumber(call, 1);
        const horizontal = argBoolean(call, 2);
        if (x === null || y === null || horizontal === null) unreadable(call.method);
        else set({ doors: [...accumulator.ref.doors, { x, y, horizontal }] });
        break;
      }

      // --- sensors ---
      case "setLongRangeRadarRange":
        set({ longRangeRadarRange: optional(call, () => argNumber(call, 0)) });
        break;
      case "setShortRangeRadarRange":
        set({ shortRangeRadarRange: optional(call, () => argNumber(call, 0)) });
        break;

      // --- docking ---
      // `setDockClasses` and `setExternalDockClasses` are the SAME field:
      // both assign `external_dock_classes` in shipTemplate.cpp, and no
      // `dock_classes` member exists. Assignment, not accumulation — the
      // last call wins, exactly as in EE.
      case "setDockClasses":
      case "setExternalDockClasses":
        set({ externalDockClasses: argStrings(call) });
        break;
      case "setInternalDockClasses":
        set({ internalDockClasses: argStrings(call) });
        break;
      case "setSharesEnergyWithDocked":
        set({ sharesEnergyWithDocked: optional(call, () => argBoolean(call, 0)) });
        break;
      case "setRepairDocked":
        set({ repairDocked: optional(call, () => argBoolean(call, 0)) });
        break;
      case "setRestocksScanProbes":
        set({ restocksScanProbes: optional(call, () => argBoolean(call, 0)) });
        break;
      case "setRestocksMissilesDocked":
        set({ restocksMissilesDocked: optional(call, () => argBoolean(call, 0)) });
        break;

      // --- crew abilities ---
      case "setCanScan":
        set({ canScan: optional(call, () => argBoolean(call, 0)) });
        break;
      case "setCanHack":
        set({ canHack: optional(call, () => argBoolean(call, 0)) });
        break;
      case "setCanDock":
        set({ canDock: optional(call, () => argBoolean(call, 0)) });
        break;
      case "setCanCombatManeuver":
        set({ canCombatManeuver: optional(call, () => argBoolean(call, 0)) });
        break;
      case "setCanSelfDestruct":
        set({ canSelfDestruct: optional(call, () => argBoolean(call, 0)) });
        break;
      case "setCanLaunchProbe":
        set({ canLaunchProbe: optional(call, () => argBoolean(call, 0)) });
        break;

      default:
        break;
    }
  }
}

function blankTemplate(sourceFile: string): EETemplateRef {
  return {
    name: "",
    localeName: null,
    // EE defaults an unset template to "ship" (CpuShip) — documented on
    // ShipTemplate:setType.
    kind: "ship",
    className: null,
    subclassName: null,
    description: null,
    model: null,
    radarTrace: null,
    hull: null,
    shields: [],
    speed: null,
    combatManeuver: null,
    warpSpeed: null,
    jumpDrive: null,
    cloaking: null,
    energyStorage: null,
    repairCrewCount: null,
    beams: [],
    tubes: null,
    weaponStorage: [],
    rooms: [],
    doors: [],
    longRangeRadarRange: null,
    shortRangeRadarRange: null,
    defaultAI: null,
    externalDockClasses: [],
    internalDockClasses: [],
    sharesEnergyWithDocked: null,
    repairDocked: null,
    restocksScanProbes: null,
    restocksMissilesDocked: null,
    impulseSoundFile: null,
    canScan: null,
    canHack: null,
    canDock: null,
    canCombatManeuver: null,
    canSelfDestruct: null,
    canLaunchProbe: null,
    hidden: false,
    sourceFile,
    copiedFrom: null,
  };
}

function scanTemplateFile(
  source: string,
  sourceFile: string,
  warnings: string[],
): EETemplateRef[] {
  const byVar = new Map<string, TemplateAccumulator>();
  const found: TemplateAccumulator[] = [];

  // Template families are generated in `for` loops (transport.lua's 25
  // hulls, corvette.lua's freighters), so the loops are unrolled before
  // the statements are read — otherwise the library is visibly poorer
  // than EmptyEpsilon's own ship picker.
  const script = parseDataScript(source);
  for (const warning of script.warnings) warnings.push(`${sourceFile}: ${warning}`);

  for (const statement of script.statements) {
    const copyCall = statement.calls.find((c) => c.method === "copy");

    if (statement.constructs === "ShipTemplate") {
      const accumulator: TemplateAccumulator = {
        ref: blankTemplate(sourceFile),
        computedName: false,
        unreadable: new Set<string>(),
      };
      applyTemplateCalls(accumulator, statement);
      found.push(accumulator);
      if (statement.assignsTo !== null) byVar.set(statement.assignsTo, accumulator);
      continue;
    }

    if (copyCall !== undefined && statement.subject !== null) {
      const base = byVar.get(statement.subject);
      const accumulator: TemplateAccumulator = {
        ref:
          base === undefined
            ? blankTemplate(sourceFile)
            : inheritedTemplate(base.ref, sourceFile),
        computedName: false,
        unreadable: new Set<string>(),
      };
      accumulator.ref = { ...accumulator.ref, copiedFrom: base?.ref.name ?? statement.subject };
      applyTemplateCalls(accumulator, statement);
      found.push(accumulator);
      if (statement.assignsTo !== null) byVar.set(statement.assignsTo, accumulator);
      continue;
    }

    if (statement.subject !== null && statement.assignsTo === null) {
      const target = byVar.get(statement.subject);
      if (target !== undefined) applyTemplateCalls(target, statement);
    }
  }

  const computed = found.filter((t) => t.computedName);
  if (computed.length > 0) {
    warnings.push(
      `${sourceFile}: ${computed.length} template(s) build their name from a Lua expression ` +
        `(loop-generated) and cannot be listed by a static scan — reference them by name manually`,
    );
  }

  const named = found.filter((t) => !t.computedName && t.ref.name !== "");
  const unnamed = found.length - computed.length - named.length;
  if (unnamed > 0) {
    warnings.push(`${sourceFile}: ${unnamed} template(s) had no setName`);
  }

  // A setter whose arguments were not literals leaves a field at its
  // default, and an author copying that hull into a project would inherit
  // the hole without being told. Say so — grouped by setter, because a
  // template family generated in a loop produces the same complaint 25
  // times and one line per file per setter is what a person can act on.
  const byMethod = new Map<string, string[]>();
  for (const template of named) {
    for (const method of template.unreadable) {
      const names = byMethod.get(method) ?? [];
      names.push(template.ref.name);
      byMethod.set(method, names);
    }
  }
  for (const [method, names] of [...byMethod].sort(([a], [b]) => a.localeCompare(b))) {
    const shown = names.slice(0, 3).join(", ");
    const rest = names.length > 3 ? `, +${names.length - 3} more` : "";
    warnings.push(
      `${sourceFile}: ${method} has arguments this reader cannot resolve on ${names.length} ` +
        `template(s) (${shown}${rest}) — that field is missing from the library, and from any copy made of one`,
    );
  }

  return named.map((t) => t.ref);
}

/**
 * What a stock `base:copy("name")` actually inherits.
 *
 * Not a clone: EE's `ShipTemplate::copy` assigns member by member and
 * leaves several behind, so reading it as one would credit a variant with
 * a radar range or jump range EE never gave it. `hidden` resets too —
 * `copy()` builds a fresh template and only `hidden()` sets that flag.
 */
function inheritedTemplate(base: EETemplateRef, sourceFile: string): EETemplateRef {
  return inheritByCopy({ ...base, sourceFile, hidden: false }, blankTemplate(sourceFile));
}

/** Follow `scripts/shipTemplates.lua`'s require list — EE's own load order. */
function templateFiles(eeInstall: string, warnings: string[]): string[] {
  const scriptsDir = join(eeInstall, "scripts");
  const index = readIfExists(join(scriptsDir, "shipTemplates.lua"));
  if (index === null) {
    warnings.push("scripts/shipTemplates.lua not found — falling back to shiptemplates/*.lua");
    const dir = join(scriptsDir, "shiptemplates");
    return walk(dir).filter((f) => f.endsWith(".lua"));
  }
  const files: string[] = [];
  for (const match of index.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    const rel = match[1];
    if (rel === undefined) continue;
    const full = join(scriptsDir, rel);
    if (existsSync(full)) files.push(full);
    else warnings.push(`shipTemplates.lua requires missing file "${rel}"`);
  }
  return files;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function scanModels(eeInstall: string, warnings: string[]): EEModelRef[] {
  const path = join(eeInstall, "scripts", "model_data.lua");
  const source = readIfExists(path);
  if (source === null) {
    warnings.push("scripts/model_data.lua not found — model library will be empty");
    return [];
  }

  const models: EEModelRef[] = [];
  const byVar = new Map<string, EEModelRef>();
  const relPath = "scripts/model_data.lua";

  const apply = (model: EEModelRef, statement: LuaStatement): EEModelRef => {
    let next = model;
    for (const call of statement.calls) {
      switch (call.method) {
        case "setName":
          next = { ...next, name: firstString(call) ?? next.name };
          break;
        case "setMesh":
          next = { ...next, mesh: firstString(call) };
          break;
        case "setTexture":
          next = { ...next, texture: firstString(call) };
          break;
        case "setSpecular":
          next = { ...next, specular: firstString(call) };
          break;
        case "setIllumination":
          next = { ...next, illumination: firstString(call) };
          break;
        case "setScale":
          next = { ...next, scale: firstNumber(call) };
          break;
        case "setRadius":
          next = { ...next, radius: firstNumber(call) };
          break;
        default:
          break;
      }
    }
    return next;
  };

  for (const statement of parseStatements(source)) {
    if (statement.constructs === "ModelData") {
      const blank: EEModelRef = {
        name: "",
        mesh: null,
        texture: null,
        specular: null,
        illumination: null,
        scale: null,
        radius: null,
        sourceFile: relPath,
      };
      const created = apply(blank, statement);
      models.push(created);
      if (statement.assignsTo !== null) byVar.set(statement.assignsTo, created);
      continue;
    }
    if (statement.subject !== null && statement.assignsTo === null) {
      const current = byVar.get(statement.subject);
      if (current === undefined) continue;
      const updated = apply(current, statement);
      const index = models.indexOf(current);
      if (index >= 0) models[index] = updated;
      byVar.set(statement.subject, updated);
    }
  }

  const named = models.filter((m) => m.name !== "");
  if (named.length < models.length) {
    warnings.push(`${relPath}: ${models.length - named.length} model(s) had no setName`);
  }
  return named;
}

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

function scanFactions(eeInstall: string, warnings: string[]): EEFactionRef[] {
  // The reference says factions load from `resources/factionInfo.lua`, but
  // shipped installs put it in `scripts/`. Check both rather than guess.
  const candidates = [
    join(eeInstall, "scripts", "factionInfo.lua"),
    join(eeInstall, "resources", "factionInfo.lua"),
  ];
  const path = candidates.find((c) => existsSync(c));
  if (path === undefined) {
    warnings.push("factionInfo.lua not found in scripts/ or resources/");
    return [];
  }
  const source = readFileSync(path, "utf8");
  const relPath = relative(eeInstall, path).split(sep).join("/");

  const byVar = new Map<string, EEFactionRef>();
  const order: string[] = [];

  const apply = (faction: EEFactionRef, statement: LuaStatement): EEFactionRef => {
    let next = faction;
    for (const call of statement.calls) {
      switch (call.method) {
        case "setName":
          next = { ...next, name: firstString(call) ?? next.name };
          break;
        case "setGMColor": {
          const [r, g, b] = call.args;
          if (typeof r === "number" && typeof g === "number" && typeof b === "number") {
            next = { ...next, gmColor: [r, g, b] };
          }
          break;
        }
        case "setEnemy": {
          const ref = call.args[0];
          if (typeof ref === "string") next = { ...next, enemies: [...next.enemies, ref] };
          break;
        }
        case "setFriendly": {
          const ref = call.args[0];
          if (typeof ref === "string") next = { ...next, friends: [...next.friends, ref] };
          break;
        }
        default:
          break;
      }
    }
    return next;
  };

  for (const statement of parseStatements(source)) {
    if (statement.constructs === "FactionInfo") {
      const created = apply(
        { name: "", gmColor: null, enemies: [], friends: [], sourceFile: relPath },
        statement,
      );
      const key = statement.assignsTo ?? created.name;
      byVar.set(key, created);
      order.push(key);
      continue;
    }
    if (statement.subject !== null && statement.assignsTo === null) {
      const current = byVar.get(statement.subject);
      if (current !== undefined) byVar.set(statement.subject, apply(current, statement));
    }
  }

  // Relations were captured as variable names; resolve them to faction names.
  const resolve = (ref: string): string => byVar.get(ref)?.name ?? ref;
  return order
    .map((key) => byVar.get(key))
    .filter((f): f is EEFactionRef => f !== undefined && f.name !== "")
    .map((f) => ({
      ...f,
      enemies: f.enemies.map(resolve),
      friends: f.friends.map(resolve),
    }));
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

const MESH_EXT = [".obj", ".model"];
const TEXTURE_EXT = [".png", ".jpg", ".jpeg"];
const SOUND_EXT = [".wav", ".ogg", ".mp3"];

function hasExt(path: string, extensions: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return extensions.some((e) => lower.endsWith(e));
}

function scanResources(eeInstall: string, warnings: string[]): EEResourceIndex {
  const resourcesDir = join(eeInstall, "resources");
  const files = walk(resourcesDir).map((f) => resourceKey(resourcesDir, f));

  const packsDir = join(eeInstall, "packs");
  const packs: string[] = [];
  const packEntries: string[] = [];
  if (existsSync(packsDir)) {
    for (const entry of readdirSync(packsDir)) {
      if (!entry.endsWith(".pack")) continue;
      packs.push(entry);
      try {
        packEntries.push(...listPackEntries(join(packsDir, entry)));
      } catch (error) {
        warnings.push(`packs/${entry}: unreadable (${String(error)})`);
      }
    }
  }

  const all = [...files, ...packEntries];
  const sorted = (values: string[]): string[] => [...new Set(values)].sort();

  return {
    radarTraces: sorted(
      files.filter((f) => f.startsWith("radar/") && hasExt(f, TEXTURE_EXT)),
    ),
    planetTextures: sorted(
      files.filter((f) => f.startsWith("planets/") && hasExt(f, TEXTURE_EXT)),
    ),
    meshes: sorted(all.filter((f) => hasExt(f, MESH_EXT))),
    textures: sorted(
      all.filter(
        (f) => hasExt(f, TEXTURE_EXT) && !f.startsWith("radar/") && !f.startsWith("planets/"),
      ),
    ),
    sounds: sorted(all.filter((f) => hasExt(f, SOUND_EXT))),
    packs: packs.sort(),
  };
}

// ---------------------------------------------------------------------------

export function scanInstall(options: ScanOptions): EELibrary {
  const warnings: string[] = [];

  if (!existsSync(options.eeInstall)) {
    throw new Error(`EE install not found at ${options.eeInstall}`);
  }

  const templates: EETemplateRef[] = [];
  for (const file of templateFiles(options.eeInstall, warnings)) {
    const relPath = relative(options.eeInstall, file).split(sep).join("/");
    templates.push(...scanTemplateFile(readFileSync(file, "utf8"), relPath, warnings));
  }

  const library: EELibrary = {
    eeVersion: options.eeVersion,
    installPath: options.eeInstall,
    scannedAt: options.scannedAt ?? new Date().toISOString(),
    templates,
    models: scanModels(options.eeInstall, warnings),
    factions: scanFactions(options.eeInstall, warnings),
    resources: scanResources(options.eeInstall, warnings),
    warnings,
  };

  return EELibrarySchema.parse(library);
}
