import { z } from "zod";
import {
  AlertLevelSchema,
  ShipSystemNameSchema,
  Vec2Schema,
  type Vec2,
} from "./primitives.js";

/**
 * EE FORGE project document — the single source of truth for a piece of
 * EmptyEpsilon content (ADR-0034 §1).
 *
 * One JSON file holds five sections: factions, models, ship templates,
 * the map, and the narrative logic. `forge:build` renders it to vanilla
 * EE Lua; the Lua is a build artifact and is never read back. Nothing in
 * this schema is EXODUS-specific except the opt-in `exodus_*` actions,
 * which are unavailable unless the project declares `requires: ["exodus"]`.
 *
 * Every enum below is lifted from the generated API catalog, not guessed:
 * AI states from `CpuShip:setAI`'s docs, template types from
 * `ShipTemplate:setType`, systems from `ESystem`, alert levels from
 * `EAlertLevel`, missile types from `EMissileWeapons`.
 */

// ---------------------------------------------------------------------------
// Shared leaves
// ---------------------------------------------------------------------------

/** Slug identity inside a project. Stable across renames of the label. */
export const EEIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, {
  message: "id must be lowercase alphanumeric with - or _",
});

/** RGB in 0..255, EE's convention for GM colours and radar traces. */
export const EEColorSchema = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);
export type EEColor = z.infer<typeof EEColorSchema>;

/** Verified from `CpuShip:setAI` documentation (EE-2024.12.08). */
export const EE_AI_STATES = ["default", "evasion", "fighter", "missilevolley"] as const;
export const EEAiStateSchema = z.enum(EE_AI_STATES);
export type EEAiState = z.infer<typeof EEAiStateSchema>;

/** Verified from `ShipTemplate:setType` documentation. */
export const EE_TEMPLATE_KINDS = ["ship", "playership", "station"] as const;
export const EETemplateKindSchema = z.enum(EE_TEMPLATE_KINDS);
export type EETemplateKind = z.infer<typeof EETemplateKindSchema>;

/** `EMissileWeapons` enum. */
export const EE_MISSILE_TYPES = ["Homing", "Nuke", "Mine", "EMP", "HVLI"] as const;
export const EEMissileTypeSchema = z.enum(EE_MISSILE_TYPES);
export type EEMissileType = z.infer<typeof EEMissileTypeSchema>;

/** `EMissileSizes` enum — what `ShipTemplate:setTubeSize` accepts. */
export const EE_MISSILE_SIZES = ["small", "medium", "large"] as const;
export const EEMissileSizeSchema = z.enum(EE_MISSILE_SIZES);
export type EEMissileSize = z.infer<typeof EEMissileSizeSchema>;

/** `Color` enum — the named values `addToShipLog` accepts. */
export const EELogColorSchema = z.enum([
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "magenta",
  "cyan",
]);
export type EELogColor = z.infer<typeof EELogColorSchema>;

/**
 * What a variable can hold. Declared here rather than beside the logic
 * schema because map objects carry variables too, and a `const` cannot be
 * referenced above its own initialisation.
 */
export const EEVariableValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type EEVariableValue = z.infer<typeof EEVariableValueSchema>;

// ---------------------------------------------------------------------------
// Places: markers and point references
// ---------------------------------------------------------------------------

/**
 * A named place that exists only in the project document (ADR-0038).
 *
 * EmptyEpsilon has no marker class and none is invented: a marker is never
 * constructed, and every reference to one is resolved to literal
 * coordinates when the project is built. It costs nothing at runtime.
 *
 * The point is shared identity. Without markers, the ambush trigger, the
 * patrol anchor and the waypoint a wing flies to are three unrelated
 * number pairs that happen to match; moving the encounter means finding
 * all three, and the one that gets missed fails silently with a build that
 * still succeeds.
 */
export const EEMarkerSchema = z.object({
  id: EEIdSchema,
  /** What the author calls it. Shown on the canvas and in every picker. */
  label: z.string().min(1),
  position: Vec2Schema,
  /** Authoring note. Never reaches EE — nothing here does. */
  notes: z.string().nullable(),
  /**
   * The sector it is filed under, or null for Shared. Authoring organisation only: it never reaches EE and changes
   * neither the id nor any reference to the marker.
   */
  sector: EEIdSchema.nullable().default(null),
});
export type EEMarker = z.infer<typeof EEMarkerSchema>;

/**
 * Somewhere on the map: either coordinates, or a marker that holds them.
 *
 * Same shape as {@link EETargetRefSchema}, which already answers "which
 * object" this way. A literal point stays first-class — most places in a
 * scenario are mentioned once, and forcing a marker for those would be
 * ceremony.
 */
export const EEPointRefSchema = z.preprocess(
  // Documents written before markers existed hold a bare `{x, y}` here.
  // Normalising on read means an old project opens unchanged and is
  // rewritten to the tagged form the first time it is saved, instead of a
  // schema addition becoming a migration.
  (value) =>
    typeof value === "object" &&
    value !== null &&
    !("ref" in value) &&
    "x" in value &&
    "y" in value
      ? { ref: "point", position: value }
      : value,
  z.discriminatedUnion("ref", [
    z.object({ ref: z.literal("point"), position: Vec2Schema }),
    z.object({ ref: z.literal("marker"), markerId: EEIdSchema }),
  ]),
);
export type EEPointRef =
  | { readonly ref: "point"; readonly position: Vec2 }
  | { readonly ref: "marker"; readonly markerId: string };

// ---------------------------------------------------------------------------
// Map objects
// ---------------------------------------------------------------------------

const ObjectBase = {
  id: EEIdSchema,
  /**
   * `SpaceObject:setCallSign`. Null skips the call entirely.
   * The editor auto-assigns these per `docs/authoring/naming-convention.md`
   * (`TT-SS-NN[-III]`), which is what makes the convention enforceable.
   */
  callsign: z.string().nullable(),
  position: Vec2Schema,
  /** `SpaceObject:setDescription`. Kept separate from callsign on purpose. */
  description: z.string().nullable(),
  /**
   * Variables declared **on this object**, with their starting values.
   *
   * Not an EmptyEpsilon concept: they live in the generated scenario's own
   * state table, keyed by object id (ADR-0035). That is what lets the
   * simulator reproduce them exactly and what keeps them readable after the
   * object is destroyed — a rule can still ask whether a ship had been
   * alerted before it died.
   *
   * An array rather than a record, for the same reason the rest of this
   * schema uses ordered lists: stable order in the document and diffs that
   * read.
   */
  variables: z.array(
    z.object({ name: z.string().min(1), initial: EEVariableValueSchema }),
  ),
};

const OrientedBase = {
  ...ObjectBase,
  /** `SpaceObject:setRotation`, degrees. */
  rotation: z.number().nullable(),
};

