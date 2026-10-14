import { z } from "zod";

/**
 * The DMX rig — EmptyEpsilon's `hardware.ini`, as a document (ADR-0040).
 *
 * ## Why this is not part of a project
 *
 * DMX has **no Lua API at all** in EE-2024.12.08: nothing in the generated
 * catalog, global or method. It is configured entirely by `hardware.ini`,
 * which lives beside `EmptyEpsilon.exe` on Windows and in
 * `~/.emptyepsilon/` elsewhere — and every one of its triggers is *ship
 * telemetry*: hull, shields, alert, systems, tubes. There is no cue for
 * "when this story beat fires".
 *
 * So a rig describes **the room**, not the content. Two groups running the
 * same scenario have different lights. It sits beside the projects, like
 * `ee-library.json`, which is the other "facts about this installation"
 * document.
 *
 * Reference: https://github.com/daid/EmptyEpsilon/wiki/DMX-Configuration,
 * cross-checked against `strings EmptyEpsilon.exe` for this pinned build
 * and against the `hardware.ini` the install ships.
 */

/**
 * The six output devices, every one confirmed present in the pinned
 * build's binary.
 *
 * `VirtualOutputDevice` simulates hardware, which is what makes a rig
 * testable without touching a serial port.
 */
export const EE_DMX_DEVICES = [
  "DMX512SerialDevice",
  "EnttecDMXProDevice",
  "sACNDevice",
  "uDMXDevice",
  "PhilipsHueDevice",
  "VirtualOutputDevice",
] as const;
export const EEDmxDeviceKindSchema = z.enum(EE_DMX_DEVICES);
export type EEDmxDeviceKind = z.infer<typeof EEDmxDeviceKindSchema>;

/** Ship systems a trigger can name. EE composes `<system><Suffix>`. */
export const EE_DMX_SYSTEMS = [
  "reactor",
  "beamweapons",
  "missilesystem",
  "maneuvering",
  "impulse",
  "warp",
  "jumpdrive",
  "frontshield",
  "rearshield",
] as const;

/** The five per-system measures. */
export const EE_DMX_SYSTEM_SUFFIXES = [
  "Health",
  "Power",
  "Heat",
  "Coolant",
  "Hacked",
] as const;

/**
 * Triggers that are not composed: ship-wide state.
 *
 * `Shield2`–`Shield7` are in EE's own table but marked unsupported there;
 * they are listed so an author who has them can still name one, and the
 * authoring guide repeats the caveat.
 */
export const EE_DMX_FIXED_TRIGGERS = [
  "Always",
  "HasShip",
  "Hull",
  "Energy",
  "FrontShield",
  "RearShield",
  "Shield0",
  "Shield1",
  "Shield2",
  "Shield3",
  "Shield4",
  "Shield5",
  "Shield6",
  "Shield7",
  "ShieldsUp",
  /**
   * How far through a shield recalibration the ship is, 0..1 — absent
   * from EE's wiki table, present in its binary between `ShieldsUp` and
   * `Impulse`, which is where this sits to match.
   */
  "ShieldsCalibrating",
  "Impulse",
  "Warp",
  "Docking",
  "Docked",
  "InNebula",
  "IsJammed",
  "Jumping",
  "Jumped",
  "Alert",
  "YellowAlert",
  "RedAlert",
  "SelfDestruct",
  "SelfDestructCountdown",
] as const;

/**
 * Weapon-tube indices a trigger can name.
 *
 * EE's table writes `TubeLoaded[0-16]`, which reads as either 0..15 or
 * 0..16. `ShipTemplate:setTubes` caps at 16 tubes, so indices are 0..15
 * and that is what is offered; a project needing a seventeenth would have
 * found a bug in EE, not here.
 */
export const EE_DMX_TUBE_COUNT = 16;
const TUBE_PREFIXES = ["TubeLoaded", "TubeLoading", "TubeUnloading", "TubeFiring"] as const;

