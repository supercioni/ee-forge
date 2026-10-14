import type { ForgeCompatEntry, ForgeCompatibility } from "@forge/contracts";
import type { ForgeExtension } from "./extensions.js";
import { EE_TARGETS, TARGET_2024, TARGET_2026 } from "./targets.js";

/**
 * What has actually been shown to work, per engine — recorded evidence, never a guess from a
 * version string. A vanilla export is the baseline and is never blocked by anything about an
 * extension. Update an entry only with a run to point at (docs/design/forge-autonomo-stato.md).
 */
export const VANILLA_COMPATIBILITY: Readonly<Record<string, ForgeCompatEntry>> = {
  [TARGET_2024]: {
    level: "engine-tested",
    note:
      "The demonstration mission, exported vanilla, was run in an isolated copy of EE 2024.12.08. " +
      "Other projects are generated against the 2024 catalog and checked offline, not run.",
  },
  [TARGET_2026]: {
    level: "engine-tested",
    note:
      "The demonstration mission, exported vanilla, was run in an isolated copy of EE 2026.09.22PR. " +
      "Other projects are generated against the 2026 catalog and checked offline, not run.",
  },
};

const UNKNOWN: ForgeCompatEntry = { level: "unverified", note: "No evidence recorded for this engine." };

export function vanillaCompatibility(target: string): ForgeCompatEntry {
  return VANILLA_COMPATIBILITY[target] ?? UNKNOWN;
}

/** An extension's entry for a target; `unverified` unless the extension recorded evidence. */
export function extensionCompatibility(extension: ForgeExtension, target: string): ForgeCompatEntry {
  return extension.compatibility?.(target) ?? UNKNOWN;
}

export function describeCompatibility(extensions: readonly ForgeExtension[]): ForgeCompatibility {
  return {
    targets: EE_TARGETS.map((target) => ({
      target: target.id,
      label: target.label,
      vanilla: vanillaCompatibility(target.id),
      extensions: extensions.map((extension) => ({
        id: extension.id,
        label: extension.label,
        ...extensionCompatibility(extension, target.id),
      })),
    })),
  };
}
