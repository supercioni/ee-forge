import {
  DMX_TRIGGERS,
  EE_DMX_SYSTEMS,
  type EEDmxTelemetry,
  type EEDmxTriggerReading,
} from "@forge/contracts";

/**
 * Ship telemetry → the values EE's DMX triggers carry (ADR-0040).
 *
 * Lives here rather than in the bridge so it is testable and so the same
 * mapping would serve if EXODUS ever drove the fixtures itself.
 *
 * ## The system-name mismatch
 *
 * DMX names the maneuvering system `maneuvering`; EE's Lua `ESystem` calls
 * it `maneuver`. Probed 2026-08-17: on an undamaged ship
 * `getSystemHealth("maneuver")` reads 1.0 and `"maneuvering"` reads 0.0 —
 * the same answer a nonsense name gets, because EE returns 0 for a system
 * it does not know instead of raising. Without {@link EE_TO_DMX_SYSTEM}
 * five triggers would have sat at zero and looked merely undamaged.
 *
 * ## Scales — settled from EE's source, 2026-08-19
 *
 * The wiki's "0-100" is wrong for the system triggers. EE feeds its own
 * DMX code the **raw** member in every case:
 *
 * ```cpp
 * SHIP_VARIABLE(name + "Health",  ship->systems[n].health);
 * SHIP_VARIABLE(name + "Power",   ship->systems[n].power_level / 3.0f);
 * SHIP_VARIABLE(name + "Heat",    ship->systems[n].heat_level);
 * SHIP_VARIABLE(name + "Coolant", ship->systems[n].coolant_level);
 * SHIP_VARIABLE(name + "Hacked",  ship->systems[n].hacked_level);
 * ```
 *
 * So no system trigger is scaled here — except `Power`, which EE divides
 * by 3 because `power_level` runs 0..3. Hull, energy and the shields *are*
 * percentages (`100.0f * hull_strength / hull_max`), which is why those
 * still go through {@link percent}.
 *
 * An earlier version multiplied all five by 100, so a healthy reactor read
 * 100 against a rule written `reactorHealth < 0.5` and the preview showed
 * a cue that EE would have fired.
 */

/** DMX's system prefix → EE's Lua `ESystem` key. */
export const EE_TO_DMX_SYSTEM: Readonly<Record<string, string>> = {
  reactor: "reactor",
  beamweapons: "beamweapons",
  missilesystem: "missilesystem",
  // The one that differs, and the reason this table exists at all.
  maneuvering: "maneuver",
  impulse: "impulse",
  warp: "warp",
  jumpdrive: "jumpdrive",
  frontshield: "frontshield",
  rearshield: "rearshield",
};

/**
 * Triggers EE feeds its own DMX code but exposes to no Lua getter in
 * EE-2024.12.08, so the preview cannot read them.
 *
 * Checked against the generated catalog, not assumed: `Impulse` and `Warp`
 * have only `getImpulseMaxSpeed` and `getWarpSpeed`, which are the hull's
 * maxima rather than the current request.
 */
export const DMX_UNREADABLE_TRIGGERS: readonly string[] = [
  "Impulse",
  "Warp",
  "Jumped",
  "InNebula",
  "IsJammed",
  "SelfDestruct",
  "SelfDestructCountdown",
  "ShieldsCalibrating",
  ...DMX_TRIGGERS.filter(
    (name) =>
      name.startsWith("TubeLoading") ||
      name.startsWith("TubeUnloading") ||
      name.startsWith("TubeFiring"),
  ),
];

/**
 * Triggers that carry a condition an author has to know about, and the
 * sentence the editor shows beside them.
 *
 * A trigger that is valid, selectable and silent in the author's actual
 * setup is worse than one that is missing: nothing tells them why the
 * light never came on. So the reason travels with the name.
 */
export const DMX_TRIGGER_CAVEATS: Readonly<Record<string, string>> = Object.fromEntries(
  DMX_TRIGGERS.filter((name) => name.startsWith("TubeFiring")).map((name) => [
    name,
    // Verbatim from weaponTube.cpp: only an HVLI enters WTS_Firing, and
    // it stays there for the whole 5-shot burst. Every other missile type
    // goes Loaded -> Empty and never sets this at all.
    "Only ever true for HVLI, and then for the whole burst (~6s). Homing, " +
      "nuke, EMP and mine skip the firing state entirely. Use it as a rule, " +
      "not an event — and watch <TubeLoaded for a shot of any type.",
  ]),
);

const percent = (value: number, max: number): number => (max <= 0 ? 0 : (value / max) * 100);
const flag = (value: boolean): number => (value ? 1 : 0);

/** Every trigger the preview can read, from one telemetry snapshot. */
export function triggerValues(telemetry: EEDmxTelemetry | null): EEDmxTriggerReading {
  const values: Record<string, number> = {};
  const unreadable = [...DMX_UNREADABLE_TRIGGERS];

  if (telemetry === null || !telemetry.found) {
    // `Always` is 1.0 even with no ship — it is what EE documents, and a
    // rig whose cabin lights are on `Always` should show them on.
    return { values: { Always: 1, HasShip: 0 }, unreadable, live: false };
  }

  values["Always"] = 1;
  values["HasShip"] = 1;
  values["Hull"] = percent(telemetry.hull, telemetry.hullMax);
  values["Energy"] = percent(telemetry.energy, telemetry.energyMax);

  telemetry.shields.forEach((shield, index) => {
    values[`Shield${index}`] = percent(shield.value, shield.max);
  });
  // EE's own aliases for the first two arcs.
  values["FrontShield"] = values["Shield0"] ?? 0;
  values["RearShield"] = values["Shield1"] ?? 0;
  values["ShieldsUp"] = flag(telemetry.shieldsUp);

  values["YellowAlert"] = flag(telemetry.alertLevel === "yellow");
  values["RedAlert"] = flag(telemetry.alertLevel === "red");
  values["Alert"] = flag(telemetry.alertLevel !== "normal");

  // EDockingState: 0 not docked, 1 docking, 2 docked. EE documents
  // `Docking` as "in progress **or** docked", so it covers both.
  values["Docked"] = flag(telemetry.dockingState === 2);
  values["Docking"] = flag(telemetry.dockingState >= 1);
  values["Jumping"] = flag(telemetry.jumpDelay > 0);

  for (const dmxName of EE_DMX_SYSTEMS) {
    const key = EE_TO_DMX_SYSTEM[dmxName];
    const system = key === undefined ? undefined : telemetry.systems[key];
    if (system === undefined) continue;
    // Raw, not scaled: see the header. `getSystemPower` returns EE's
    // 0..3 power_level, and EE's DMX divides it by 3.
    values[`${dmxName}Health`] = system.health;
    values[`${dmxName}Power`] = system.power / 3;
    values[`${dmxName}Heat`] = system.heat;
    values[`${dmxName}Coolant`] = system.coolant;
    values[`${dmxName}Hacked`] = system.hacked;
  }

  telemetry.tubesLoaded.forEach((loaded, index) => {
    values[`TubeLoaded${index}`] = flag(loaded);
  });

  return { values, unreadable, live: true };
}