/** Every trigger name EE accepts, in the order the picker should show them. */
export const DMX_TRIGGERS: readonly string[] = [
  ...EE_DMX_FIXED_TRIGGERS,
  ...EE_DMX_SYSTEMS.flatMap((system) =>
    EE_DMX_SYSTEM_SUFFIXES.map((suffix) => `${system}${suffix}`),
  ),
  ...TUBE_PREFIXES.flatMap((prefix) =>
    Array.from({ length: EE_DMX_TUBE_COUNT }, (_, i) => `${prefix}${i}`),
  ),
];

const TRIGGER_SET = new Set(DMX_TRIGGERS);

/**
 * A trigger name, validated against the list rather than typed as an enum.
 *
 * `z.enum` over ~120 literals produces an unreadable type and a worse
 * error; a refinement names the offender and points at the list.
 */
export const EEDmxTriggerSchema = z.string().refine((value) => TRIGGER_SET.has(value), {
  message: "not a DMX trigger EmptyEpsilon knows — see DMX_TRIGGERS",
});

/**
 * One value on one channel of a fixture.
 *
 * The **format is tagged, not inferred from the text**. `$ff` and `[255]`
 * are the same number written two ways, and which one appears in the ini
 * is the author's choice about what they want to read later — the same
 * reason every other union in this package carries its own tag.
 */
export const EEDmxValueSchema = z.discriminatedUnion("format", [
  /** `0.5` — EE's default. Anything above 1 is clamped by EE itself. */
  z.object({ format: z.literal("float"), value: z.number().min(0).max(1) }),
  /** `$AF` — two hex digits. */
  z.object({ format: z.literal("hex"), value: z.number().int().min(0).max(255) }),
  /** `[255]` — decimal in brackets. */
  z.object({ format: z.literal("byte"), value: z.number().int().min(0).max(255) }),
]);
export type EEDmxValue = z.infer<typeof EEDmxValueSchema>;

/**
 * A level on the wire, per channel of the fixture.
 *
 * **EE splits every setting across the target's channels**, taking
 * `values[idx % values.size()]` for channel `idx` — so a one-element list
 * means "the same on every channel", and `$ff, 0, 0` on an RGB fixture is
 * red. That is the whole mechanism behind a colour: three levels lined up
 * with three channels.
 */
const LevelListSchema = z.array(z.number().min(0).max(1)).min(1);

/**
 * What a channel does while its condition holds.
 *
 * The five kinds and every key below are EE's, read off
 * `hardwareMappingEffects.cpp` at EE-2024.12.08 rather than off the wiki,
 * which omits `noise` and both of blink's levels.
 *
 * **A parameter that is a level on the wire is a list; a parameter that is
 * a time, or the trigger's own range, is not.** Nobody wires a fixture
 * whose red blinks faster than its green, but "pulse red" is the bridge
 * cue, and EE's per-channel split is what makes it expressible.
 */
export const EEDmxEffectSchema = z.discriminatedUnion("kind", [
  /** Values keep their spelling — `$ff` and `1` may share one list. */
  z.object({ kind: z.literal("static"), values: z.array(EEDmxValueSchema).min(1) }),
  /** Pulses between two levels. */
  z.object({
    kind: z.literal("glow"),
    minValue: LevelListSchema,
    maxValue: LevelListSchema,
    timeS: z.number().positive(),
  }),
  /**
   * On and off, each with its own level as well as its own time — so
   * "blink" can also mean "dim and bright" rather than "on and dark".
   */
  z.object({
    kind: z.literal("blink"),
    onValue: LevelListSchema,
    offValue: LevelListSchema,
    onTimeS: z.number().positive(),
    offTimeS: z.number().positive(),
  }),
  /**
   * Maps a trigger's value onto an output range.
   *
   * `inputs` is per channel, not a set to combine: EE's Variable effect
   * reads exactly **one** variable, and the comma list is split the same
   * way every other setting is. `Hull, Energy` means channel 0 follows the
   * hull and channel 1 the energy.
   */
  z.object({
    kind: z.literal("variable"),
    inputs: z.array(EEDmxTriggerSchema).min(1),
    minInput: z.number(),
    maxInput: z.number(),
    minOutput: LevelListSchema,
    maxOutput: LevelListSchema,
  }),
  /**
   * A random level, re-rolled continuously — a failing lamp, a fire.
   * `smoothness` is how long EE takes to fade from one roll to the next;
   * its own default is 0, which flickers hard.
   */
  z.object({
    kind: z.literal("noise"),
    minValue: LevelListSchema,
    maxValue: LevelListSchema,
    smoothness: z.number().min(0),
  }),
]);
export type EEDmxEffect = z.infer<typeof EEDmxEffectSchema>;

