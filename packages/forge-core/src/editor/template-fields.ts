import { EE_AI_STATES, type EECatalog } from "@forge/contracts";
import { fieldDoc, type FieldSpec } from "./fields.js";

/**
 * Ship-template field descriptors — the editing surface for
 * `ShipTemplate`, grouped the way a hull is actually specified.
 *
 * Same contract as the object descriptors in `fields.ts`: the field *list*
 * mirrors `EETemplateDefSchema` and a test asserts coverage in both
 * directions, while the field *documentation* comes from the generated EE
 * catalog. Where EE's reference documents nothing — and for these setters
 * it very often documents nothing at all — the hint says what the
 * install's own `scripts/shiptemplates/*.lua` do with the call, which is
 * evidence rather than paraphrase.
 */

const IDENTITY = "Identity";
const HULL = "Hull";
const MOVEMENT = "Movement";
const WEAPONS = "Weapons";
const DECK = "Deck plan";
const SENSORS = "Sensors";
const DOCKING = "Docking";
const ABILITIES = "Crew abilities";

const st = (method: string): { readonly class: string; readonly method: string } => ({
  class: "ShipTemplate",
  method,
});

/** Every editable key of `EETemplateDefSchema`, in form order. */
export const TEMPLATE_FIELDS: readonly FieldSpec[] = [
  {
    key: "name",
    label: "Name",
    widget: "text",
    nullable: false,
    group: IDENTITY,
    ee: st("setName"),
    hint: "The string `setTemplate()` will use. Renaming it here does not rewrite the map objects that already reference the old name.",
  },
  {
    key: "localeName",
    label: "Display name",
    widget: "text",
    nullable: true,
    group: IDENTITY,
    ee: st("setLocaleName"),
  },
  {
    key: "kind",
    label: "Type",
    widget: "select",
    nullable: false,
    group: IDENTITY,
    options: ["ship", "playership", "station"],
    ee: st("setType"),
  },
  {
    key: "copyOf",
    label: "Copy of",
    widget: "select",
    nullable: true,
    group: IDENTITY,
    optionsFrom: "projectTemplates",
    ee: st("copy"),
    hint: "Starts from another template *of this project* and overrides from there. Stock templates cannot be copied: EE exposes no getShipTemplate(), so there is no handle to copy from.",
  },
  {
    key: "className",
    label: "Class",
    widget: "text",
    nullable: true,
    group: IDENTITY,
    ee: st("setClass"),
    hint: "Shown on Science, and the string the docking lists below match against.",
  },
  {
    key: "subclassName",
    label: "Subclass",
    widget: "text",
    nullable: true,
    group: IDENTITY,
    ee: st("setClass"),
  },
  {
    key: "description",
    label: "Description",
    widget: "textarea",
    nullable: true,
    group: IDENTITY,
    ee: st("setDescription"),
  },
  {
    key: "hidden",
    label: "Hidden",
    widget: "boolean",
    nullable: false,
    group: IDENTITY,
    ee: st("hidden"),
    hint: "Keeps the template out of EE's own pickers. A scenario can still spawn it by name.",
  },

  {
    key: "model",
    label: "Model",
    widget: "select",
    nullable: true,
    group: HULL,
    optionsFrom: "models",
    ee: st("setModel"),
  },
  {
    key: "radarTrace",
    label: "Radar trace",
    widget: "select",
    nullable: true,
    group: HULL,
    optionsFrom: "radarTraces",
    ee: st("setRadarTrace"),
  },
  {
    key: "hull",
    label: "Hull",
    widget: "number",
    nullable: true,
    min: 1,
    group: HULL,
    ee: st("setHull"),
  },
  {
    key: "shields",
    label: "Shields",
    widget: "numberList",
    nullable: false,
    min: 0,
    group: HULL,
    ee: st("setShields"),
    hint: "One value per arc: one entry is an omnidirectional shield, two are front and rear. EE takes them as a variadic call.",
  },
  {
    key: "energyStorage",
    label: "Energy storage",
    widget: "number",
    nullable: true,
    min: 1,
    group: HULL,
    ee: st("setEnergyStorage"),
  },
  {
    key: "repairCrewCount",
    label: "Repair crew",
    widget: "number",
    nullable: true,
    min: 0,
    group: HULL,
    ee: st("setRepairCrewCount"),
  },

  {
    key: "speed",
    label: "Speed",
    widget: "speed",
    nullable: true,
    group: MOVEMENT,
    ee: st("setSpeed"),
    hint: "Impulse, turn and acceleration are required; reverse speed and reverse acceleration are optional and are only emitted together with the forward pair.",
  },
  {
    key: "combatManeuver",
    label: "Combat manoeuvre",
    widget: "combatManeuver",
    nullable: true,
    group: MOVEMENT,
    ee: st("setCombatManeuver"),
  },
  {
    key: "warpSpeed",
    label: "Warp speed",
    widget: "number",
    nullable: true,
    min: 0,
    group: MOVEMENT,
    ee: st("setWarpSpeed"),
  },
  {
    key: "jumpDrive",
    label: "Jump drive",
    widget: "jumpDrive",
    nullable: true,
    group: MOVEMENT,
    ee: st("setJumpDrive"),
    hint: "The range pair is emitted as setJumpDriveRange() only when both ends are set; EE's own default range applies otherwise.",
  },
  {
    key: "cloaking",
    label: "Cloaking",
    widget: "boolean",
    nullable: true,
    group: MOVEMENT,
    ee: st("setCloaking"),
  },
  {
    key: "impulseSoundFile",
    label: "Impulse sound",
    widget: "select",
    nullable: true,
    group: MOVEMENT,
    optionsFrom: "sounds",
    ee: st("setImpulseSoundFile"),
    hint: "Path under resources/, e.g. sfx/engine_fighter.wav — the install's starFighters.lua uses exactly that.",
  },

  {
    key: "beams",
    label: "Beams",
    widget: "beams",
    nullable: false,
    group: WEAPONS,
    ee: st("setBeamWeapon"),
    hint: "Arc and direction are degrees; direction 0 is straight ahead. The arc diagram beside the form draws whatever is in this table.",
  },
  {
    key: "tubes",
    label: "Missile tubes",
    widget: "tubes",
    nullable: true,
    group: WEAPONS,
    ee: st("setTubes"),
    hint: "Count and load time apply to every tube; a per-tube row overrides them and sets what that tube may carry.",
  },
  {
    key: "weaponStorage",
    label: "Magazine",
    widget: "weaponStorage",
    nullable: false,
    group: WEAPONS,
    ee: st("setWeaponStorage"),
  },
  {
    key: "defaultAI",
    label: "Default combat AI",
    widget: "select",
    nullable: true,
    group: WEAPONS,
    options: EE_AI_STATES,
    ee: st("setDefaultAI"),
    hint: "How CpuShips built from this hull fight — tactics, not objectives. A ship's own Combat AI overrides it, and neither one makes a ship act: that takes an order.",
  },

  {
    key: "rooms",
    label: "Rooms",
    widget: "rooms",
    nullable: false,
    group: DECK,
    ee: st("addRoomSystem"),
    hint: "Engineering's deck plan, in grid cells. A room with no system is a corridor (addRoom).",
  },
  {
    key: "doors",
    label: "Doors",
    widget: "doors",
    nullable: false,
    group: DECK,
    ee: st("addDoor"),
    hint: "Horizontal doors sit on a cell's top edge, vertical ones on its left edge.",
  },

  {
    key: "longRangeRadarRange",
    label: "Long-range radar",
    widget: "number",
    nullable: true,
    min: 1,
    group: SENSORS,
    ee: st("setLongRangeRadarRange"),
  },
  {
    key: "shortRangeRadarRange",
    label: "Short-range radar",
    widget: "number",
    nullable: true,
    min: 1,
    group: SENSORS,
    ee: st("setShortRangeRadarRange"),
  },

  {
    key: "externalDockClasses",
    label: "Docks externally",
    widget: "stringList",
    nullable: false,
    group: DOCKING,
    ee: st("setExternalDockClasses"),
    hint: "Class names (the first argument of the other ship's setClass), not template names. setDockClasses is the older name for this same list — it assigns the very field setExternalDockClasses does, so there is one list here, not two.",
  },
  {
    key: "internalDockClasses",
    label: "… and internally",
    widget: "stringList",
    nullable: false,
    group: DOCKING,
    ee: st("setInternalDockClasses"),
    hint: "The second, separate list: craft held inside rather than on hardpoints. corvette.lua splits a carrier's two capacities that way.",
  },
  {
    key: "canDock",
    label: "Can dock",
    widget: "boolean",
    nullable: true,
    group: DOCKING,
    ee: st("setCanDock"),
  },
  {
    key: "sharesEnergyWithDocked",
    label: "Shares energy",
    widget: "boolean",
    nullable: true,
    group: DOCKING,
    ee: st("setSharesEnergyWithDocked"),
  },
  {
    key: "repairDocked",
    label: "Repairs docked",
    widget: "boolean",
    nullable: true,
    group: DOCKING,
    ee: st("setRepairDocked"),
  },
  {
    key: "restocksScanProbes",
    label: "Restocks probes",
    widget: "boolean",
    nullable: true,
    group: DOCKING,
    ee: st("setRestocksScanProbes"),
  },
  {
    key: "restocksMissilesDocked",
    label: "Restocks missiles",
    widget: "boolean",
    nullable: true,
    group: DOCKING,
    ee: st("setRestocksMissilesDocked"),
    hint: "Applies to docking CpuShips, not to player ships — the note is stations.lua's own.",
  },

  {
    key: "canScan",
    label: "Can scan",
    widget: "boolean",
    nullable: true,
    group: ABILITIES,
    ee: st("setCanScan"),
  },
  {
    key: "canHack",
    label: "Can hack",
    widget: "boolean",
    nullable: true,
    group: ABILITIES,
    ee: st("setCanHack"),
  },
  {
    key: "canCombatManeuver",
    label: "Can combat-manoeuvre",
    widget: "boolean",
    nullable: true,
    group: ABILITIES,
    ee: st("setCanCombatManeuver"),
  },
  {
    key: "canSelfDestruct",
    label: "Can self-destruct",
    widget: "boolean",
    nullable: true,
    group: ABILITIES,
    ee: st("setCanSelfDestruct"),
  },
  {
    key: "canLaunchProbe",
    label: "Can launch probes",
    widget: "boolean",
    nullable: true,
    group: ABILITIES,
    ee: st("setCanLaunchProbe"),
  },
];

/** Descriptors in form order, bucketed by their section heading. */
export function templateFieldGroups(): readonly (readonly [string, readonly FieldSpec[]])[] {
  const order: string[] = [];
  const byGroup = new Map<string, FieldSpec[]>();
  for (const spec of TEMPLATE_FIELDS) {
    const group = spec.group ?? "";
    let bucket = byGroup.get(group);
    if (bucket === undefined) {
      bucket = [];
      byGroup.set(group, bucket);
      order.push(group);
    }
    bucket.push(spec);
  }
  return order.map((group) => [group, byGroup.get(group) ?? []] as const);
}

/** Same help-text contract as the object inspector. */
export function templateFieldDoc(catalog: EECatalog, spec: FieldSpec): string | null {
  return fieldDoc(catalog, spec);
}
