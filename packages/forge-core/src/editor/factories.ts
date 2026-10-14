import { emptyEEProject } from "@forge/contracts";
import type {
  EEBeamDef,
  EEMarker,
  EEObject,
  EEProject,
  EETemplateDef,
  EETemplateRef,
  EETubeDef,
  SpawnableClass,
  Vec2,
} from "@forge/contracts";
import { nextCallsign } from "./callsigns.js";

/**
 * Blank objects for the editor's palette.
 *
 * Every nullable field is spelled out rather than omitted: the project
 * schema uses `.nullable()` (always present, may be null) rather than
 * `.optional()`, per `docs/schema-conventions.md`, so a partial object
 * would fail validation on save.
 *
 * Defaults are chosen to be *immediately valid in EE* — a placed CpuShip
 * references a stock template and a stock faction, so a fresh project
 * builds and loads without the author filling anything in first.
 */

export interface CreateObjectOptions {
  readonly callsign?: string | null;
  readonly faction?: string;
  readonly template?: string;
}

const DEFAULT_FACTION = "Human Navy";

/** Stock templates that exist in every EE install. */
const DEFAULT_TEMPLATES: Record<"PlayerSpaceship" | "CpuShip" | "SpaceStation", string> = {
  PlayerSpaceship: "Atlantis",
  CpuShip: "Phobos T3",
  SpaceStation: "Medium Station",
};

export function createObject(
  type: SpawnableClass,
  id: string,
  position: Vec2,
  options: CreateObjectOptions = {},
): EEObject {
  const callsign = options.callsign ?? null;
  const faction = options.faction ?? DEFAULT_FACTION;
  // `variables` starts empty and NOT `as const`: an object's variables are
  // declared by the author, and the schema's array is mutable.
  const base = { id, callsign, position, description: null, variables: [] };
  const oriented = { ...base, rotation: null } as const;

  switch (type) {
    case "PlayerSpaceship":
      return {
        ...oriented,
        faction,
        type,
        template: options.template ?? DEFAULT_TEMPLATES.PlayerSpaceship,
      };
    case "CpuShip":
      return {
        ...oriented,
        faction,
        type,
        template: options.template ?? DEFAULT_TEMPLATES.CpuShip,
        ai: null,
        // Roaming, not EE's Idle. A newly placed ship that stands
        // motionless through the whole scenario reads as a broken build,
        // not as a deliberate choice, and Idle is one click away for the
        // authors who do want a derelict. This is the only default here
        // that departs from EE's own — see docs/authoring/ee-forge.md.
        order: { kind: "roaming" },
        dialogueId: null,
      };
    case "SpaceStation":
      return {
        ...oriented,
        faction,
        type,
        template: options.template ?? DEFAULT_TEMPLATES.SpaceStation,
        dialogueId: null,
      };
    case "Asteroid":
    case "VisualAsteroid":
      return { ...base, type, size: null };
    case "Planet":
      return {
        ...oriented,
        type,
        radius: 2000,
        surfaceTexture: null,
        cloudTexture: null,
        atmosphereTexture: null,
        atmosphereColor: null,
        axialRotationTime: null,
        distanceFromMovementPlane: null,
        orbit: null,
      };
    case "Nebula":
    case "Mine":
    case "BlackHole":
      return { ...base, type };
    case "WormHole":
      return {
        ...base,
        type,
        targetPosition: {
          ref: "point",
          position: { x: position.x + 20000, y: position.y },
        },
      };
    case "Artifact":
      return {
        ...oriented,
        type,
        model: null,
        spin: null,
        allowPickup: null,
        radarTraceIcon: null,
        radarTraceScale: null,
        radarTraceColor: null,
        dialogueId: null,
      };
    case "SupplyDrop":
      return { ...base, type, energy: null, weaponStorage: [] };
    case "ScanProbe":
      // EE hard-faults on getOwner() for an unowned probe, so an authored
      // probe is owned by the player unless the author says otherwise.
      return { ...base, type, speed: null, lifetime: null, target: null, ownedByPlayer: true };
    case "WarpJammer":
      return { ...oriented, faction, type, range: null, hull: null };
    case "Zone": {
      // A 4U square centred on the click, so a fresh zone is visible and
      // draggable straight away rather than a degenerate point.
      const half = 2000;
      return {
        ...base,
        type,
        points: [
          { x: position.x - half, y: position.y - half },
          { x: position.x + half, y: position.y - half },
          { x: position.x + half, y: position.y + half },
          { x: position.x - half, y: position.y + half },
        ],
        color: null,
        label: null,
      };
    }
  }
}

/**
 * A blank marker at a point on the map (ADR-0038).
 *
 * The label carries the same text the id was derived from, because a
 * marker with an id and no name is a marker nobody recognises in a picker
 * three panels away.
 */
export function createMarker(id: string, label: string, position: Vec2, sector: string | null = null): EEMarker {
  return { id, label, position, notes: null, sector };
}