/** 1-512. EE clamps to this range and defaults to the whole universe. */
const DmxChannelCountSchema = z.number().int().min(1).max(512);

/**
 * A device and the settings EE reads for it.
 *
 * A union rather than one object with every key nullable, because EE
 * hands the whole `[hardware]` section to the chosen device's
 * `configure()` and each device ignores what it does not recognise. A
 * `universe` on a serial device is not an unset setting — it is a line
 * that does nothing, and an editor that offered it would be lying.
 *
 * Every key below appears in a `configure()` under
 * `src/hardware/devices/` at EE-2024.12.08, and every key there appears
 * below.
 */
export const EEDmxDeviceSchema = z.discriminatedUnion("device", [
  z.object({
    id: z.string().min(1),
    device: z.literal("DMX512SerialDevice"),
    /** `COM9`, `/dev/ttyUSB0`, or a pseudo-name EE resolves from the port list. */
    port: z.string(),
    channels: DmxChannelCountSchema,
    /** Milliseconds between full re-sends; EE's own default is 25. */
    resendDelayMs: z.number().int().min(0),
  }),
  z.object({
    id: z.string().min(1),
    device: z.literal("EnttecDMXProDevice"),
    port: z.string(),
    channels: DmxChannelCountSchema,
    // No resend_delay: unlike the plain serial device, this one has no
    // such member. Checked in enttecDMXProDevice.h, not assumed.
  }),
  z.object({
    id: z.string().min(1),
    device: z.literal("sACNDevice"),
    channels: DmxChannelCountSchema,
    /** 1-63999; EE's default is 1. */
    universe: z.number().int().min(1).max(63999),
    /** Milliseconds; EE's default is 50, and it clamps to at least 1. */
    resendDelayMs: z.number().int().min(1),
    multicast: z.boolean(),
  }),
  /**
   * Reads no settings at all — `uDMX.dll` decides everything, and EE's
   * `configure()` never touches the map it is handed.
   */
  z.object({ id: z.string().min(1), device: z.literal("uDMXDevice") }),
  z.object({
    id: z.string().min(1),
    device: z.literal("PhilipsHueDevice"),
    ip: z.string(),
    /** The bridge's TCP port — a number here, unlike every other `port`. */
    port: z.number().int().min(1).max(65535).nullable(),
    /** Blank makes EE ask the bridge for one; press its button when it does. */
    username: z.string(),
    /** Where EE saves the granted username. Its own default is `philips_hue.name`. */
    userfile: z.string(),
  }),
  /**
   * `virtual_types` is deliberately absent: it says what colour to draw
   * each channel on screen, which is the same fact as a fixture's channel
   * roles. The build derives it from those, so the two cannot disagree.
   */
  z.object({
    id: z.string().min(1),
    device: z.literal("VirtualOutputDevice"),
    channels: DmxChannelCountSchema,
  }),
]);
export type EEDmxDevice = z.infer<typeof EEDmxDeviceSchema>;
export type EEDmxDeviceOf<K extends EEDmxDeviceKind> = Extract<EEDmxDevice, { device: K }>;

