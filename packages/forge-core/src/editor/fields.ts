import {
  EE_AI_STATES,
  lookupMethod,
  type EECatalog,
  type EESpawnOrder,
  type EESpawnOrderKind,
  type SpawnableClass,
  type Vec2,
} from "@forge/contracts";

/**
 * Inspector field descriptors — what the editor renders for each object
 * type, and where each control's help text comes from.
 *
 * The field *list* mirrors the project schema (that is the editing
 * surface, and a test asserts full coverage of every schema key). The
 * field *documentation* comes from the generated EE catalog: hovering
 * "Planet radius" shows EmptyEpsilon's own prose for
 * `Planet:setPlanetRadius`. So the tool explains EE using EE's words,
 * kept honest by the same catalog the emitters are checked against.
 */

export type FieldWidget =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "vec2"
  | "color255"
  | "color01"
  | "points"
  | "orbit"
  | "weaponStorage"
  | "variables"
  // Ship-template widgets (STEP 39). Each edits one array or one small
  // record; the diagrams beside the form are a second view onto the same
  // values, exactly as the map canvas is a second view onto `position`.
  | "stringList"
  | "numberList"
  | "speed"
  | "combatManeuver"
  | "jumpDrive"
  | "beams"
  | "tubes"
  | "rooms"
  | "doors"
  /** A CpuShip's order at spawn: a verb, plus a place for the one that takes one. */
  | "spawnOrder"
  /** Somewhere on the map: coordinates, or a marker that holds them (ADR-0038). */
  | "pointRef"
  /** One of the project's comms dialogues, or none (ADR-0039). */
  | "dialogueRef";

/** Option lists the editor fills from the scanned EE install. */
export type OptionSource =
  | "factions"
  | "shipTemplates"
  | "stationTemplates"
  | "playerTemplates"
  | "models"
  | "radarTraces"
  | "planetTextures"
  /** Templates defined by *this* project — EE has no getShipTemplate(). */
  | "projectTemplates"
  | "sounds"
  | "textures";

export interface FieldSpec {
  /** Key on the object. */
  readonly key: string;
  readonly label: string;
  readonly widget: FieldWidget;
  /** True when the control offers a "clear" affordance. */
  readonly nullable: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly optionsFrom?: OptionSource;
  /** EE method this maps to; its catalog docs become the tooltip. */
  readonly ee?: { readonly class: string; readonly method: string };
  /** Shown when the catalog has nothing to say (editor-only concepts). */
  readonly hint?: string;
  /** Section heading in forms that group their fields (the ship editor). */
  readonly group?: string;
}

const CALLSIGN: FieldSpec = {
  key: "callsign",
  label: "Callsign",
  widget: "text",
  nullable: true,
  ee: { class: "Entity", method: "setCallSign" },
};

const POSITION: FieldSpec = {
  key: "position",
  label: "Position",
  widget: "vec2",
  nullable: false,
  ee: { class: "Entity", method: "setPosition" },
};

const DESCRIPTION: FieldSpec = {
  key: "description",
  label: "Description",
  widget: "textarea",
  nullable: true,
  ee: { class: "Entity", method: "setDescription" },
};

const ROTATION: FieldSpec = {
  key: "rotation",
  label: "Rotation (deg)",
  widget: "number",
  nullable: true,
  step: 1,
  ee: { class: "Entity", method: "setRotation" },
};

const FACTION: FieldSpec = {
  key: "faction",
  label: "Faction",
  widget: "select",
  nullable: false,
  optionsFrom: "factions",
  ee: { class: "Entity", method: "setFaction" },
};

/**
 * Variables declared on the object (ADR-0035). Not an EE method, so its
 * help text comes from the descriptor itself: the catalog has nothing to
 * say about a concept EmptyEpsilon does not have.
 */
const VARIABLES: FieldSpec = {
  key: "variables",
  label: "Variables",
  widget: "variables",
  nullable: false,
  hint: "Per-object state the narrative can read and write. Lives in the generated scenario, not on the EE object, so it survives the object's destruction.",
};