/** Unique object id within a project, derived from a human-readable base. */
export function uniqueObjectId(taken: ReadonlySet<string>, base: string): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const root = slug === "" ? "obj" : slug;
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}_${n}`)) n += 1;
  return `${root}_${n}`;
}

/**
 * A blank ship template.
 *
 * Same rule as objects: every nullable key is spelled out, and the few
 * defaults that are set exist so a freshly created template *builds and
 * flies* in EE rather than being an unusable husk — a hull, a shield, an
 * engine and one beam.
 */
/**
 * Bring a stock hull into the project as a template of its own.
 *
 * EmptyEpsilon exposes no way to reference an existing template from a
 * scenario — no `getShipTemplate()`, nothing in the globals — so
 * `ShipTemplate:copy()` can only chain off a template the same file
 * declared. "Copy the Atlantis" therefore means *materialising* the whole
 * definition the install's Lua declares, which is why the library reads
 * every setter (ADR-0041).
 *
 * `copyOf` is deliberately null: there is nothing in the emitted file to
 * copy from, and claiming otherwise would fail the build with a message
 * about a base the project does not define.
 */
export function templateFromStock(
  stock: EETemplateRef,
  id: string,
  name: string,
): EETemplateDef {
  const { sourceFile: _sourceFile, copiedFrom: _copiedFrom, ...fields } = stock;
  return { ...fields, id, name, copyOf: null };
}

/**
 * Is this name one the install already defines?
 *
 * Not an error — EE accepts a redefinition and the last one wins, which is
 * how an author retunes a stock hull for their campaign without touching
 * the install. But it writes `ERROR: Duplicate ship template definition`
 * to the log and silently changes every other scenario that spawns that
 * name, so the editor says so out loud.
 */
export function stockTemplateNamed(
  library: { readonly templates: readonly EETemplateRef[] } | null,
  name: string,
): EETemplateRef | null {
  return library?.templates.find((t) => t.name === name) ?? null;
}

export function createTemplate(id: string, name: string): EETemplateDef {
  return {
    id,
    name,
    localeName: null,
    kind: "ship",
    copyOf: null,
    className: null,
    subclassName: null,
    description: null,
    // Not null: EE quits while loading shipTemplates.lua when a template
    // never calls setModel(), with no error and no log line. A stock mesh
    // every install has keeps a fresh template loadable (see
    // `validateProject`, which refuses one without a model).
    model: "small_frigate_1",
    radarTrace: null,
    hull: 100,
    shields: [50],
    speed: { impulse: 60, turn: 10, acceleration: 20, reverseSpeed: null, reverseAcceleration: null },
    combatManeuver: null,
    warpSpeed: null,
    jumpDrive: null,
    cloaking: null,
    energyStorage: null,
    repairCrewCount: null,
    beams: [
      {
        index: 0,
        arc: 90,
        direction: 0,
        range: 1000,
        cycleTime: 6,
        damage: 5,
        turret: null,
        texture: null,
        energyPerFire: null,
        heatPerFire: null,
      },
    ],
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
  };
}

/** A blank beam at the next free index. */
export function createBeam(existing: readonly EEBeamDef[]): EEBeamDef {
  const used = new Set(existing.map((b) => b.index));
  let index = 0;
  while (used.has(index)) index += 1;
  return {
    index,
    arc: 90,
    direction: 0,
    range: 1000,
    cycleTime: 6,
    damage: 5,
    turret: null,
    texture: null,
    energyPerFire: null,
    heatPerFire: null,
  };
}

/** A blank per-tube override at the next free index. */
export function createTube(existing: readonly EETubeDef[]): EETubeDef {
  const used = new Set(existing.map((t) => t.index));
  let index = 0;
  while (used.has(index)) index += 1;
  return {
    index,
    direction: 0,
    loadTime: null,
    size: null,
    exclusiveFor: null,
    allow: [],
    disallow: [],
  };
}

/**
 * A new, empty scenario — the document "New project" starts from.
 *
 * Not `emptyEEProject()`. That is the schema's zero value and it is the
 * right thing for tests, but it is a poor thing to hand an author: with no
 * groups there is nowhere for a placed object to go, and with no
 * `PlayerSpaceship` half the narrative model cannot be expressed —
 * `target: {ref:"player"}` resolves statically and a map with none is a
 * build error (ADR-0035).
 *
 * So a new scenario opens the way an EE scenario has to end up anyway: one
 * `on_start` group, one player ship at the origin on a stock template. Both
 * are deletable; neither has to be guessed at by someone who just wants to
 * place an asteroid.
 */
export function starterProject(id: string, name: string): EEProject {
  const player = createObject("PlayerSpaceship", "player", { x: 0, y: 0 }, {
    callsign: nextCallsign([], "PlayerSpaceship"),
  });
  return {
    ...emptyEEProject(id, name),
    // Never empty: EE reads `-- Description:` as scenario metadata and it
    // is what the scenario picker shows next to the name.
    description: "A scenario made with EE FORGE.",
    map: {
      // One sector to start in, so a new scenario is organised the way a migrated one is (ADR-0055).
      sectors: [{ id: "sector-1", label: "Sector 1" }],
      startSector: null,
      groups: [{ id: "core", label: "Core", when: "on_start", objects: [player], sector: "sector-1" }],
      markers: [],
    },
  };
}

/** A project id derived from a name, unique against the ids already taken. */
export function projectIdFor(taken: ReadonlySet<string>, name: string): string {
  return uniqueObjectId(taken, name === "" ? "scenario" : name);
}