/**
 * What one channel of a fixture drives.
 *
 * `red`/`green`/`blue` are the ones that mix: a colour is exactly those
 * three levels, which is why the editor can offer a swatch instead of
 * three numbers. `white` and `intensity` are real channels on real
 * fixtures but are not part of the mix — they keep their own control.
 * `none` is the honest default for an imported file that never said.
 */
export const EEDmxRoleSchema = z.enum([
  "red",
  "green",
  "blue",
  "white",
  "intensity",
  "none",
]);
export type EEDmxRole = z.infer<typeof EEDmxRoleSchema>;

/** One DMX channel of a fixture, and what it drives. */
export const EEDmxSlotSchema = z.object({
  channel: z.number().int().min(1).max(512),
  role: EEDmxRoleSchema,
});
export type EEDmxSlot = z.infer<typeof EEDmxSlotSchema>;

/**
 * A named group of DMX channels — what a rule points at.
 *
 * EE calls these "channels" and its ini section is `[channels]`; here they
 * are fixtures, because `fixture.slots[i].channel` reads and
 * `channel.channels[i]` does not.
 */
export const EEDmxFixtureSchema = z.object({
  id: z.string().min(1),
  /** The name states and events address. Becomes the ini key. */
  name: z.string().min(1),
  slots: z.array(EEDmxSlotSchema).min(1),
});
export type EEDmxFixture = z.infer<typeof EEDmxFixtureSchema>;

/**
 * How a trigger's value is tested.
 *
 * EE splits `condition` on the first `<`, `>`, `==` or `!=` it finds and
 * reads what follows as a number; with no operator it defaults to
 * `> 0`, which is why a bare `RedAlert` works as a boolean.
 *
 * **`==` and `!=` cannot carry a value in EE-2024.12.08.** Its parser
 * takes the value from one character past the operator, so `Hull == 0.5`
 * hands `atof` the string `"= 0.5"` and compares against 0. They are
 * offered because EE accepts them, and the editor warns when the value is
 * not 0 rather than emitting something that quietly means something else.
 */
export const EEDmxOperatorSchema = z.enum(["greater", "less", "equal", "notEqual"]);
export type EEDmxOperator = z.infer<typeof EEDmxOperatorSchema>;

export const EEDmxConditionSchema = z.object({
  trigger: EEDmxTriggerSchema,
  operator: EEDmxOperatorSchema,
  value: z.number(),
});
export type EEDmxCondition = z.infer<typeof EEDmxConditionSchema>;

/** The plain `> 0` a boolean trigger wants, and EE's own default. */
export function booleanDmxCondition(trigger: string): EEDmxCondition {
  return { trigger, operator: "greater", value: 0 };
}

/** A continuous condition: while `condition` holds, `target` does `effect`. */
export const EEDmxStateSchema = z.object({
  id: z.string().min(1),
  condition: EEDmxConditionSchema,
  target: z.string().min(1),
  effect: EEDmxEffectSchema,
});
export type EEDmxState = z.infer<typeof EEDmxStateSchema>;

/** Which way a value has to move for an event to fire. */
export const EEDmxEdgeSchema = z.enum(["any", "rising", "falling"]);
export type EEDmxEdge = z.infer<typeof EEDmxEdgeSchema>;

/**
 * A one-shot: when `variable` moves, `target` runs `effect` for a while.
 *
 * The effect is the full union, not a list of values — EE builds an
 * event's effect with the same `createEffect()` it uses for a state, so a
 * hull breach can pulse rather than only latch on.
 */
export const EEDmxEventSchema = z.object({
  id: z.string().min(1),
  edge: EEDmxEdgeSchema,
  variable: EEDmxTriggerSchema,
  target: z.string().min(1),
  runtimeS: z.number().positive(),
  effect: EEDmxEffectSchema,
});
export type EEDmxEvent = z.infer<typeof EEDmxEventSchema>;