const FactionedBase = {
  ...OrientedBase,
  /** `SpaceObject:setFaction` — must match a stock or project faction name. */
  faction: z.string(),
};

export const EEPlayerShipObjectSchema = z.object({
  ...FactionedBase,
  type: z.literal("PlayerSpaceship"),
  template: z.string().min(1),
});

/**
 * The order a CpuShip carries the moment it spawns.
 *
 * Orders are a **different axis from combat AI**, in EE's own words:
 * *"Combat AI states determine the AI's combat tactics and responses.
 * They're distinct from orders, which determine the ship's active
 * objectives."* The AI says how a ship fights; the order says whether it
 * is doing anything at all. A ship constructed with neither reports
 * `getOrder() == "Idle"` (probed live, 2026-08-13), and EE documents Idle
 * as *"don't target or attack nearby enemies"* — so a fleet placed on the
 * map and never ordered sits still for the whole scenario.
 *
 * A tagged record per order rather than one enum plus a loose position,
 * for the same reason {@link EEActionSchema} models the twelve order verbs
 * as twelve records: `orderDefendLocation` needs coordinates and the other
 * three take none, and an optional field that only one variant reads is a
 * field every form has to explain away.
 *
 * These four are the ones EE's GM console exposes. The other eight order
 * verbs need a target object or a live tactical picture, which makes them
 * narrative beats — they stay in the logic actions, where they can fire on
 * a trigger.
 */
export const EESpawnOrderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idle") }),
  z.object({ kind: z.literal("roaming") }),
  z.object({ kind: z.literal("stand_ground") }),
  /** `orderDefendLocation(x, y)` — patrols within 1.5U of the point. */
  z.object({ kind: z.literal("defend_location"), position: EEPointRefSchema }),
]);
export type EESpawnOrder = z.infer<typeof EESpawnOrderSchema>;

/** The order kinds, for editors that need to offer them. */
export const EE_SPAWN_ORDER_KINDS = [
  "idle",
  "roaming",
  "stand_ground",
  "defend_location",
] as const;
export type EESpawnOrderKind = (typeof EE_SPAWN_ORDER_KINDS)[number];

export const EECpuShipObjectSchema = z.object({
  ...FactionedBase,
  type: z.literal("CpuShip"),
  template: z.string().min(1),
  ai: EEAiStateSchema.nullable(),
  /**
   * Null emits no order call at all, leaving EE's own default (Idle).
   *
   * `.default(null)` rather than a bare `.nullable()` because project
   * documents written before this field existed are still valid documents
   * — they simply predate the question, and the honest answer for them is
   * "no order", not a parse error that refuses to open the file.
   */
  order: EESpawnOrderSchema.nullable().default(null),
  /**
   * A comms dialogue this object answers with when hailed (ADR-0039).
   *
   * Null leaves EmptyEpsilon's own default: `comms_ship.lua` for a
   * CpuShip, `comms_station.lua` for a SpaceStation. Setting one emits
   * `setCommsScript(""):setCommsFunction(...)`, EE's own idiom, and that
   * empty string **removes the default** — a station with a dialogue no
   * longer offers restocking, repairs, supply drops or reinforcements
   * unless the dialogue offers them back through a `services` reply.
   */
  dialogueId: EEIdSchema.nullable().default(null),
});

export const EEStationObjectSchema = z.object({
  ...FactionedBase,
  type: z.literal("SpaceStation"),
  template: z.string().min(1),
  /**
   * A comms dialogue this object answers with when hailed (ADR-0039).
   *
   * Null leaves EmptyEpsilon's own default: `comms_ship.lua` for a
   * CpuShip, `comms_station.lua` for a SpaceStation. Setting one emits
   * `setCommsScript(""):setCommsFunction(...)`, EE's own idiom, and that
   * empty string **removes the default** — a station with a dialogue no
   * longer offers restocking, repairs, supply drops or reinforcements
   * unless the dialogue offers them back through a `services` reply.
   */
  dialogueId: EEIdSchema.nullable().default(null),
});

export const EEAsteroidObjectSchema = z.object({
  ...ObjectBase,
  type: z.literal("Asteroid"),
  /** `Asteroid:setSize`; EE defaults to a random 110..130 when null. */
  size: z.number().positive().nullable(),
});

export const EEVisualAsteroidObjectSchema = z.object({
  ...ObjectBase,
  type: z.literal("VisualAsteroid"),
  size: z.number().positive().nullable(),
});

export const EEPlanetObjectSchema = z.object({
  ...OrientedBase,
  type: z.literal("Planet"),
  radius: z.number().positive(),
  surfaceTexture: z.string().nullable(),
  cloudTexture: z.string().nullable(),
  atmosphereTexture: z.string().nullable(),
  atmosphereColor: z
    .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
    .nullable(),
  /** `Planet:setAxialRotationTime`, seconds per full spin. */
  axialRotationTime: z.number().positive().nullable(),
  /** `Planet:setDistanceFromMovementPlane` — cosmetic vertical offset. */
  distanceFromMovementPlane: z.number().nullable(),
  /**
   * `Planet:setOrbit(target, orbit_time)` — **seconds for one full
   * revolution**, so a *smaller* number orbits *faster*.
   *
   * Not a speed, despite EE's own doc comment ("orbital period in orbital
   * degrees per tick"), which is wrong and reaches the inspector through
   * the generated catalog. `planet.cpp` advances the body by
   * `delta / orbit_time * 360` degrees each frame, and `delta` is seconds.
   * The field's hint contradicts the catalog text on purpose.
   *
   * Zero is rejected: EE divides by it, the angle goes to infinity and the
   * planet's position to NaN. Negative is allowed and orbits retrograde.
   *
   * The emitter always writes `setPosition` before `setOrbit`, because EE
   * locks the orbital radius to the distance at the moment of the call.
   */
  orbit: z
    .preprocess(
      // `degreesPerTick` is what this key was called while we believed
      // EE's doc comment. Same number on the wire, same emitted Lua —
      // only the name was a lie — so an old project opens unchanged and
      // is rewritten under the honest name the first time it is saved.
      (value) => {
        if (
          typeof value !== "object" ||
          value === null ||
          !("degreesPerTick" in value) ||
          "orbitTimeS" in value
        ) {
          return value;
        }
        const { degreesPerTick, ...rest } = value as Record<string, unknown>;
        return { ...rest, orbitTimeS: degreesPerTick };
      },
      z
        .object({
          targetId: EEIdSchema,
          orbitTimeS: z
            .number()
            .refine((seconds) => seconds !== 0, "orbit period cannot be 0 — EE divides by it"),
        })
        .nullable(),
    ),
});

export const EENebulaObjectSchema = z.object({
  ...ObjectBase,
  type: z.literal("Nebula"),
});

export const EEMineObjectSchema = z.object({
  ...ObjectBase,
  type: z.literal("Mine"),
});

