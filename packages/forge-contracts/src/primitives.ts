import { z } from "zod";

/**
 * Primitives shared by the Forge contracts and by EXODUS' ship snapshot.
 * They live here, in the neutral package, so there is one definition;
 * `@exodus/shared` imports them from here.
 */

/**
 * Native EE system names (per CLAUDE.md §6.1, EE Engineering wiki).
 * Locked to this set — EXODUS does not invent new systems.
 */
export const SHIP_SYSTEM_NAMES = [
  "reactor",
  "beamweapons",
  "missilesystem",
  "maneuver",
  "impulse",
  "warp",
  "jumpdrive",
  "frontshield",
  "rearshield",
] as const;
export const ShipSystemNameSchema = z.enum(SHIP_SYSTEM_NAMES);
export type ShipSystemName = z.infer<typeof ShipSystemNameSchema>;

/**
 * 2D position. EE uses a flat XY plane; Z is unused at the gameplay
 * layer (the 3D viewer adds verticality cosmetically).
 */
export const Vec2Schema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Vec2 = z.infer<typeof Vec2Schema>;

/**
 * Normalised alert level. EE returns `"Normal"` / `"YELLOW ALERT"` /
 * `"RED ALERT"` (see docs/ee-api-reference.md §5); the bridge maps to
 * this lowercase short form so cockpits don't carry EE's mixed case.
 */
export const AlertLevelSchema = z.enum(["normal", "yellow", "red"]);
export type AlertLevel = z.infer<typeof AlertLevelSchema>;