const BASE = [CALLSIGN, POSITION, DESCRIPTION, VARIABLES] as const;
const ORIENTED = [...BASE, ROTATION] as const;
const FACTIONED = [...ORIENTED, FACTION] as const;

const SIZE: FieldSpec = {
  key: "size",
  label: "Size",
  widget: "number",
  nullable: true,
  min: 1,
  ee: { class: "Asteroid", method: "setSize" },
};

/**
 * The four spawn orders the inspector offers, each tied to the EE verb it
 * emits so the control can show EmptyEpsilon's own description of it.
 *
 * These are the four EE's GM console exposes, which is also the list an
 * author sees in game — the remaining eight verbs need a target object or
 * a live tactical read, so they stay in the narrative actions where a
 * trigger can supply one.
 */
export const SPAWN_ORDER_OPTIONS: readonly {
  readonly kind: EESpawnOrderKind;
  readonly label: string;
  /** The EE verb emitted. A test pins each one to the catalog. */
  readonly method: string;
  /** Condensed from that verb's own documentation. */
  readonly hint: string;
}[] = [
  {
    kind: "idle",
    label: "Idle",
    method: "orderIdle",
    hint: "Stays put and does nothing. Idle ships do not target or attack nearby enemies.",
  },
  {
    kind: "roaming",
    label: "Roaming",
    method: "orderRoaming",
    hint: "Roams and engages at will, acquiring hostiles within long-range radar.",
  },
  {
    kind: "stand_ground",
    label: "Stand ground",
    method: "orderStandGround",
    hint: "Holds position and attacks nearby hostiles. Rotates to face a target but never moves.",
  },
  {
    kind: "defend_location",
    label: "Defend location",
    method: "orderDefendLocation",
    hint: "Patrols within 1.5U of the point and attacks hostiles that come near it.",
  },
];

/**
 * A blank order of the given kind.
 *
 * `defend_location` is seeded with `origin` — the ship's own position —
 * because "defend a location" almost always means the station it is
 * parked at, and a point defaulting to (0, 0) would quietly send the whole
 * spawn flying to the map's origin the first time it ran.
 */
export function blankSpawnOrder(kind: EESpawnOrderKind, origin: Vec2): EESpawnOrder {
  switch (kind) {
    case "idle":
      return { kind: "idle" };
    case "roaming":
      return { kind: "roaming" };
    case "stand_ground":
      return { kind: "stand_ground" };
    case "defend_location":
      return { kind: "defend_location", position: { ref: "point", position: { ...origin } } };
  }
}

