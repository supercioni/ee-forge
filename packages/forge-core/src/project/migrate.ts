import { EEProjectSchema, PROJECT_SCHEMA_VERSION, type EEProject } from "@forge/contracts";
import type { z } from "zod";
import { deepStrict, unrecognizedPaths } from "./strict.js";

/**
 * Project document migrations.
 *
 * A migration is a pure, deterministic function from one document version
 * to the next on the **raw JSON**, before Zod sees it. Working on raw JSON
 * matters: Zod strips keys it does not know, so a migration that ran after
 * parsing could not tell a field it renamed from one it was about to lose.
 * Each step must keep every field of the document it receives.
 */

export interface MigrationStep {
  readonly from: number;
  readonly to: number;
  readonly id: string;
  readonly description: string;
  readonly apply: (document: Record<string, unknown>) => Record<string, unknown>;
}

export const PROJECT_MIGRATIONS: readonly MigrationStep[] = [
  {
    from: 0,
    to: 1,
    id: "0001-add-schema-version",
    description: "Stamp the document with schemaVersion 1; no other field changes.",
    // schemaVersion first so the serialised key order is the same whatever
    // order the old file used.
    apply: ({ schemaVersion: _ignored, ...rest }) => ({ schemaVersion: 1, ...rest }),
  },
  {
    from: 1,
    to: 2,
    id: "0002-exodus-steps",
    description:
      "Add logic.exodusSteps (empty): the table of without-EXODUS alternatives (ADR-0049). " +
      "Existing exodus_* actions and `requires` are untouched and stay undecided until the author records an alternative.",
    apply: ({ schemaVersion: _ignored, logic, ...rest }) => ({
      schemaVersion: 2,
      ...rest,
      ...(isRecord(logic)
        ? { logic: { ...logic, exodusSteps: Array.isArray(logic["exodusSteps"]) ? logic["exodusSteps"] : [] } }
        : logic === undefined
          ? {}
          : { logic }),
    }),
  },
  {
    from: 2,
    to: 3,
    id: "0003-sectors",
    description:
      "Add map.sectors with one initial sector (“Sector 1”) and file every group and marker under it (ADR-0055). " +
      "Nothing is inferred from names; ids, order, coordinates, properties and references are untouched, so the exported scenario does not change.",
    apply: ({ schemaVersion: _ignored, map, ...rest }) => {
      if (!isRecord(map)) return { schemaVersion: 3, ...rest, ...(map === undefined ? {} : { map }) };
      const existing = Array.isArray(map["sectors"]) ? (map["sectors"] as unknown[]) : [];
      const sectors = existing.length > 0 ? existing : [{ id: "sector-1", label: "Sector 1" }];
      const first = isRecord(sectors[0]) && typeof sectors[0]["id"] === "string" ? sectors[0]["id"] : "sector-1";
      const file = (item: unknown): unknown =>
        isRecord(item) && item["sector"] === undefined ? { ...item, sector: first } : item;
      return {
        schemaVersion: 3,
        ...rest,
        map: {
          ...map,
          sectors,
          ...(Array.isArray(map["groups"]) ? { groups: (map["groups"] as unknown[]).map(file) } : {}),
          ...(Array.isArray(map["markers"]) ? { markers: (map["markers"] as unknown[]).map(file) } : {}),
        },
      };
    },
  },
  {
    from: 3,
    to: 4,
    id: "0004-start-sector",
    description:
      "Add map.startSector: null (ADR-0056). Null is the behaviour every older project had — every At-mission-start group spawns and " +
      "sectors are organisation only — so nothing about how an existing scenario plays or what it generates changes; an author opts in by choosing a start sector.",
    apply: ({ schemaVersion: _ignored, map, ...rest }) => ({
      schemaVersion: 4,
      ...rest,
      ...(isRecord(map)
        ? { map: { ...map, startSector: map["startSector"] === undefined ? null : map["startSector"] } }
        : map === undefined
          ? {}
          : { map }),
    }),
  },
  {
    from: 4,
    to: 5,
    id: "0005-campaign-persistence",
    description:
      "Add campaign.persistence: false and sector: null on every beat and rule (ADR-0058). Off and global are what every older project did — nothing is saved, " +
      "every beat runs on the campaign clock and every rule is evaluated whatever sector is active — so the Lua an existing project generates does not change; " +
      "an author opts in per project and scopes a beat or rule to a sector on purpose.",
    apply: ({ schemaVersion: _ignored, logic, campaign, ...rest }) => ({
      schemaVersion: 5,
      ...rest,
      campaign: isRecord(campaign) ? { persistence: campaign["persistence"] === true } : { persistence: false },
      ...(isRecord(logic)
        ? {
            logic: {
              ...logic,
              ...(Array.isArray(logic["beats"])
                ? { beats: (logic["beats"] as unknown[]).map((b) => (isRecord(b) && b["sector"] === undefined ? { ...b, sector: null } : b)) }
                : {}),
              ...(Array.isArray(logic["rules"])
                ? { rules: (logic["rules"] as unknown[]).map((r) => (isRecord(r) && r["sector"] === undefined ? { ...r, sector: null } : r)) }
                : {}),
            },
          }
        : logic === undefined
          ? {}
          : { logic }),
    }),
  },
];

export class ProjectImportError extends Error {
  override readonly name = "ProjectImportError";
}

