import type { EETemplateDef } from "@forge/contracts";

/**
 * What EmptyEpsilon's `ShipTemplate::copy()` leaves behind.
 *
 * `copy()` reads as "clone this hull", and both the emitter and the install
 * reader used to assume it. It is not: the function assigns member by
 * member (`shipTemplate.cpp`, `ShipTemplate::copy`), and six of the class's
 * members are simply absent from that list. The variant gets the
 * constructor's defaults instead:
 *
 * | field | what the variant actually gets |
 * | --- | --- |
 * | `localeName` | the new name |
 * | `jumpDrive.minRange` / `maxRange` | 5000 / 50000 |
 * | `longRangeRadarRange` | 30000 |
 * | `shortRangeRadarRange` | 5000 |
 * | `impulseSoundFile` | `sfx/engine.wav` |
 *
 * `has_jump_drive` **is** carried while its range is not, which is the
 * nastiest of the six: a variant of a jump ship keeps the drive and loses
 * the tuning. Our model bundles the flag and the range into one
 * `jumpDrive` object, so the whole object is listed — re-emitting
 * `setJumpDrive(enabled)` alongside the range costs a redundant line and
 * removes the trap.
 *
 * Two consumers, one fact:
 *
 *  - `codegen/content.ts` must write these on a variant even when they
 *    equal the base's, or the emitted Lua silently drops them.
 *  - `scan/install.ts` must NOT inherit these when it reads a stock
 *    `base:copy("x")`, or the library claims values EE never gave that
 *    ship.
 */
export const NOT_CARRIED_BY_COPY = [
  "localeName",
  "jumpDrive",
  "longRangeRadarRange",
  "shortRangeRadarRange",
  "impulseSoundFile",
] as const satisfies readonly (keyof EETemplateDef)[];

const NOT_CARRIED = new Set<string>(NOT_CARRIED_BY_COPY);

/** True when `copy()` would leave this field at EE's default. */
export function carriedByCopy(field: keyof EETemplateDef): boolean {
  return !NOT_CARRIED.has(field);
}

/** The fields {@link inheritByCopy} rewrites. */
type CopyDropped = Pick<EETemplateDef, (typeof NOT_CARRIED_BY_COPY)[number]>;

/**
 * Apply `copy()`'s semantics to a template inherited from a base.
 *
 * The list above is what the emitter needs — "always write these" — but a
 * *reader* has to be finer grained, because `jumpDrive` is one field here
 * and two members in EE: `has_jump_drive` is carried, the range pair is
 * not. Resetting the whole object would credit the copy with no jump drive
 * at all, and EE's own Atlantis is exactly that case.
 *
 * `blank` supplies the defaults, so the caller decides what "unset" means.
 */
export function inheritByCopy<T extends CopyDropped>(inherited: T, blank: CopyDropped): T {
  return {
    ...inherited,
    localeName: blank.localeName,
    longRangeRadarRange: blank.longRangeRadarRange,
    shortRangeRadarRange: blank.shortRangeRadarRange,
    impulseSoundFile: blank.impulseSoundFile,
    jumpDrive:
      inherited.jumpDrive === null
        ? blank.jumpDrive
        : { enabled: inherited.jumpDrive.enabled, minRange: null, maxRange: null },
  };
}