/** Per-type fields, in the order the inspector shows them. */
export const FIELD_SPECS: Record<SpawnableClass, readonly FieldSpec[]> = {
  PlayerSpaceship: [
    ...FACTIONED,
    {
      key: "template",
      label: "Template",
      widget: "select",
      nullable: false,
      optionsFrom: "playerTemplates",
      ee: { class: "Entity", method: "setTemplate" },
    },
  ],
  CpuShip: [
    ...FACTIONED,
    {
      key: "template",
      label: "Template",
      widget: "select",
      nullable: false,
      optionsFrom: "shipTemplates",
      ee: { class: "Entity", method: "setTemplate" },
    },
    {
      key: "ai",
      label: "Combat AI",
      widget: "select",
      nullable: true,
      options: EE_AI_STATES,
      ee: { class: "CpuShip", method: "setAI" },
    },
    {
      key: "order",
      label: "Order",
      widget: "spawnOrder",
      nullable: true,
      // No `ee` method: this one field maps to four of them, and citing
      // any single one would document the other three wrongly. The
      // per-order prose comes from SPAWN_ORDER_OPTIONS below, which is
      // EE's own, and a test pins each verb to the catalog.
      hint: "What this ship does from the moment it spawns. Left unset, EE leaves it Idle — and an Idle ship never attacks, whatever its Combat AI says.",
    },
    {
      key: "dialogueId",
      label: "Dialogue",
      widget: "dialogueRef",
      nullable: true,
      hint: "What this object says when hailed. Unset leaves EmptyEpsilon's own comms script for the class.",
    },
  ],
  SpaceStation: [
    ...FACTIONED,
    {
      key: "template",
      label: "Template",
      widget: "select",
      nullable: false,
      optionsFrom: "stationTemplates",
      ee: { class: "Entity", method: "setTemplate" },
    },
    {
      key: "dialogueId",
      label: "Dialogue",
      widget: "dialogueRef",
      nullable: true,
      hint: "What this station says when hailed. Setting one REPLACES EE's service menu: no missile restocking, repairs, supply drops or reinforcements until a reply hands them back.",
    },
  ],
  Asteroid: [...BASE, SIZE],
  VisualAsteroid: [
    ...BASE,
    { ...SIZE, ee: { class: "VisualAsteroid", method: "setSize" } },
  ],
  Planet: [
    ...ORIENTED,
    {
      key: "radius",
      label: "Radius",
      widget: "number",
      nullable: false,
      min: 1,
      ee: { class: "Planet", method: "setPlanetRadius" },
    },
    {
      key: "surfaceTexture",
      label: "Surface texture",
      widget: "select",
      nullable: true,
      optionsFrom: "planetTextures",
      ee: { class: "Planet", method: "setPlanetSurfaceTexture" },
    },
    {
      key: "cloudTexture",
      label: "Cloud texture",
      widget: "select",
      nullable: true,
      optionsFrom: "planetTextures",
      ee: { class: "Planet", method: "setPlanetCloudTexture" },
    },
    {
      key: "atmosphereTexture",
      label: "Atmosphere texture",
      widget: "select",
      nullable: true,
      optionsFrom: "planetTextures",
      ee: { class: "Planet", method: "setPlanetAtmosphereTexture" },
    },
    {
      key: "atmosphereColor",
      label: "Atmosphere colour",
      widget: "color01",
      nullable: true,
      ee: { class: "Planet", method: "setPlanetAtmosphereColor" },
    },
    {
      key: "axialRotationTime",
      label: "Axial rotation (s)",
      widget: "number",
      nullable: true,
      min: 0,
      ee: { class: "Planet", method: "setAxialRotationTime" },
    },
    {
      key: "distanceFromMovementPlane",
      label: "Vertical offset",
      widget: "number",
      nullable: true,
      ee: { class: "Planet", method: "setDistanceFromMovementPlane" },
    },
    {
      key: "orbit",
      label: "Orbital period (s)",
      widget: "orbit",
      nullable: true,
      ee: { class: "Planet", method: "setOrbit" },
      // EE's own documentation, quoted above this hint by the catalog,
      // says "degrees per tick" and is wrong. Contradicting it here is
      // the point: the catalog is EE's voice, the hint is ours, and an
      // author reading the tooltip must not be left with the version
      // that makes a moon lap its planet every three seconds.
      hint:
        "Seconds for ONE FULL REVOLUTION — a smaller number orbits FASTER. " +
        "EE's text above calls this 'degrees per tick'; it is wrong. " +
        "planet.cpp advances the body by (delta / period) * 360 degrees " +
        "each frame, and delta is seconds. " +
        "Zero is rejected — EE divides by it and the planet's position " +
        "becomes NaN. A negative period orbits the other way round.",
    },
  ],
  Nebula: [...BASE],
  Mine: [...BASE],
  BlackHole: [...BASE],
  WormHole: [
    ...BASE,
    {
      key: "targetPosition",
      label: "Exit",
      widget: "pointRef",
      nullable: false,
      ee: { class: "WormHole", method: "setTargetPosition" },
    },
  ],
  Artifact: [
    ...ORIENTED,
    {
      key: "model",
      label: "Model",
      widget: "select",
      nullable: true,
      optionsFrom: "models",
      ee: { class: "Artifact", method: "setModel" },
    },
    {
      key: "spin",
      label: "Spin",
      widget: "number",
      nullable: true,
      step: 0.1,
      ee: { class: "Artifact", method: "setSpin" },
    },
    {
      key: "allowPickup",
      label: "Allow pickup",
      widget: "boolean",
      nullable: true,
      ee: { class: "Artifact", method: "allowPickup" },
    },
    {
      key: "radarTraceIcon",
      label: "Radar trace",
      widget: "select",
      nullable: true,
      optionsFrom: "radarTraces",
      ee: { class: "Artifact", method: "setRadarTraceIcon" },
    },
    {
      key: "radarTraceScale",
      label: "Radar trace scale",
      widget: "number",
      nullable: true,
      min: 0,
      step: 0.1,
      ee: { class: "Artifact", method: "setRadarTraceScale" },
    },
    {
      key: "radarTraceColor",
      label: "Radar trace colour",
      widget: "color255",
      nullable: true,
      ee: { class: "Artifact", method: "setRadarTraceColor" },
    },
    {
      key: "dialogueId",
      label: "Dialogue",
      widget: "dialogueRef",
      nullable: true,
      hint: "What this object says when hailed. An Artifact has no default comms script, so a dialogue here takes nothing away.",
    },
  ],
  SupplyDrop: [
    ...BASE,
    {
      key: "energy",
      label: "Energy",
      widget: "number",
      nullable: true,
      min: 0,
      ee: { class: "SupplyDrop", method: "setEnergy" },
    },
    {
      key: "weaponStorage",
      label: "Weapons",
      widget: "weaponStorage",
      nullable: false,
      ee: { class: "SupplyDrop", method: "setWeaponStorage" },
    },
  ],
  ScanProbe: [
    ...BASE,
    {
      key: "speed",
      label: "Speed",
      widget: "number",
      nullable: true,
      min: 0,
      ee: { class: "ScanProbe", method: "setSpeed" },
    },
    {
      key: "lifetime",
      label: "Lifetime (s)",
      widget: "number",
      nullable: true,
      min: 0,
      ee: { class: "ScanProbe", method: "setLifetime" },
    },
    {
      key: "target",
      label: "Target",
      widget: "pointRef",
      nullable: true,
      ee: { class: "ScanProbe", method: "setTarget" },
    },
    {
      key: "ownedByPlayer",
      label: "Owned by player",
      widget: "boolean",
      nullable: false,
      ee: { class: "ScanProbe", method: "setOwner" },
      hint: "EE faults on getOwner() for an unowned probe — leave this on unless you know better.",
    },
  ],
  WarpJammer: [
    ...FACTIONED,
    {
      key: "range",
      label: "Jam range",
      widget: "number",
      nullable: true,
      min: 0,
      ee: { class: "WarpJammer", method: "setRange" },
    },
    {
      key: "hull",
      label: "Hull",
      widget: "number",
      nullable: true,
      min: 0,
      ee: { class: "WarpJammer", method: "setHull" },
    },
  ],
  Zone: [
    ...BASE,
    {
      key: "points",
      label: "Polygon",
      widget: "points",
      nullable: false,
      ee: { class: "Zone", method: "setPoints" },
    },
    {
      key: "color",
      label: "Colour",
      widget: "color255",
      nullable: true,
      ee: { class: "Zone", method: "setColor" },
    },
    {
      key: "label",
      label: "Label",
      widget: "text",
      nullable: true,
      ee: { class: "Zone", method: "setLabel" },
    },
  ],
};

export function fieldsFor(type: SpawnableClass): readonly FieldSpec[] {
  return FIELD_SPECS[type];
}

/**
 * Help text for a field: EmptyEpsilon's own documentation when the field
 * maps to an EE method, the editor-authored hint otherwise.
 */
export function fieldDoc(catalog: EECatalog, spec: FieldSpec): string | null {
  if (spec.ee !== undefined) {
    const found = lookupMethod(catalog, spec.ee.class, spec.ee.method);
    if (found !== null) {
      return spec.hint === undefined
        ? found.method.doc
        : `${found.method.doc}\n\n${spec.hint}`;
    }
  }
  return spec.hint ?? null;
}
