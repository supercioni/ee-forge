import type { EEMapGroup, EEObject, SpawnableClass } from "@forge/contracts";

/**
 * Callsign assignment for the map editor, per
 * `docs/authoring/naming-convention.md`.
 *
 * The convention (`TT-SS-NN[-III]`) has existed on paper since Phase 3 and
 * nothing enforced it: chapters name objects by hand, so the grouping it
 * was meant to unlock (viewer clustering, HUD counts, GM filters,
 * per-group persistence) never became reliable. The editor is the
 * enforcement point — every placed object gets a conforming callsign
 * unless the author deliberately overrides it.
 *
 * Verified 2026-08-09: `setCallSign` round-trips on every spawnable type,
 * so the convention needs no `ScriptStorage` fallback.
 */

/** Regex from naming-convention.md §1. */
export const CALLSIGN_PATTERN = /^[A-Z]{2}(-[A-Z]{2})?-[A-Z0-9]{1,3}(-\d{1,3})?$/;

/** Type codes (`TT`) — closed set; a new one needs an ADR. */
export const TYPE_CODES: Record<SpawnableClass, string> = {
  Asteroid: "AS",
  VisualAsteroid: "AS",
  Nebula: "NB",
  Mine: "MN",
  BlackHole: "BH",
  WormHole: "WH",
  Planet: "PL",
  SpaceStation: "ST",
  CpuShip: "SH",
  PlayerSpaceship: "PS",
  SupplyDrop: "SD",
  Artifact: "AR",
  ScanProbe: "PR",
  WarpJammer: "WJ",
  Zone: "ZN",
};

/** Formation sub-codes (`SS`) for scattered or grouped objects. */
export const FORMATION_CODES = ["CL", "BE", "FL", "SW", "FM", "SG"] as const;
export type FormationCode = (typeof FORMATION_CODES)[number];

/** Role sub-codes (`SS`) for ships, stations and zones. */
export const ROLE_CODES = [
  "EN",
  "FR",
  "NT",
  "CV",
  "PT",
  "MI",
  "TR",
  "SF",
  "HZ",
  "QT",
  "BF",
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export interface CallsignOptions {
  /** Overrides the type code — e.g. `SU` for a Planet used as a star. */
  readonly typeCode?: string;
  /** Formation or role sub-code. Omitted for trivial singletons. */
  readonly subCode?: string;
}

/** `AS-BE` or `PL` — everything before the group index. */
export function callsignPrefix(type: SpawnableClass, options: CallsignOptions = {}): string {
  const typeCode = options.typeCode ?? TYPE_CODES[type];
  return options.subCode === undefined ? typeCode : `${typeCode}-${options.subCode}`;
}

function usedIndices(existing: readonly string[], prefix: string): Set<number> {
  const used = new Set<number>();
  const matcher = new RegExp(`^${prefix}-(\\d{2,3})(?:-\\d{1,3})?$`);
  for (const callsign of existing) {
    const index = matcher.exec(callsign)?.[1];
    if (index !== undefined) used.add(Number(index));
  }
  return used;
}

/**
 * Next free `TT-SS-NN` for a prefix.
 *
 * Members of one cluster deliberately **share** a callsign — that is the
 * convention's "golden rule", and what makes `GROUP BY prefix` work
 * downstream. Per-object identity (`-III`) is opt-in via
 * {@link memberCallsign}.
 */
export function nextCallsign(
  existing: readonly string[],
  type: SpawnableClass,
  options: CallsignOptions = {},
): string {
  const prefix = callsignPrefix(type, options);
  const used = usedIndices(existing, prefix);
  let index = 1;
  while (used.has(index)) index += 1;
  return `${prefix}-${String(index).padStart(2, "0")}`;
}

/** `AS-CL-01-042` — individual identity inside a shared group callsign. */
export function memberCallsign(groupCallsign: string, member: number): string {
  return `${groupCallsign}-${String(member).padStart(3, "0")}`;
}

/** Every callsign currently in use across a project's groups. */
export function existingCallsigns(groups: readonly EEMapGroup[]): string[] {
  const out: string[] = [];
  for (const group of groups) {
    for (const object of group.objects) {
      if (object.callsign !== null) out.push(object.callsign);
    }
  }
  return out;
}

/**
 * Objects sharing a `TT-SS-NN` prefix, which is how the viewer and HUD are
 * meant to recognise a cluster without re-deriving it geometrically.
 */
export function groupByCallsignPrefix(
  objects: readonly EEObject[],
): Map<string, EEObject[]> {
  const groups = new Map<string, EEObject[]>();
  for (const object of objects) {
    if (object.callsign === null) continue;
    const prefix = /^([A-Z]{2}(?:-[A-Z]{2})?-[A-Z0-9]{1,3})/.exec(object.callsign)?.[1];
    if (prefix === undefined) continue;
    const bucket = groups.get(prefix) ?? [];
    bucket.push(object);
    groups.set(prefix, bucket);
  }
  return groups;
}