export const EEDmxRigSchema = z.object({
  /** Free text; never reaches EE. */
  label: z.string(),
  devices: z.array(EEDmxDeviceSchema),
  fixtures: z.array(EEDmxFixtureSchema),
  states: z.array(EEDmxStateSchema),
  events: z.array(EEDmxEventSchema),
});
export type EEDmxRig = z.infer<typeof EEDmxRigSchema>;

/**
 * A device of the given kind, carrying **EE's own defaults** for every
 * setting it accepts.
 *
 * Defaults live here rather than in the editor so the ini the build
 * writes says what EE would have assumed anyway — an explicit
 * `channels = 512` is easier to read back than an absent line whose
 * meaning you have to remember.
 */
export function defaultDmxDevice(id: string, kind: EEDmxDeviceKind): EEDmxDevice {
  switch (kind) {
    case "DMX512SerialDevice":
      return { id, device: kind, port: "", channels: 512, resendDelayMs: 25 };
    case "EnttecDMXProDevice":
      return { id, device: kind, port: "", channels: 512 };
    case "sACNDevice":
      return { id, device: kind, channels: 512, universe: 1, resendDelayMs: 50, multicast: false };
    case "uDMXDevice":
      return { id, device: kind };
    case "PhilipsHueDevice":
      return { id, device: kind, ip: "", port: null, username: "", userfile: "philips_hue.name" };
    case "VirtualOutputDevice":
      return { id, device: kind, channels: 512 };
  }
}

export function emptyDmxRig(): EEDmxRig {
  return { label: "Bridge rig", devices: [], fixtures: [], states: [], events: [] };
}

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------

/**
 * The ship reading the editor's DMX preview runs on.
 *
 * Deliberately its own query rather than a widening of the bridge's
 * `LUA_PLAYER_SHIP_SNAPSHOT`: that one feeds the cockpits at a high rate,
 * and these extra calls — two per system, one per tube — are only wanted
 * while somebody has the DMX view open.
 *
 * **System keys are EmptyEpsilon's, not DMX's.** EE's Lua `ESystem` name
 * is `maneuver`; the DMX trigger prefix is `maneuvering`. Probed
 * 2026-08-17: `getSystemHealth("maneuver")` reads 1.0 on an undamaged
 * ship while `"maneuvering"` reads 0.0, exactly like a nonsense name —
 * EE answers 0 for a system it does not know rather than raising, so the
 * mismatch would have shown as five triggers silently stuck at zero.
 */
export const EEDmxTelemetrySchema = z.object({
  found: z.boolean(),
  hull: z.number(),
  hullMax: z.number(),
  energy: z.number(),
  energyMax: z.number(),
  shields: z.array(z.object({ value: z.number(), max: z.number() })),
  alertLevel: z.enum(["normal", "yellow", "red"]),
  /** Keyed by EE's own system names. All four measures are 0..1. */
  systems: z.record(
    z.string(),
    z.object({
      health: z.number(),
      power: z.number(),
      heat: z.number(),
      coolant: z.number(),
      hacked: z.number(),
    }),
  ),
  shieldsUp: z.boolean(),
  /** `EDockingState`: 0 not docked, 1 docking, 2 docked. */
  dockingState: z.number(),
  jumpDelay: z.number(),
  /** One entry per tube: true when a missile is loaded. */
  tubesLoaded: z.array(z.boolean()),
});
export type EEDmxTelemetry = z.infer<typeof EEDmxTelemetrySchema>;

export const EEDmxTriggerReadingSchema = z.object({
  /** Trigger name → value, already in the range EE's own table documents. */
  values: z.record(z.string(), z.number()),
  /**
   * Triggers EmptyEpsilon exposes to DMX but not to Lua, so the preview
   * cannot read them. Listed rather than shown as zero, which would read
   * as "off" instead of "unknown".
   */
  unreadable: z.array(z.string()),
  /** False when no player ship is in the game. */
  live: z.boolean(),
});
export type EEDmxTriggerReading = z.infer<typeof EEDmxTriggerReadingSchema>;