export const EEBlackHoleObjectSchema = z.object({
  ...ObjectBase,
  type: z.literal("BlackHole"),
});

export const EEWormHoleObjectSchema = z.object({
  ...ObjectBase,
  type: z.literal("WormHole"),
  /** `WormHole:setTargetPosition` — where the tunnel exits. */
  targetPosition: EEPointRefSchema,
});

export const EEArtifactObjectSchema = z.object({
  ...OrientedBase,
  type: z.literal("Artifact"),
  /**
   * A comms dialogue, as on ships and stations (ADR-0039). An Artifact has
   * no default comms script, so attaching one takes nothing away — the
   * derelict beacon that answers a hail is the reason this is here.
   */
  dialogueId: EEIdSchema.nullable().default(null),
  /** `Artifact:setModel` — a ModelData name (stock: artifact1..artifact8). */
  model: z.string().nullable(),
  spin: z.number().nullable(),
  allowPickup: z.boolean().nullable(),
  radarTraceIcon: z.string().nullable(),
  radarTraceScale: z.number().positive().nullable(),
  radarTraceColor: EEColorSchema.nullable(),
});

export const EESupplyDropObjectSchema = z.object({
  ...ObjectBase,
  type: z.literal("SupplyDrop"),
  energy: z.number().nonnegative().nullable(),
  weaponStorage: z.array(
    z.object({ weapon: EEMissileTypeSchema, amount: z.number().int().nonnegative() }),
  ),
});

export const EEScanProbeObjectSchema = z.object({
  ...ObjectBase,
  type: z.literal("ScanProbe"),
  speed: z.number().positive().nullable(),
  lifetime: z.number().positive().nullable(),
  target: EEPointRefSchema.nullable(),
  /**
   * `ScanProbe:setOwner` needs a live handle, so the only owner an authored
   * map can name is the player ship. EE crashes on `getOwner()` for an
   * unowned probe, so the emitter defaults this to true.
   */
  ownedByPlayer: z.boolean(),
});

export const EEWarpJammerObjectSchema = z.object({
  ...FactionedBase,
  type: z.literal("WarpJammer"),
  range: z.number().positive().nullable(),
  hull: z.number().positive().nullable(),
});

export const EEZoneObjectSchema = z.object({
  ...ObjectBase,
  type: z.literal("Zone"),
  /**
   * Polygon corners for `Zone:setPoints(x1,y1, x2,y2, …)`. At least three.
   * The reference claims *"New Zones can't be created via the exec.lua HTTP
   * API"*; a live probe (2026-08-09) shows they can — see
   * `docs/ee-api-reference.md` §15.2.
   */
  points: z.array(Vec2Schema).min(3),
  color: EEColorSchema.nullable(),
  label: z.string().nullable(),
});

export const EEObjectSchema = z.discriminatedUnion("type", [
  EEPlayerShipObjectSchema,
  EECpuShipObjectSchema,
  EEStationObjectSchema,
  EEAsteroidObjectSchema,
  EEVisualAsteroidObjectSchema,
  EEPlanetObjectSchema,
  EENebulaObjectSchema,
  EEMineObjectSchema,
  EEBlackHoleObjectSchema,
  EEWormHoleObjectSchema,
  EEArtifactObjectSchema,
  EESupplyDropObjectSchema,
  EEScanProbeObjectSchema,
  EEWarpJammerObjectSchema,
  EEZoneObjectSchema,
]);
export type EEObject = z.infer<typeof EEObjectSchema>;

/**
 * A named set of objects that spawn together.
 *
 * `on_start` groups are spawned by `map.spawn()`; `on_call` groups wait for
 * a `spawn_group` action, which is how enemy waves stay part of the map while
 * the narrative decides when they arrive.
 */
export const EEMapGroupSchema = z.object({
  id: EEIdSchema,
  label: z.string(),
  when: z.enum(["on_start", "on_call"]),
  objects: z.array(EEObjectSchema),
  /**
   * The sector the group is filed under, or null for **Shared**. A sector organises authoring — which part of the
   * map the author is working on — and carries no game rule: it does not change when the group spawns, and moving a
   * group between sectors changes nothing in the exported scenario. (Where a sector's contents appear *in the game*
   * is still the rules' business.)
   */
  sector: EEIdSchema.nullable().default(null),
});
export type EEMapGroup = z.infer<typeof EEMapGroupSchema>;

/**
 * A sector: a named part of the map the author works on — a star system, a place reached by a jump. Pure
 * organisation (Sector → Group → Object); the order of the list is the order the editor shows, never a spawn order.
 */
export const EESectorSchema = z.object({
  id: EEIdSchema,
  label: z.string().min(1),
});
export type EESector = z.infer<typeof EESectorSchema>;

export const EEMapSchema = z.object({
  /**
   * The author's sectors. `.default([])` so a hand-written document with none still parses; `importProject` runs
   * migration 0003, which files every group and marker of an older project under one initial sector.
   */
  sectors: z.array(EESectorSchema).default([]),
  /**
   * The sector the **game** starts in (ADR-0056) — not the one open in the editor, which is editor state. `null` is the
   * behaviour every project had before sectors meant anything in play: every *At mission start* group spawns, and
   * sectors are organisation only. With a sector chosen, only that sector's *At mission start* groups and the Shared
   * ones spawn at the start, and *Change sector* / *Current sector is …* become available. Migration `0004` writes
   * `null` explicitly into older documents.
   */
  startSector: EEIdSchema.nullable().default(null),
  groups: z.array(EEMapGroupSchema),
  /**
   * Named places, beside the groups rather than inside one (ADR-0038).
   *
   * A group decides *when its objects spawn*; a marker never spawns, so a
   * group would attach a meaning it cannot carry — and `spawn_group` on a
   * group of markers would be a no-op the author could not see through.
   *
   * `.default([])` for the same reason `order` has one: every project on
   * disk predates this list.
   */
  markers: z.array(EEMarkerSchema).default([]),
});
export type EEMap = z.infer<typeof EEMapSchema>;

// ---------------------------------------------------------------------------
// Content definitions: factions, models, ship templates
// ---------------------------------------------------------------------------

export const EEFactionDefSchema = z.object({
  id: EEIdSchema,
  /** `FactionInfo:setName` — what `setFaction` will reference. */
  name: z.string().min(1),
  localeName: z.string().nullable(),
  gmColor: EEColorSchema.nullable(),
  description: z.string().nullable(),
  /**
   * Faction names (stock or project-defined) this faction treats as hostile
   * or friendly. EE reciprocates automatically, so declaring one side is
   * enough — the emitter does not write the mirror call.
   */
  enemies: z.array(z.string()),
  friends: z.array(z.string()),
});
export type EEFactionDef = z.infer<typeof EEFactionDefSchema>;

