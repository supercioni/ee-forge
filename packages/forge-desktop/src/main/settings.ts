import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * The shell's own settings: where the projects are, and the optional EXODUS extension. Kept in the
 * user's data directory (never next to the program), written atomically, and tolerant of a file
 * that is missing, damaged or from a newer version — in which case the defaults apply and the
 * damaged file is left alone for the user to look at.
 */
export const SettingsSchema = z.object({
  version: z.literal(1),
  /** null = the default under the user's Documents folder. */
  projectsDir: z.string().min(1).nullable(),
  extension: z.object({
    /** A module the user picked. null = none; the bundled optional one (if any) is then offered. */
    path: z.string().min(1).nullable(),
    /** Opt-in. Without it Forge exports vanilla scenarios and loads nothing of EXODUS. */
    enabled: z.boolean(),
  }),
  lastExportDir: z.string().min(1).nullable(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  projectsDir: null,
  extension: { path: null, enabled: false },
  lastExportDir: null,
};

export function loadSettings(path: string, warn: (message: string) => void = () => undefined): Settings {
  if (!existsSync(path)) return DEFAULT_SETTINGS;
  try {
    return SettingsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    warn(`settings at ${path} are unreadable (${error instanceof Error ? error.message : String(error)}); using defaults`);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(SettingsSchema.parse(settings), null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}