export interface MigratedDocument {
  readonly document: Record<string, unknown>;
  readonly fromVersion: number;
  readonly toVersion: number;
  /** Ids of the steps that ran, in order. */
  readonly applied: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Version a raw document declares; documents predating versioning are 0. */
export function documentVersion(raw: unknown): number {
  if (!isRecord(raw)) throw new ProjectImportError("a project document must be a JSON object");
  const declared = raw["schemaVersion"];
  if (declared === undefined) return 0;
  if (typeof declared !== "number" || !Number.isInteger(declared) || declared < 0) {
    throw new ProjectImportError(`schemaVersion must be a non-negative integer, got ${JSON.stringify(declared)}`);
  }
  return declared;
}

export function migrateProjectDocument(raw: unknown): MigratedDocument {
  const fromVersion = documentVersion(raw);
  if (fromVersion > PROJECT_SCHEMA_VERSION) {
    throw new ProjectImportError(
      `this project is schema version ${fromVersion}, newer than the ${PROJECT_SCHEMA_VERSION} this build understands — ` +
        `open it with a newer Forge instead of risking a lossy downgrade`,
    );
  }
  let document = raw as Record<string, unknown>;
  let version = fromVersion;
  const applied: string[] = [];
  while (version < PROJECT_SCHEMA_VERSION) {
    const step = PROJECT_MIGRATIONS.find((candidate) => candidate.from === version);
    if (step === undefined) {
      throw new ProjectImportError(`no migration from schema version ${version}`);
    }
    document = step.apply(document);
    version = step.to;
    applied.push(step.id);
  }
  return { document, fromVersion, toVersion: version, applied };
}

/** `map.groups[core].objects[atlantis].hull` — ids where an element has one, indices otherwise. */
function pointer(document: unknown, path: readonly (string | number)[]): string {
  let node: unknown = document;
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      const element = Array.isArray(node) ? (node[segment] as unknown) : undefined;
      const id = isRecord(element) && typeof element["id"] === "string" ? element["id"] : String(segment);
      out += `[${id}]`;
      node = element;
    } else {
      out += out === "" ? segment : `.${segment}`;
      node = isRecord(node) ? node[segment] : undefined;
    }
  }
  return out;
}

/** Same value with object keys sorted at every depth, so output never depends on source key order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Moves every field the schema does not model out of the document and into
 * `unmodelled`, returning the cleaned document. The values are kept
 * (canonically key-ordered). Deterministic (keys sorted) and idempotent: a document with
 * nothing unknown comes back unchanged.
 */
export function preserveUnmodelled(document: Record<string, unknown>): {
  readonly document: Record<string, unknown>;
  readonly moved: readonly string[];
} {
  const check = deepStrict(EEProjectSchema).safeParse(document);
  if (check.success) return { document, moved: [] };
  const paths = unrecognizedPaths(check.error.issues);
  if (paths.length === 0) return { document, moved: [] };

  const next = clone(document);
  const carried: Record<string, unknown> = isRecord(next["unmodelled"]) ? { ...next["unmodelled"] } : {};
  const moved: string[] = [];
  for (const path of paths) {
    const key = pointer(document, path);
    let source: unknown = document;
    let parent: unknown = next;
    for (const segment of path.slice(0, -1)) {
      source = (source as Record<string | number, unknown>)[segment];
      parent = (parent as Record<string | number, unknown>)[segment];
    }
    const leaf = path[path.length - 1] as string;
    if (key === "unmodelled" || !isRecord(parent) || !(leaf in parent)) continue;
    carried[key] = canonical((source as Record<string, unknown>)[leaf]);
    delete parent[leaf];
    moved.push(key);
  }
  moved.sort();
  const sorted = Object.fromEntries(Object.entries(carried).sort(([a], [b]) => a.localeCompare(b)));
  return { document: { ...next, unmodelled: sorted }, moved };
}

export interface ProjectImport {
  readonly project: EEProject;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly applied: readonly string[];
  /** Keys moved into `unmodelled` (kept, not interpreted). */
  readonly preserved: readonly string[];
  /**
   * Source paths that did not survive. Expected to stay empty; a non-empty
   * list is a bug in the importer or schema, never a normal outcome.
   */
  readonly lost: readonly string[];
}

/**
 * Raw JSON → current project: migrate, keep unmodelled fields, validate.
 * Never touches disk.
 */
export function importProject(raw: unknown): ProjectImport {
  const migrated = migrateProjectDocument(raw);
  const preserved = preserveUnmodelled(migrated.document);
  const parsed = EEProjectSchema.safeParse(preserved.document);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ProjectImportError(
      `invalid project document: ${first?.path.join(".") ?? "$"}: ${first?.message ?? "unknown error"}`,
    );
  }
  // After preservation the strict schema must accept the document: anything
  // it still rejects as unknown would be dropped by the plain parse above.
  const stillUnknown = unrecognizedPaths(
    (deepStrict(EEProjectSchema).safeParse(preserved.document) as { error?: { issues: z.ZodIssue[] } }).error
      ?.issues ?? [],
  ).map((path) => pointer(preserved.document, path));
  return {
    project: parsed.data,
    fromVersion: migrated.fromVersion,
    toVersion: migrated.toVersion,
    applied: migrated.applied,
    preserved: preserved.moved,
    lost: stillUnknown,
  };
}

/** The one serialisation of a project: schema key order, two spaces, trailing newline. */
export function serializeProject(project: EEProject): string {
  return `${JSON.stringify(EEProjectSchema.parse(project), null, 2)}\n`;
}