export const EEModelDefSchema = z.object({
  id: EEIdSchema,
  /** `ModelData:setName` — referenced by `ShipTemplate:setModel`. */
  name: z.string().min(1),
  mesh: z.string().min(1),
  texture: z.string().nullable(),
  specular: z.string().nullable(),
  illumination: z.string().nullable(),
  scale: z.number().positive().nullable(),
  /** Collision + render radius in EE game units. */
  radius: z.number().positive().nullable(),
  collisionBox: z.tuple([z.number(), z.number()]).nullable(),
  renderOffset: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  beamPositions: z.array(z.tuple([z.number(), z.number(), z.number()])),
  tubePositions: z.array(z.tuple([z.number(), z.number(), z.number()])),
  engineEmitters: z.array(
    z.object({
      position: z.tuple([z.number(), z.number(), z.number()]),
      color: EEColorSchema,
      scale: z.number().positive(),
    }),
  ),
});
export type EEModelDef = z.infer<typeof EEModelDefSchema>;

/** One `ShipTemplate:setBeamWeapon(index, arc, direction, range, cycle, damage)`. */
export const EEBeamDefSchema = z.object({
  index: z.number().int().min(0).max(15),
  arc: z.number(),
  direction: z.number(),
  range: z.number().nonnegative(),
  cycleTime: z.number().nonnegative(),
  damage: z.number().nonnegative(),
  /** `setBeamWeaponTurret(index, arc, direction, rotation_rate)`. */
  turret: z
    .object({ arc: z.number(), direction: z.number(), rotationRate: z.number() })
    .nullable(),
  /** `setBeamTexture` — path under `resources/`, e.g. `beam_orange.png`. */
  texture: z.string().nullable(),
  /** `setBeamWeaponEnergyPerFire`. */
  energyPerFire: z.number().nullable(),
  /** `setBeamWeaponHeatPerFire`. */
  heatPerFire: z.number().nullable(),
});
export type EEBeamDef = z.infer<typeof EEBeamDefSchema>;

/**
 * Per-tube settings, one record per tube index.
 *
 * EE's own templates write a tube as a single chained line —
 * `setTubeDirection(0,0):setTubeSize(0,"small"):setTubeLoadTime(0,6)` — so
 * one record per tube is the shape the author already thinks in, and the
 * one the editor can render as a row.
 */
export const EETubeDefSchema = z.object({
  index: z.number().int().min(0).max(15),
  /** `setTubeDirection`, degrees relative to the hull. */
  direction: z.number().nullable(),
  /** `setTubeLoadTime` — overrides the template-wide load time. */
  loadTime: z.number().positive().nullable(),
  /** `setTubeSize`. */
  size: EEMissileSizeSchema.nullable(),
  /**
   * `setWeaponTubeExclusiveFor` — clears every other type, so it is applied
   * before `allow`, which is how EE's own templates chain the two.
   */
  exclusiveFor: EEMissileTypeSchema.nullable(),
  /** `weaponTubeAllowMissle` entries. */
  allow: z.array(EEMissileTypeSchema),
  /** `weaponTubeDisallowMissle` entries. */
  disallow: z.array(EEMissileTypeSchema),
});
export type EETubeDef = z.infer<typeof EETubeDefSchema>;

/** `addRoomSystem(x, y, w, h, system)` / `addRoom(x, y, w, h)`. */
export const EERoomDefSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Null renders as `addRoom` (a corridor with no system). */
  system: ShipSystemNameSchema.nullable(),
});
export type EERoomDef = z.infer<typeof EERoomDefSchema>;

export const EEDoorDefSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  horizontal: z.boolean(),
});
export type EEDoorDef = z.infer<typeof EEDoorDefSchema>;

/**
 * Every field of an EE `ShipTemplate`, without the identity a project adds.
 *
 * Split out because the install library describes a **stock** ship with
 * exactly this shape (`EETemplateRefSchema`). One definition of "a ship
 * template" means copying a stock hull into a project is a spread rather
 * than a mapping layer that can drift from the form that edits it — and
 * `TEMPLATE_FIELDS`' coverage test then guards both at once.
 */
export const EE_SHIP_TEMPLATE_FIELDS = {
  name: z.string().min(1),
  localeName: z.string().nullable(),
  kind: EETemplateKindSchema,
  className: z.string().nullable(),
  subclassName: z.string().nullable(),
  description: z.string().nullable(),
  model: z.string().nullable(),
  radarTrace: z.string().nullable(),
  hull: z.number().positive().nullable(),
  /** One entry per shield arc — emitted as the variadic `setShields(...)`. */
  shields: z.array(z.number().nonnegative()),
  speed: z
    .object({
      impulse: z.number().nonnegative(),
      turn: z.number().nonnegative(),
      acceleration: z.number().nonnegative(),
      reverseSpeed: z.number().nonnegative().nullable(),
      reverseAcceleration: z.number().nonnegative().nullable(),
    })
    .nullable(),
  combatManeuver: z
    .object({ boost: z.number().nonnegative(), strafe: z.number().nonnegative() })
    .nullable(),
  warpSpeed: z.number().nonnegative().nullable(),
  jumpDrive: z
    .object({
      enabled: z.boolean(),
      minRange: z.number().nonnegative().nullable(),
      maxRange: z.number().nonnegative().nullable(),
    })
    .nullable(),
  cloaking: z.boolean().nullable(),
  energyStorage: z.number().positive().nullable(),
  repairCrewCount: z.number().int().nonnegative().nullable(),
  beams: z.array(EEBeamDefSchema),
  tubes: z
    .object({
      /** `setTubes(amount, load_time)` — the template-wide defaults. */
      count: z.number().int().min(0).max(16),
      loadTime: z.number().positive(),
      /** Per-tube overrides, indexed from 0. Sparse is fine. */
      perTube: z.array(EETubeDefSchema),
    })
    .nullable(),
  weaponStorage: z.array(
    z.object({ weapon: EEMissileTypeSchema, amount: z.number().int().nonnegative() }),
  ),
  rooms: z.array(EERoomDefSchema),
  doors: z.array(EEDoorDefSchema),
  longRangeRadarRange: z.number().positive().nullable(),
  shortRangeRadarRange: z.number().positive().nullable(),
  defaultAI: EEAiStateSchema.nullable(),
  /**
   * Docking: the *classes this template accepts* — `setClass`'s first
   * argument on the other ship, not its template name. Both lists are
   * variadic in EE, so an empty one emits nothing.
   *
   * There used to be a third, `dockClasses`, on the belief that
   * `setDockClasses` was a general list the external/internal pair refined.
   * It is not: `ShipTemplate::setDockClasses` assigns
   * `external_dock_classes`, the very member `setExternalDockClasses`
   * assigns, and no `dock_classes` member exists. Two fields, one value —
   * and the emitter wrote both in order, so the second silently won. The
   * old key is merged into `externalDockClasses` on read.
   */
  externalDockClasses: z.array(z.string().min(1)),
  internalDockClasses: z.array(z.string().min(1)),
  /** `setSharesEnergyWithDocked`. */
  sharesEnergyWithDocked: z.boolean().nullable(),
  /** `setRepairDocked`. */
  repairDocked: z.boolean().nullable(),
  /** `setRestocksScanProbes`. */
  restocksScanProbes: z.boolean().nullable(),
  /** `setRestocksMissilesDocked` — applies to docking CpuShips, not players. */
  restocksMissilesDocked: z.boolean().nullable(),
  /** `setImpulseSoundFile` — path under `resources/`, e.g. `sfx/engine.wav`. */
  impulseSoundFile: z.string().nullable(),
  /**
   * Crew capabilities. Null leaves EE's default for the template type; the
   * setters exist so a template can take a capability *away* (a freighter
   * with no self-destruct, a courier that cannot hack).
   */
  canScan: z.boolean().nullable(),
  canHack: z.boolean().nullable(),
  canDock: z.boolean().nullable(),
  canCombatManeuver: z.boolean().nullable(),
  canSelfDestruct: z.boolean().nullable(),
  canLaunchProbe: z.boolean().nullable(),
  /** Emits `hidden()` — keeps the template out of EE's pickers. */
  hidden: z.boolean(),
} as const;

