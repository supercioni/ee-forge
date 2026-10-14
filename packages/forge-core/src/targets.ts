/**
 * The EmptyEpsilon builds Forge can target.
 *
 * A target is more than a version string: it selects the API catalog the
 * emitters validate against and the runtime flavour of the generated Lua
 * (the two engines differ in how a script can ask an object what it is).
 * A project names its target in `eeVersion`; everything downstream resolves
 * through this table rather than comparing strings in place.
 */

export const TARGET_2024 = "EE-2024.12.08";
export const TARGET_2026 = "EE-2026.09.22PR";

export type DialogueRestore = "typeName" | "ecs";

export interface EETarget {
  readonly id: string;
  readonly label: string;
  /**
   * How emitted Lua tells a station from a ship when putting EE's default
   * comms script back. 2024 objects expose `typeName`; 2026 dropped it in
   * favour of ECS components (API reference §16).
   */
  readonly dialogueRestore: DialogueRestore;
}

export const EE_TARGETS: readonly EETarget[] = [
  { id: TARGET_2024, label: "EmptyEpsilon 2024.12.08", dialogueRestore: "typeName" },
  { id: TARGET_2026, label: "EmptyEpsilon 2026.09.22PR", dialogueRestore: "ecs" },
];

export function findTarget(id: string): EETarget | null {
  return EE_TARGETS.find((target) => target.id === id) ?? null;
}

/** Throws for a version Forge has no verified catalog for. */
export function requireTarget(id: string): EETarget {
  const target = findTarget(id);
  if (target === null) {
    throw new Error(
      `"${id}" is not a verified EmptyEpsilon target. Supported: ${EE_TARGETS.map((t) => t.id).join(", ")}. ` +
        `Generate a catalog from that install and add it to the registry before building for it.`,
    );
  }
  return target;
}