export const EETemplateDefSchema = z.preprocess(
  // `dockClasses` and `externalDockClasses` were modelled as two fields
  // while we believed EE had two members. Merging on read keeps an existing
  // project opening unchanged, and it is a merge rather than a rename
  // because a document may legitimately hold both.
  (value) => {
    if (typeof value !== "object" || value === null || !("dockClasses" in value)) return value;
    const { dockClasses, ...rest } = value as Record<string, unknown>;
    const legacy = Array.isArray(dockClasses) ? (dockClasses as unknown[]) : [];
    const external = Array.isArray(rest["externalDockClasses"])
      ? (rest["externalDockClasses"] as unknown[])
      : [];
    return { ...rest, externalDockClasses: [...new Set([...external, ...legacy])] };
  },
  z.object({
    id: EEIdSchema,
    /**
     * A variant of another template **this same project defines**, emitted
     * as `<base_local>:copy("<name>")`.
     *
     * Never a stock template: EE exposes no `getShipTemplate()` (verified
     * against both the registered script functions and a live `_G` dump),
     * so `copy()` can only chain off a Lua local earlier in the same file.
     * Starting from a stock hull means materialising its full definition —
     * see ADR-0041.
     */
    copyOf: z.string().nullable(),
    ...EE_SHIP_TEMPLATE_FIELDS,
  }),
);
export type EETemplateDef = z.infer<typeof EETemplateDefSchema>;

// ---------------------------------------------------------------------------
// Logic: predicates, actions, beats, rules
// ---------------------------------------------------------------------------

/** What an action or predicate points at. */
export const EETargetRefSchema = z.discriminatedUnion("ref", [
  z.object({ ref: z.literal("player") }),
  z.object({ ref: z.literal("object"), objectId: EEIdSchema }),
  z.object({ ref: z.literal("group"), groupId: EEIdSchema }),
]);
export type EETargetRef = z.infer<typeof EETargetRefSchema>;

/**
 * Predicates are evaluated every tick and fire on the rising edge (false →
 * true). They serve both as a rule's trigger and as its extra guards, which
 * keeps one evaluation path instead of two.
 */
export const EEPredicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("always") }),
  /** Scenario clock, seconds since start. */
  z.object({ kind: z.literal("elapsed"), seconds: z.number().nonnegative() }),
  z.object({ kind: z.literal("object_destroyed"), objectId: EEIdSchema }),
  z.object({ kind: z.literal("group_destroyed"), groupId: EEIdSchema }),
  /** Uses EE's own `Zone:isInside(player)` — no point-in-polygon of our own. */
  z.object({ kind: z.literal("player_in_zone"), zoneId: EEIdSchema }),
  z.object({
    kind: z.literal("player_near_object"),
    objectId: EEIdSchema,
    distance: z.number().positive(),
  }),
  z.object({
    kind: z.literal("player_near_point"),
    position: EEPointRefSchema,
    distance: z.number().positive(),
  }),
  /** Hull fraction 0..1 of the player ship. */
  z.object({ kind: z.literal("player_hull_below"), fraction: z.number().min(0).max(1) }),
  z.object({
    kind: z.literal("player_system_below"),
    system: ShipSystemNameSchema,
    fraction: z.number().min(-1).max(1),
  }),
  z.object({
    kind: z.literal("object_scanned"),
    objectId: EEIdSchema,
    /** True requires a full scan rather than a simple one. */
    full: z.boolean(),
  }),
  z.object({
    kind: z.literal("variable_equals"),
    name: z.string().min(1),
    value: EEVariableValueSchema,
  }),
  z.object({
    kind: z.literal("variable_at_least"),
    name: z.string().min(1),
    value: z.number(),
  }),
  /**
   * A variable declared on one object. Reads a single object rather than a
   * group: "any member" and "every member" are different questions, and
   * guessing which one an author meant is worse than making them say.
   */
  z.object({
    kind: z.literal("object_variable_equals"),
    objectId: EEIdSchema,
    name: z.string().min(1),
    value: EEVariableValueSchema,
  }),
  z.object({
    kind: z.literal("object_variable_at_least"),
    objectId: EEIdSchema,
    name: z.string().min(1),
    value: z.number(),
  }),
  /** The sector the game is in right now (ADR-0056); needs a start sector. */
  z.object({ kind: z.literal("current_sector"), sectorId: EEIdSchema }),
]);
export type EEPredicate = z.infer<typeof EEPredicateSchema>;
export type EEPredicateInput = z.input<typeof EEPredicateSchema>;

/** The predicate union referenced by name where it nests; see {@link VanillaActionRef}. */
const PredicateRef: z.ZodType<EEPredicate, z.ZodTypeDef, EEPredicateInput> = EEPredicateSchema;

/**
 * Actions come in two tiers. Everything below `exodus_*` is plain EE and is
 * always available; the `exodus_*` variants require `requires: ["exodus"]` on
 * the project and are otherwise rejected at validation time, which is what
 * keeps default output provably vanilla (ADR-0034 §4).
 */
/** Keeps a tuple's type, so two option lists can be spread into one discriminated union. */
function options<T extends [z.ZodDiscriminatedUnionOption<"kind">, ...z.ZodDiscriminatedUnionOption<"kind">[]]>(
  ...items: T
): T {
  return items;
}

const vanillaActionOptions = options(
  z.object({
    kind: z.literal("global_message"),
    text: z.string(),
    timeoutS: z.number().positive().nullable(),
  }),
  z.object({ kind: z.literal("banner"), text: z.string() }),
  z.object({
    kind: z.literal("ship_log"),
    text: z.string(),
    color: EELogColorSchema,
  }),
  z.object({ kind: z.literal("gm_message"), text: z.string() }),
  z.object({ kind: z.literal("play_sound"), file: z.string().min(1) }),
  z.object({ kind: z.literal("spawn_group"), groupId: EEIdSchema }),
  z.object({ kind: z.literal("destroy"), target: EETargetRefSchema }),
  /**
   * Swap what an object says when hailed, mid-scenario (ADR-0039). Null
   * restores EmptyEpsilon's own default script for that class — which is
   * how a station gets its service menu back after the story moment that
   * borrowed it.
   */
  z.object({
    kind: z.literal("set_dialogue"),
    target: EETargetRefSchema,
    dialogueId: EEIdSchema.nullable(),
  }),
  /**
   * `SpaceObject:sendCommsMessage(player, text)` — the object hails the
   * ship rather than waiting to be hailed. Relay may refuse or ignore it,
   * which is why EE returns a boolean; the emitted call drops that answer,
   * because a scenario that branched on "did they pick up" would need a
   * retry policy this model does not have.
   */
  z.object({
    kind: z.literal("hail_player"),
    objectId: EEIdSchema,
    // `z.string()`, like the other message actions: a blank one is a
    // half-written beat, not an invalid document.
    text: z.string(),
  }),
  z.object({
    kind: z.literal("set_variable"),
    name: z.string().min(1),
    value: EEVariableValueSchema,
  }),
  z.object({
    kind: z.literal("add_variable"),
    name: z.string().min(1),
    delta: z.number(),
  }),
  /**
   * Write a variable on whatever the target resolves to. A group target
   * writes to every member — "mark the whole wing as alerted" is the case
   * that makes object variables worth having.
   */
  z.object({
    kind: z.literal("set_object_variable"),
    target: EETargetRefSchema,
    name: z.string().min(1),
    value: EEVariableValueSchema,
  }),
  z.object({
    kind: z.literal("add_object_variable"),
    target: EETargetRefSchema,
    name: z.string().min(1),
    delta: z.number(),
  }),
  z.object({
    kind: z.literal("set_ai"),
    target: EETargetRefSchema,
    ai: EEAiStateSchema,
  }),
  /**
   * AI orders: one action per `CpuShip:order*` method, each carrying exactly
   * the parameters that order takes.
   *
   * A single `order` action with optional `position` and `objectId` cannot
   * express `orderFlyFormation`, which needs an object **and** an offset —
   * and it forced every form to show fields most orders ignore, with the
   * mismatch only caught at build time. A tagged record per order says what
   * it needs in its own shape, which is the same reason the rest of this
   * schema uses discriminated unions.
   *
   * All twelve keep a `target`, so an order goes to one ship or a whole
   * wing without changing form.
   */
  z.object({ kind: z.literal("order_idle"), target: EETargetRefSchema }),
  z.object({ kind: z.literal("order_roaming"), target: EETargetRefSchema }),
  z.object({ kind: z.literal("order_stand_ground"), target: EETargetRefSchema }),
  z.object({
    kind: z.literal("order_roaming_at"),
    target: EETargetRefSchema,
    position: EEPointRefSchema,
  }),
  z.object({
    kind: z.literal("order_defend_location"),
    target: EETargetRefSchema,
    position: EEPointRefSchema,
  }),
  z.object({
    kind: z.literal("order_fly_towards"),
    target: EETargetRefSchema,
    position: EEPointRefSchema,
  }),
  z.object({
    kind: z.literal("order_fly_towards_blind"),
    target: EETargetRefSchema,
    position: EEPointRefSchema,
  }),
  z.object({
    kind: z.literal("order_attack"),
    target: EETargetRefSchema,
    objectId: EEIdSchema,
  }),
  z.object({
    kind: z.literal("order_dock"),
    target: EETargetRefSchema,
    objectId: EEIdSchema,
  }),
  z.object({
    kind: z.literal("order_retreat"),
    target: EETargetRefSchema,
    objectId: EEIdSchema,
  }),
  z.object({
    kind: z.literal("order_defend_target"),
    target: EETargetRefSchema,
    objectId: EEIdSchema,
  }),
  /** `orderFlyFormation(object, offset_x, offset_y)` — the one that needs both. */
  z.object({
    kind: z.literal("order_fly_formation"),
    target: EETargetRefSchema,
    leaderId: EEIdSchema,
    offset: Vec2Schema,
  }),
  z.object({
    kind: z.literal("set_hull"),
    target: EETargetRefSchema,
    value: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("damage_hull"),
    target: EETargetRefSchema,
    amount: z.number().positive(),
  }),
  z.object({
    kind: z.literal("set_system_health"),
    target: EETargetRefSchema,
    system: ShipSystemNameSchema,
    value: z.number().min(-1).max(1),
  }),
  z.object({
    kind: z.literal("set_system_heat"),
    target: EETargetRefSchema,
    system: ShipSystemNameSchema,
    value: z.number().min(0).max(1),
  }),
  z.object({ kind: z.literal("set_alert_level"), level: AlertLevelSchema }),
  z.object({ kind: z.literal("victory"), faction: z.string().min(1) }),
  z.object({ kind: z.literal("pause_game") }),
  /**
   * Leave the current sector for another (ADR-0056): its objects are unloaded (never "destroyed"), the destination's
   * *At mission start* groups are created from their initial settings, and the same player ship is placed at the
   * arrival marker. `rotation` null keeps the ship's own heading. The marker must belong to the destination sector.
   * Variables, fired rules and the clock are not reset.
   */
  z.object({
    kind: z.literal("change_sector"),
    sectorId: EEIdSchema,
    arrivalMarkerId: EEIdSchema,
    rotation: z.number().nullable(),
  }),
  /**
   * Write a campaign checkpoint now (ADR-0058): the state of the active sector, of every visited one and of the campaign, into the engine's
   * ScriptStorage. Needs campaign saves to be on for the project. A checkpoint is also written when a new campaign starts and whenever a
   * Change sector completes; the crew can add one with the *Save checkpoint* button.
   */
  z.object({ kind: z.literal("save_checkpoint") }),
);

export const EEVanillaActionSchema = z.discriminatedUnion("kind", vanillaActionOptions);
export type EEVanillaAction = z.infer<typeof EEVanillaActionSchema>;
export type EEVanillaActionInput = z.input<typeof EEVanillaActionSchema>;

/**
 * The vanilla union, referenced by name at the many places it nests. The
 * annotation is not decoration: left inferred, every use re-expands the whole
 * union into the emitted declarations and TypeScript gives up (TS7056).
 */
const VanillaActionRef: z.ZodType<EEVanillaAction, z.ZodTypeDef, EEVanillaActionInput> =
  EEVanillaActionSchema;

/**
 * What stands in for an EXODUS action when the extension is not there.
 *
 * Vanilla EE has no puzzle panel, no lore terminal, no cipher — so the
 * author decides what the crew gets instead. Never inferred: an action with
 * no alternative recorded (`null`) is *undecided*, and a build that claims to
 * be vanilla-complete refuses it and lists it.
 *
 * - `none`      — deliberately nothing (fine for flavour, not for progress).
 * - `immediate` — run these plain-EE actions at once (a comms/log line, a
 *                 `set_dialogue` that hands the crew a conversation, …).
 * - `wait`      — run them after a delay.
 * - `gm`        — tell the GM and add a GM button; the actions run when the
 *                 GM presses it.
 */
export const EEExodusAlternativeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("immediate"), actions: z.array(VanillaActionRef) }),
  z.object({
    kind: z.literal("wait"),
    seconds: z.number().positive(),
    actions: z.array(VanillaActionRef),
  }),
  z.object({
    kind: z.literal("gm"),
    label: z.string().min(1),
    message: z.string(),
    actions: z.array(VanillaActionRef),
  }),
]);
export type EEExodusAlternative = z.infer<typeof EEExodusAlternativeSchema>;

/**
 * Every EXODUS action may name a *step* (ADR-0049): the record, in
 * `logic.exodusSteps`, of what replaces it without EXODUS and whether the
 * mission depends on it. `null` means the author has not decided — which is
 * different from deciding "nothing". Steps live in one table rather than
 * inside each action so a step used from two places has one fallback, and so
 * the action union does not carry the whole vanilla union inside itself.
 */
const exodusCommon = {
  stepId: EEIdSchema.nullable().default(null),
} as const;

const exodusActionOptions = options(
  z.object({
    kind: z.literal("exodus_event"),
    ...exodusCommon,
    eventType: z.string().min(1),
    /** JSON object literal, emitted verbatim into the Lua payload table. */
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("exodus_puzzle"),
    ...exodusCommon,
    puzzleId: z.string().min(1),
    role: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
    timeoutS: z.number().positive().nullable(),
  }),
  z.object({ kind: z.literal("exodus_action"),
    ...exodusCommon, actionId: z.string().min(1) }),
  z.object({
    kind: z.literal("exodus_lore"),
    ...exodusCommon,
    fragmentId: z.string().min(1),
    /**
     * `bridge:lore_drop`'s second argument — which station found it. Null
     * leaves the fragment unattributed, which is how EE-side lore with no
     * discoverer reads.
     */
    foundBy: z.string().nullable(),
  }),
  /**
   * `bridge:emit_encrypted_comms` — NOT the same as emitting a
   * `comms_received` event with `encoded: true`. The Lua helper looks up
   * the rotating codeword for the (channel, sender) pair and enciphers the
   * text before it leaves the scenario, so the plaintext never travels.
   * Modelled separately for exactly that reason.
   */
  z.object({
    kind: z.literal("exodus_encrypted_comms"),
    ...exodusCommon,
    channel: z.string().min(1),
    from: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("exodus_set_state"),
    ...exodusCommon,
    key: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    kind: z.literal("exodus_complete_chapter"),
    ...exodusCommon,
    nextChapterId: z.string().nullable(),
  }),
);

export const EEActionSchema = z.discriminatedUnion("kind", [
  ...vanillaActionOptions,
  ...exodusActionOptions,
]);
export type EEAction = z.infer<typeof EEActionSchema>;
export type EEActionInput = z.input<typeof EEActionSchema>;

/** The action union referenced by name where it nests; see {@link VanillaActionRef}. */
const ActionRef: z.ZodType<EEAction, z.ZodTypeDef, EEActionInput> = EEActionSchema;

// ---------------------------------------------------------------------------
// Dialogues
// ---------------------------------------------------------------------------

/**
 * Where a reply leads (ADR-0039).
 *
 * A tagged record rather than a nullable node id plus two flags, for the
 * reason the rest of this schema gives: a field only one variant reads is
 * a field every form has to explain away.
 */
export const EEReplyTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), nodeId: EEIdSchema }),
  /** `commsSwitchToGM()` — hands the conversation to the GM console. */
  z.object({ kind: z.literal("gm") }),
  /**
   * Hands off to EmptyEpsilon's own station menu — restocking, repairs,
   * supply drops, reinforcements. Only meaningful on a SpaceStation, and
   * the build warns when it appears anywhere else.
   */
  z.object({ kind: z.literal("services") }),
]);
export type EEReplyTarget = z.infer<typeof EEReplyTargetSchema>;

export const EEDialogueReplySchema = z.object({
  /** The button's text. */
  text: z.string().min(1),
  target: EEReplyTargetSchema,
  /** ANDed. The reply is offered only when every one is true. */
  conditions: z.array(PredicateRef),
  /** Run when the player picks it, before the conversation moves on. */
  actions: z.array(ActionRef),
});
export type EEDialogueReply = z.infer<typeof EEDialogueReplySchema>;

export const EEDialogueNodeSchema = z.object({
  id: EEIdSchema,
  /** What the object says here — `setCommsMessage`. */
  text: z.string(),
  /**
   * The buttons offered. **A node with no replies is the end of the
   * conversation**: the player reads it and closes the window, which is
   * how EmptyEpsilon's own comms scripts finish. There is deliberately no
   * "close" target — a farewell line reads better than a window that
   * vanishes, and modelling it as a terminal node means the author writes
   * that line.
   */
  replies: z.array(EEDialogueReplySchema),
});
export type EEDialogueNode = z.infer<typeof EEDialogueNodeSchema>;

/**
 * A comms conversation, as a **graph of nodes** rather than a nested tree.
 *
 * Every comms script EmptyEpsilon ships ends its branches with a "Back"
 * that returns to the main menu; a tree cannot express that without
 * copying the menu into every branch. Flat nodes with jumps can, they edit
 * in a table like rules and beats, and they diff.
 */
export const EEDialogueSchema = z.object({
  id: EEIdSchema,
  label: z.string().min(1),
  /** The node shown when the object is first hailed. */
  entry: EEIdSchema,
  nodes: z.array(EEDialogueNodeSchema),
});
export type EEDialogue = z.infer<typeof EEDialogueSchema>;

/** A time-keyed story beat. The emitted scheduler walks these in order. */
export const EEBeatSchema = z.object({
  id: EEIdSchema,
  label: z.string(),
  /** Seconds from scenario start — or, for a beat scoped to a sector, seconds of that sector's own clock (it advances only while the sector is the active one). */
  at: z.number().nonnegative(),
  /**
   * The sector this beat belongs to (ADR-0058), or `null`: a global beat, which keeps the meaning every beat had before — it runs on the
   * campaign clock whatever sector is active. Never inferred; the author chooses it.
   */
  sector: EEIdSchema.nullable().default(null),
  actions: z.array(ActionRef),
});
export type EEBeat = z.infer<typeof EEBeatSchema>;

export const EERuleSchema = z.object({
  id: EEIdSchema,
  label: z.string(),
  /** Fires on the rising edge of `when`. */
  when: PredicateRef,
  /** ANDed with `when`. Empty means no extra guard. */
  conditions: z.array(PredicateRef),
  /** False re-arms the rule after it fires. */
  once: z.boolean(),
  /**
   * The sector this rule belongs to (ADR-0058), or `null`: a global rule, evaluated whatever sector is active, exactly as before. A scoped rule is
   * evaluated only while its sector is the active one, `elapsed` conditions in it use that sector's clock, and its state (fired, edge) is saved with
   * the sector. Never inferred from a *Current sector is* condition.
   */
  sector: EEIdSchema.nullable().default(null),
  actions: z.array(ActionRef),
});
export type EERule = z.infer<typeof EERuleSchema>;

/**
 * What the mission does about one EXODUS step when the extension is not
 * available. See {@link EEExodusAlternativeSchema}.
 *
 * `essential` — the mission's progress depends on the step having an
 * outcome; `alternative` — what produces that outcome without EXODUS (`null`
 * = undecided); `onSuccess` — what the mission gains once the step settles,
 * by EXODUS or by the alternative, run exactly once either way. That single
 * settlement is what keeps a late EXODUS answer from paying out twice.
 *
 * What "succeeds" means depends on who settled it, and the runtime records it:
 * `service` — the service reported solved/bypassed (puzzles only);
 * `handoff` — the request was written to the scenario's event queue for the
 * service; the service has NOT confirmed it did anything (every other EXODUS
 * action); `alternative` — the author's alternative ran.
 *
 * `answerWithinS` — the author's per-request deadline: scenario seconds, from
 * the moment a request that expects an answer is handed to a *live* service,
 * after which the step passes to its alternative and a later answer is
 * ignored. `null` = no deadline (wait while the service is alive). It is not
 * the heartbeat timeout (the service itself is judged by that), and not the
 * puzzle's own `timeoutS` (how long the crew may play it).
 */
export const EEExodusStepSchema = z.object({
  id: EEIdSchema,
  essential: z.boolean(),
  alternative: EEExodusAlternativeSchema.nullable(),
  answerWithinS: z.number().positive().nullable().default(null),
  onSuccess: z.array(VanillaActionRef),
});
export type EEExodusStep = z.infer<typeof EEExodusStepSchema>;


/**
 * A button on EE's GM console (`addGMFunction`). Modelled separately from
 * rules because it is an event source, not a predicate — and because the
 * reference notes GM functions work only from a scenario script, never over
 * the HTTP API.
 */
export const EEGmButtonSchema = z.object({
  id: EEIdSchema,
  label: z.string().min(1),
  actions: z.array(ActionRef),
});
export type EEGmButton = z.infer<typeof EEGmButtonSchema>;

export const EEVariableSchema = z.object({
  name: z.string().min(1),
  initial: EEVariableValueSchema,
});
export type EEVariable = z.infer<typeof EEVariableSchema>;

export const EELogicSchema = z.object({
  variables: z.array(EEVariableSchema),
  beats: z.array(EEBeatSchema),
  rules: z.array(EERuleSchema),
  gmButtons: z.array(EEGmButtonSchema),
  /**
   * `.default([])` for the same reason `order` and `markers` have one:
   * every project document on disk predates this list, and a schema
   * addition should not become a migration.
   */
  dialogues: z.array(EEDialogueSchema).default([]),
  /** Without-EXODUS alternatives, one per named EXODUS step (ADR-0049). */
  exodusSteps: z.array(EEExodusStepSchema).default([]),
});
export type EELogic = z.infer<typeof EELogicSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/**
 * Version of the project document format (not of EmptyEpsilon).
 *
 * Bump it, and add a step to `@forge/core`'s migration table, whenever a
 * change cannot be read from an older document by `.default()` alone.
 * Documents written before versioning carry no field and are version 0.
 */
export const PROJECT_SCHEMA_VERSION = 5;

/**
 * Campaign saves (ADR-0058). `persistence` is the project's opt-in: when true the generated scenario can keep the state of every sector and
 * of the campaign in the engine's ScriptStorage and resume it after a restart. Off by default — and then the generated Lua is what it was.
 */
export const EECampaignSchema = z.object({
  persistence: z.boolean().default(false),
});
export type EECampaign = z.infer<typeof EECampaignSchema>;

export const EEProjectSchema = z.object({
  /**
   * Document format version. `.default` lets an unversioned file parse
   * directly (0 → 1 is additive); `importProject` is the path that reports
   * the migration, and refuses a document newer than this build.
   */
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION).default(PROJECT_SCHEMA_VERSION),
  id: EEIdSchema,
  /** Shown in EE's scenario picker via the generated `-- Name:` header. */
  name: z.string().min(1),
  description: z.string(),
  /** EE build this project targets, e.g. `EE-2024.12.08`. */
  eeVersion: z.string().min(1),
  /**
   * Optional extensions the project uses. `exodus` unlocks the `exodus_*`
   * actions; whether the exported scenario then carries EXODUS code
   * (integrated) or only the author's alternatives (vanilla) is the export's
   * mode, not the document's (ADR-0049). Absent by default, so a fresh
   * project produces plain-EE output.
   */
  requires: z.array(z.enum(["exodus"])),
  factions: z.array(EEFactionDefSchema),
  models: z.array(EEModelDefSchema),
  templates: z.array(EETemplateDefSchema),
  map: EEMapSchema,
  logic: EELogicSchema,
  /** Campaign saves (ADR-0058); migration 0005 writes `persistence: false` into older documents. */
  campaign: EECampaignSchema.default({ persistence: false }),
  /**
   * Fields a document held that this schema does not model, keyed by a
   * stable path (`map.groups[core].objects[atlantis].hull`). Import moves
   * them here instead of letting Zod strip them, so opening and saving a
   * project written by another revision never deletes data. Nothing reads
   * them; they are carried, not interpreted.
   */
  unmodelled: z.record(z.string(), z.unknown()).default({}),
});
export type EEProject = z.infer<typeof EEProjectSchema>;

/** Blank project, per the `empty<Name>()` convention in schema-conventions.md. */
export function emptyEEProject(id: string, name: string): EEProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name,
    description: "",
    eeVersion: "EE-2026.09.22PR",
    requires: [],
    factions: [],
    models: [],
    templates: [],
    map: { sectors: [], startSector: null, groups: [], markers: [] },
    logic: { variables: [], beats: [], rules: [], gmButtons: [], dialogues: [], exodusSteps: [] },
    campaign: { persistence: false },
    unmodelled: {},
  };
}
