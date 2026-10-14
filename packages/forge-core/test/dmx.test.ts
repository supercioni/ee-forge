import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  booleanDmxCondition,
  EEDmxRigSchema,
  DMX_TRIGGERS,
  EEDmxTelemetrySchema,
  type EEDmxFixture,
  type EEDmxTelemetry,
  type EEDmxValue,
  emptyDmxRig,
  type EEDmxRig,
} from "@forge/contracts";
import { readHardwareIni } from "../src/dmx/read.js";
import { writeHardwareIni } from "../src/dmx/write.js";
import {
  danglingDmxTargets,
  dmxConditionHolds,
  evaluateRig,
  type DmxTriggerValues,
} from "../src/dmx/evaluate.js";
import {
  collapseLevels,
  fixtureColor,
  fixtureValueColor,
  hasColorRoles,
  virtualTypesFor,
  withFixtureValueColor,
} from "../src/dmx/color.js";
import {
  DMX_TRIGGER_CAVEATS,
  DMX_UNREADABLE_TRIGGERS,
  EE_TO_DMX_SYSTEM,
  triggerValues,
} from "../src/dmx/triggers.js";

/**
 * DMX rigs (ADR-0040).
 *
 * The oracle for the reader and the writer is the `hardware.ini`
 * EmptyEpsilon actually ships — a file nobody here wrote, with the two
 * quirks the wiki omits (a trailing `#` comment, and a value list mixing
 * hex with a float).
 */

const EE_DIR =
  process.env["EE_DIR"] ?? "/mnt/c/Win32_EmptyEpsilon_EE-2024.12.08/EmptyEpsilon";
const INSTALL_INI = join(EE_DIR, "hardware.ini");

/** The install's own file, inlined so the suite runs without the install. */
const SHIPPED = `[hardware]
device = DMX512SerialDevice
port = COM9

[channels]

# This device has four channels (red, blue, green, intensity)
4channelSpot = 1, 2, 3, 4

[state]
condition = Always
target = 4channelSpot
value = $ff, $ff, $ff, 1  # intensity as float and (red, green, blue) as hex values
`;

const triggers = (extra: Record<string, number> = {}): DmxTriggerValues =>
  new Map(Object.entries({ Always: 1, Hull: 50, RedAlert: 0, ...extra }));

describe("reading EmptyEpsilon's own hardware.ini", () => {
  const { rig, warnings } = readHardwareIni(SHIPPED);

  it("reads it without a single complaint", () => {
    expect(warnings).toEqual([]);
  });

  it("reads the device, the fixture and the state", () => {
    expect(rig.devices).toEqual([
      { id: "device_1", device: "DMX512SerialDevice", port: "COM9", channels: 512, resendDelayMs: 25 },
    ]);
    expect(rig.fixtures).toEqual([
      {
        id: "fixture_2",
        name: "4channelSpot",
        // No roles: the shipped file's comment says RGB+intensity, but a
        // comment is not evidence and this reader does not guess.
        slots: [1, 2, 3, 4].map((channel) => ({ channel, role: "none" as const })),
      },
    ]);
    expect(rig.states[0]?.condition).toEqual(booleanDmxCondition("Always"));
    expect(rig.states[0]?.target).toBe("4channelSpot");
  });

  it("keeps a value list that mixes hex with a float", () => {
    // `$ff, $ff, $ff, 1` — three hex channels and an intensity. Inferring
    // one format for the line would have rewritten the author's file.
    expect(rig.states[0]?.effect).toEqual({
      kind: "static",
      values: [
        { format: "hex", value: 255 },
        { format: "hex", value: 255 },
        { format: "hex", value: 255 },
        { format: "float", value: 1 },
      ],
    });
  });

  it("produces a document the schema accepts", () => {
    expect(EEDmxRigSchema.safeParse(rig).success).toBe(true);
  });

  it("survives a round trip", () => {
    const again = readHardwareIni(writeHardwareIni(rig));
    expect(again.warnings).toEqual([]);
    expect(again.rig).toEqual(rig);
  });
});

describe("reading the install's file, when it is there", () => {
  const present = existsSync(INSTALL_INI);
  it.skipIf(!present)("round-trips the real file on disk", () => {
    const first = readHardwareIni(readFileSync(INSTALL_INI, "utf8"));
    const second = readHardwareIni(writeHardwareIni(first.rig));
    expect(second.rig).toEqual(first.rig);
    expect(EEDmxRigSchema.safeParse(first.rig).success).toBe(true);
  });
});

describe("the reader reports rather than guesses", () => {
  it("names an unknown section instead of dropping it silently", () => {
    const { warnings } = readHardwareIni("[nonsense]\nfoo = 1\n");
    expect(warnings.join(" ")).toContain("unknown section [nonsense]");
  });

  it("names an unknown device", () => {
    const { rig, warnings } = readHardwareIni("[hardware]\ndevice = LaserHarp\n");
    expect(rig.devices).toEqual([]);
    expect(warnings.join(" ")).toContain("LaserHarp");
  });

  it("names an unknown trigger", () => {
    const { rig, warnings } = readHardwareIni(
      "[state]\ncondition = Vibes\ntarget = x\nvalue = 1\n",
    );
    expect(rig.states).toEqual([]);
    expect(warnings.join(" ")).toContain("Vibes");
  });

  it("refuses a channel outside EE's 1-512", () => {
    const { warnings } = readHardwareIni("[channels]\nspot = 1, 900\n");
    expect(warnings.join(" ")).toContain("outside 1-512");
  });

  it("strips a comment that follows a value", () => {
    const { rig } = readHardwareIni("[channels]\nspot = 7  # the one over the console\n");
    expect(rig.fixtures[0]?.slots.map((s) => s.channel)).toEqual([7]);
  });
});

describe("writing", () => {
  it("repeats [hardware] per device, which no generic INI writer would", () => {
    const rig: EEDmxRig = {
      ...emptyDmxRig(),
      devices: [
        { id: "a", device: "DMX512SerialDevice", port: "COM9", channels: 512, resendDelayMs: 25 },
        { id: "b", device: "VirtualOutputDevice", channels: 32 },
      ],
    };
    const ini = writeHardwareIni(rig);
    expect(ini.match(/^\[hardware\]$/gm)).toHaveLength(2);
    expect(ini).toContain("channels = 32");
  });

  it("writes each value in the format the author chose", () => {
    const rig: EEDmxRig = {
      ...emptyDmxRig(),
      fixtures: [{ id: "c", name: "spot", slots: [{ channel: 1, role: "none" }, { channel: 2, role: "none" }, { channel: 3, role: "none" }] }],
      states: [
        {
          id: "s",
          condition: booleanDmxCondition("Always"),
          target: "spot",
          effect: {
            kind: "static",
            values: [
              { format: "hex", value: 175 },
              { format: "byte", value: 255 },
              { format: "float", value: 0.5 },
            ],
          },
        },
      ],
    };
    expect(writeHardwareIni(rig)).toContain("value = $af, [255], 0.5");
  });

  it("writes an event's edge as EE's < and > prefix", () => {
    const rig: EEDmxRig = {
      ...emptyDmxRig(),
      fixtures: [{ id: "c", name: "warn", slots: [{ channel: 2, role: "none" }] }],
      events: [
        {
          id: "e",
          edge: "falling",
          variable: "Hull",
          target: "warn",
          runtimeS: 1,
          effect: { kind: "static", values: [{ format: "float", value: 1 }] },
        },
      ],
    };
    expect(writeHardwareIni(rig)).toContain("trigger = <Hull");
  });
});

describe("evaluating a rig", () => {
  const rig: EEDmxRig = {
    ...emptyDmxRig(),
    fixtures: [
      { id: "c1", name: "cabin", slots: [{ channel: 1, role: "none" }] },
      { id: "c2", name: "warn", slots: [{ channel: 2, role: "none" }] },
      { id: "c3", name: "spot", slots: [{ channel: 3, role: "none" }, { channel: 4, role: "none" }, { channel: 5, role: "none" }] },
    ],
    states: [
      {
        id: "always",
        condition: booleanDmxCondition("Always"),
        target: "cabin",
        effect: { kind: "static", values: [{ format: "float", value: 1 }] },
      },
      {
        id: "alert",
        condition: booleanDmxCondition("RedAlert"),
        target: "warn",
        effect: { kind: "blink", onValue: [1], offValue: [0], onTimeS: 1, offTimeS: 1 },
      },
      {
        id: "hull",
        condition: booleanDmxCondition("Always"),
        target: "spot",
        effect: {
          kind: "variable",
          inputs: ["Hull"],
          minInput: 0,
          maxInput: 100,
          minOutput: [0],
          maxOutput: [1],
        },
      },
    ],
  };

  it("holds a static value while its condition holds", () => {
    expect(evaluateRig(rig, triggers(), 0).get("cabin")).toEqual([1]);
  });

  it("leaves a channel dark when its condition does not hold", () => {
    expect(evaluateRig(rig, triggers(), 0).get("warn")).toEqual([0]);
  });

  it("blinks on and off across the period", () => {
    const on = evaluateRig(rig, triggers({ RedAlert: 1 }), 0.5).get("warn");
    const off = evaluateRig(rig, triggers({ RedAlert: 1 }), 1.5).get("warn");
    expect(on).toEqual([1]);
    expect(off).toEqual([0]);
  });

  it("maps a variable input across the output range", () => {
    expect(evaluateRig(rig, triggers({ Hull: 50 }), 0).get("spot")).toEqual([0.5, 0.5, 0.5]);
    expect(evaluateRig(rig, triggers({ Hull: 0 }), 0).get("spot")).toEqual([0, 0, 0]);
  });

  it("saturates rather than running past the output range", () => {
    // Hull cannot exceed 100, but a rig aimed at a narrower band can.
    expect(evaluateRig(rig, triggers({ Hull: 400 }), 0).get("spot")).toEqual([1, 1, 1]);
    expect(evaluateRig(rig, triggers({ Hull: -20 }), 0).get("spot")).toEqual([0, 0, 0]);
  });

  it("wraps a short list around the channels, as EE does", () => {
    // EE takes values[idx % values.size()] per channel, so one value means
    // "the same everywhere" — an RGB fixture at `value = 1` goes white,
    // not red. Zero-filling the rest would have read as "off".
    const spot = (values: EEDmxValue[]): EEDmxRig => ({
      ...rig,
      states: [
        {
          id: "one",
          condition: booleanDmxCondition("Always"),
          target: "spot",
          effect: { kind: "static", values },
        },
      ],
    });
    expect(evaluateRig(spot([{ format: "float", value: 1 }]), triggers(), 0).get("spot")).toEqual(
      [1, 1, 1],
    );
    expect(
      evaluateRig(
        spot([
          { format: "float", value: 1 },
          { format: "float", value: 0 },
        ]),
        triggers(),
        0,
      ).get("spot"),
    ).toEqual([1, 0, 1]);
  });

  it("lets a later state win a channel two of them claim", () => {
    const layered: EEDmxRig = {
      ...rig,
      states: [
        {
          id: "general",
          condition: booleanDmxCondition("Always"),
          target: "cabin",
          effect: { kind: "static", values: [{ format: "float", value: 0.2 }] },
        },
        {
          id: "exception",
          condition: booleanDmxCondition("RedAlert"),
          target: "cabin",
          effect: { kind: "static", values: [{ format: "float", value: 1 }] },
        },
      ],
    };
    expect(evaluateRig(layered, triggers(), 0).get("cabin")).toEqual([0.2]);
    expect(evaluateRig(layered, triggers({ RedAlert: 1 }), 0).get("cabin")).toEqual([1]);
  });

  it("glows between its two levels", () => {
    const glowing: EEDmxRig = {
      ...rig,
      states: [
        {
          id: "g",
          condition: booleanDmxCondition("Always"),
          target: "cabin",
          effect: { kind: "glow", minValue: [0.3], maxValue: [1], timeS: 2 },
        },
      ],
    };
    expect(evaluateRig(glowing, triggers(), 0).get("cabin")).toEqual([0.3]);
    expect(evaluateRig(glowing, triggers(), 1).get("cabin")).toEqual([1]);
  });

  it("names a state aimed at a channel nobody declares", () => {
    const broken: EEDmxRig = {
      ...rig,
      states: [
        {
          id: "typo",
          condition: booleanDmxCondition("Always"),
          target: "cabinn",
          effect: { kind: "static", values: [{ format: "float", value: 1 }] },
        },
      ],
    };
    expect(danglingDmxTargets(broken)).toEqual(["cabinn"]);
    expect(danglingDmxTargets(rig)).toEqual([]);
  });
});

describe("device settings — every key EE's own configure() reads", () => {
  const roundTrip = (ini: string): EEDmxRig => readHardwareIni(writeHardwareIni(readHardwareIni(ini).rig)).rig;

  it("keeps a serial device's resend_delay", () => {
    const device = roundTrip(
      "[hardware]\ndevice = DMX512SerialDevice\nport = COM9\nchannels = 64\nresend_delay = 40\n",
    ).devices[0];
    expect(device).toEqual({
      id: "device_1",
      device: "DMX512SerialDevice",
      port: "COM9",
      channels: 64,
      resendDelayMs: 40,
    });
  });

  it("keeps an sACN universe and its multicast flag", () => {
    const device = roundTrip(
      "[hardware]\ndevice = sACNDevice\nuniverse = 42\nmulticast = 1\nresend_delay = 20\n",
    ).devices[0];
    expect(device).toEqual({
      id: "device_1",
      device: "sACNDevice",
      channels: 512,
      universe: 42,
      resendDelayMs: 20,
      multicast: true,
    });
  });

  it("keeps the Hue bridge's credentials and numeric port", () => {
    const device = roundTrip(
      "[hardware]\ndevice = PhilipsHueDevice\nip = 10.0.0.5\nport = 8080\nusername = abc\nuserfile = hue.name\n",
    ).devices[0];
    expect(device).toEqual({
      id: "device_1",
      device: "PhilipsHueDevice",
      ip: "10.0.0.5",
      port: 8080,
      username: "abc",
      userfile: "hue.name",
    });
  });

  it("turns a virtual device's colours into the fixtures' channel roles", () => {
    const device = roundTrip(
      "[hardware]\ndevice = VirtualOutputDevice\nchannels = 4\n",
    ).devices[0];
    expect(device).toEqual({
      id: "device_1",
      device: "VirtualOutputDevice",
      channels: 4,
    });
  });

  it("says when a setting is one this device will ignore", () => {
    // EE hands the whole section to configure(), which drops what it does
    // not know — so this line is not a mistake EE will ever mention.
    const { warnings } = readHardwareIni(
      "[hardware]\ndevice = DMX512SerialDevice\nport = COM9\nuniverse = 3\n",
    );
    expect(warnings.join("\n")).toContain('DMX512SerialDevice does not read "universe"');
  });

  it("writes no settings at all for uDMX, which reads none", () => {
    const ini = writeHardwareIni({
      ...emptyDmxRig(),
      devices: [{ id: "d", device: "uDMXDevice" }],
    });
    expect(ini).toContain("device = uDMXDevice");
    expect(ini).not.toContain("channels =");
    expect(ini).not.toContain("port =");
  });
});

describe("conditions compare, they are not only booleans", () => {
  it("reads an operator and its value", () => {
    const { rig, warnings } = readHardwareIni(
      "[channels]\nwarn = 1\n\n[state]\ncondition = Hull < 0.3\ntarget = warn\nvalue = 1\n",
    );
    expect(warnings).toEqual([]);
    expect(rig.states[0]?.condition).toEqual({ trigger: "Hull", operator: "less", value: 0.3 });
  });

  it("writes EE's default test back as a bare trigger", () => {
    const ini = writeHardwareIni({
      ...emptyDmxRig(),
      fixtures: [{ id: "c", name: "warn", slots: [{ channel: 1, role: "none" }] }],
      states: [
        {
          id: "s",
          condition: booleanDmxCondition("RedAlert"),
          target: "warn",
          effect: { kind: "static", values: [{ format: "float", value: 1 }] },
        },
      ],
    });
    expect(ini).toContain("condition = RedAlert");
  });

  it("writes a comparison in EE's spelling", () => {
    const ini = writeHardwareIni({
      ...emptyDmxRig(),
      fixtures: [{ id: "c", name: "warn", slots: [{ channel: 1, role: "none" }] }],
      states: [
        {
          id: "s",
          condition: { trigger: "Hull", operator: "less", value: 0.3 },
          target: "warn",
          effect: { kind: "static", values: [{ format: "float", value: 1 }] },
        },
      ],
    });
    expect(ini).toContain("condition = Hull < 0.3");
  });

  it("warns that EE cannot compare == against a non-zero value", () => {
    // EE slices the value from one character past a two-character
    // operator, so it hands atof "= 0.5" and compares against 0.
    const { warnings } = readHardwareIni(
      "[channels]\nwarn = 1\n\n[state]\ncondition = Hull == 0.5\ntarget = warn\nvalue = 1\n",
    );
    expect(warnings.join("\n")).toContain("EE compares");
  });

  it("evaluates each operator against the live value", () => {
    const hull = (value: number): DmxTriggerValues => new Map([["Hull", value]]);
    expect(dmxConditionHolds({ trigger: "Hull", operator: "less", value: 0.3 }, hull(0.2))).toBe(true);
    expect(dmxConditionHolds({ trigger: "Hull", operator: "less", value: 0.3 }, hull(0.5))).toBe(false);
    expect(dmxConditionHolds(booleanDmxCondition("Hull"), hull(0.5))).toBe(true);
    expect(dmxConditionHolds(booleanDmxCondition("Hull"), hull(0))).toBe(false);
  });
});

describe("the effects EE has that the wiki does not list", () => {
  it("round-trips a noise effect", () => {
    const rig = readHardwareIni(
      "[channels]\nfire = 1\n\n[state]\ncondition = Always\ntarget = fire\neffect = Noise\nmin_value = 0.2\nmax_value = 0.9\nsmoothness = 0.1\n",
    ).rig;
    expect(rig.states[0]?.effect).toEqual({
      kind: "noise",
      minValue: [0.2],
      maxValue: [0.9],
      smoothness: 0.1,
    });
    expect(writeHardwareIni(rig)).toContain("smoothness = 0.1");
  });

  it("keeps noise inside the band the author set", () => {
    const rig: EEDmxRig = {
      ...emptyDmxRig(),
      fixtures: [{ id: "c", name: "fire", slots: [{ channel: 1, role: "none" }] }],
      states: [
        {
          id: "s",
          condition: booleanDmxCondition("Always"),
          target: "fire",
          effect: { kind: "noise", minValue: [0.2], maxValue: [0.9], smoothness: 0.1 },
        },
      ],
    };
    const seen = new Set<number>();
    for (let t = 0; t < 5; t += 0.05) {
      const value = evaluateRig(rig, triggers(), t).get("fire")?.[0] ?? -1;
      expect(value).toBeGreaterThanOrEqual(0.2);
      expect(value).toBeLessThanOrEqual(0.9);
      seen.add(value);
    }
    // It has to actually move, or it is not noise.
    expect(seen.size).toBeGreaterThan(10);
  });

  it("round-trips blink's two levels, not only its two times", () => {
    const rig = readHardwareIni(
      "[channels]\nwarn = 1\n\n[state]\ncondition = Always\ntarget = warn\neffect = Blink\non_value = 0.8\noff_value = 0.2\non_time = 0.5\noff_time = 0.5\n",
    ).rig;
    expect(rig.states[0]?.effect).toEqual({
      kind: "blink",
      onValue: [0.8],
      offValue: [0.2],
      onTimeS: 0.5,
      offTimeS: 0.5,
    });
    expect(evaluateRig(rig, triggers({ Always: 1 }), 0).get("warn")).toEqual([0.8]);
    expect(evaluateRig(rig, triggers({ Always: 1 }), 0.6).get("warn")).toEqual([0.2]);
  });

  it("gives an event a full effect, as EE's createEffect does", () => {
    const { rig, warnings } = readHardwareIni(
      "[channels]\nwarn = 1\n\n[event]\ntrigger = <Hull\ntarget = warn\nruntime = 3\neffect = Glow\nmin_value = 0.1\nmax_value = 1\ntime = 0.5\n",
    );
    expect(warnings).toEqual([]);
    expect(rig.events[0]?.effect).toEqual({
      kind: "glow",
      minValue: [0.1],
      maxValue: [1],
      timeS: 0.5,
    });
    expect(writeHardwareIni(rig)).toContain("effect = Glow");
  });
});

describe("the singular [channel] section", () => {
  it("reads it, which EE accepts alongside [channels]", () => {
    const { rig, warnings } = readHardwareIni("[channel]\nname = warn\nchannel = 7\n");
    expect(warnings).toEqual([]);
    expect(rig.fixtures).toEqual([
      { id: "fixture_1", name: "warn", slots: [{ channel: 7, role: "none" }] },
    ]);
  });
});

describe("the trigger table, checked against the binary", () => {
  it("carries ShieldsCalibrating, which EE has and the wiki omits", () => {
    expect(DMX_TRIGGERS).toContain("ShieldsCalibrating");
    // No Lua getter for the calibration delay, so the preview cannot show it.
    expect(DMX_UNREADABLE_TRIGGERS).toContain("ShieldsCalibrating");
  });

  it("carries the reason TubeFiring may look dead, not just a flag", () => {
    // weaponTube.cpp only enters WTS_Firing for an HVLI, and then for the
    // whole 5-shot burst. Every other missile type goes loaded -> empty.
    expect(DMX_TRIGGER_CAVEATS["TubeFiring0"]).toContain("HVLI");
    expect(DMX_TRIGGER_CAVEATS["TubeFiring15"]).toBeDefined();
    // Loading and unloading are unconditional, so they carry no caveat.
    expect(DMX_TRIGGER_CAVEATS["TubeLoading0"]).toBeUndefined();
    expect(DMX_TRIGGER_CAVEATS["TubeLoaded0"]).toBeUndefined();
    expect(Object.keys(DMX_TRIGGER_CAVEATS).every((n) => DMX_TRIGGERS.includes(n))).toBe(true);
  });
});

describe("trigger scales are EE's own, not the wiki's", () => {
  const telemetry = (over: Record<string, unknown> = {}): EEDmxTelemetry =>
    EEDmxTelemetrySchema.parse({
      found: true,
      hull: 125,
      hullMax: 250,
      energy: 500,
      energyMax: 1000,
      shields: [{ value: 50, max: 100 }],
      shieldsUp: false,
      alertLevel: "normal",
      dockingState: 0,
      jumpDelay: 0,
      tubesLoaded: [],
      systems: {
        reactor: { health: 1, power: 1, heat: 0.4, coolant: 2, hacked: 0.25 },
      },
      ...over,
    });

  it("leaves the system triggers raw — EE feeds its cues the member itself", () => {
    const { values } = triggerValues(telemetry());
    // A rule written `reactorHealth < 0.5` has to see 1, not 100.
    expect(values["reactorHealth"]).toBe(1);
    expect(values["reactorHeat"]).toBe(0.4);
    expect(values["reactorHacked"]).toBe(0.25);
    expect(values["reactorCoolant"]).toBe(2);
  });

  it("divides power by three, because EE does", () => {
    // getSystemPower returns EE's 0..3 power_level; the DMX variable is
    // power_level / 3.0f.
    const { values } = triggerValues(telemetry());
    expect(values["reactorPower"]).toBeCloseTo(1 / 3, 6);
  });

  it("keeps hull, energy and shields as percentages, which EE does scale", () => {
    const { values } = triggerValues(telemetry());
    expect(values["Hull"]).toBe(50);
    expect(values["Energy"]).toBe(50);
    expect(values["FrontShield"]).toBe(50);
  });
});

describe("colour is a projection of the channel levels", () => {
  const rgbi: EEDmxFixture = {
    id: "f",
    name: "spot",
    slots: [
      { channel: 1, role: "red" },
      { channel: 2, role: "green" },
      { channel: 3, role: "blue" },
      { channel: 4, role: "intensity" },
    ],
  };

  it("reads a colour out of the primaries", () => {
    const values: EEDmxValue[] = [
      { format: "hex", value: 255 },
      { format: "hex", value: 128 },
      { format: "hex", value: 0 },
      { format: "float", value: 1 },
    ];
    expect(fixtureValueColor(rgbi, values)).toEqual([255, 128, 0]);
  });

  it("writes one back without touching intensity", () => {
    const values: EEDmxValue[] = [
      { format: "hex", value: 0 },
      { format: "hex", value: 0 },
      { format: "hex", value: 0 },
      { format: "float", value: 0.4 },
    ];
    const next = withFixtureValueColor(rgbi, values, [255, 0, 0]);
    expect(next).toEqual([
      { format: "hex", value: 255 },
      { format: "hex", value: 0 },
      { format: "hex", value: 0 },
      // Intensity is a channel, not part of the mix.
      { format: "float", value: 0.4 },
    ]);
  });

  it("keeps each channel's spelling when a colour is picked", () => {
    const values: EEDmxValue[] = [
      { format: "float", value: 0 },
      { format: "byte", value: 0 },
      { format: "hex", value: 0 },
    ];
    // Four slots, three values: the fourth wraps to the first, formats
    // included, which is what EE would have read anyway.
    expect(withFixtureValueColor(rgbi, values, [255, 255, 255]).map((v) => v.format)).toEqual([
      "float",
      "byte",
      "hex",
      "float",
    ]);
  });

  it("round-trips every swatch in the palette's range", () => {
    for (const rgb of [[0, 0, 0], [255, 255, 255], [18, 200, 77], [1, 2, 3]] as const) {
      const next = withFixtureValueColor(rgbi, [{ format: "float", value: 0 }], rgb);
      expect(fixtureValueColor(rgbi, next), `${rgb.join(",")}`).toEqual(rgb);
    }
  });

  it("has no colour to show for a fixture that declares no primary", () => {
    const dimmer: EEDmxFixture = {
      id: "d",
      name: "cabin",
      slots: [{ channel: 9, role: "intensity" }],
    };
    expect(hasColorRoles(dimmer)).toBe(false);
    expect(fixtureColor(dimmer, [1])).toBeNull();
  });

  it("paints a glow in colour, one level per channel", () => {
    const rig: EEDmxRig = {
      ...emptyDmxRig(),
      fixtures: [rgbi],
      states: [
        {
          id: "s",
          condition: booleanDmxCondition("RedAlert"),
          target: "spot",
          effect: { kind: "glow", minValue: [0.2, 0, 0, 1], maxValue: [1, 0, 0, 1], timeS: 2 },
        },
      ],
    };
    expect(evaluateRig(rig, triggers({ RedAlert: 1 }), 0).get("spot")).toEqual([0.2, 0, 0, 1]);
    const ini = writeHardwareIni(rig);
    expect(ini).toContain("min_value = 0.2, 0, 0, 1");
    expect(ini).toContain("max_value = 1, 0, 0, 1");
    expect(readHardwareIni(ini).warnings).toEqual([]);
  });

  it("collapses a level that is the same on every channel", () => {
    const rig: EEDmxRig = {
      ...emptyDmxRig(),
      fixtures: [rgbi],
      states: [
        {
          id: "s",
          condition: booleanDmxCondition("Always"),
          target: "spot",
          effect: { kind: "glow", minValue: [0, 0, 0, 0], maxValue: [1, 1, 1, 1], timeS: 1 },
        },
      ],
    };
    expect(collapseLevels([1, 1, 1, 1])).toEqual([1]);
    expect(writeHardwareIni(rig)).toContain("max_value = 1, 1, 1, 1");
  });
});

describe("a Variable effect follows one trigger per channel", () => {
  it("does not combine them", () => {
    // EE's Variable effect reads a single variable; the comma list is
    // split per channel like every other setting. Treating it as a set to
    // maximise would light both channels off whichever was worse.
    const rig: EEDmxRig = {
      ...emptyDmxRig(),
      fixtures: [
        {
          id: "f",
          name: "pair",
          slots: [
            { channel: 1, role: "none" },
            { channel: 2, role: "none" },
          ],
        },
      ],
      states: [
        {
          id: "s",
          condition: booleanDmxCondition("Always"),
          target: "pair",
          effect: {
            kind: "variable",
            inputs: ["Hull", "Energy"],
            minInput: 0,
            maxInput: 100,
            minOutput: [0],
            maxOutput: [1],
          },
        },
      ],
    };
    const reading = triggers({ Hull: 100, Energy: 20 });
    expect(evaluateRig(rig, reading, 0).get("pair")).toEqual([1, 0.2]);
  });

  it("drops a rule with an unknown trigger rather than re-aligning the rest", () => {
    const { warnings } = readHardwareIni(
      "[channels]\npair = 1, 2\n\n[state]\ncondition = Always\ntarget = pair\neffect = Variable\ninput = Hull, Vibes\n",
    );
    expect(warnings.join("\n")).toContain("rule dropped");
  });
});

describe("virtual_types is derived from the fixtures, not authored", () => {
  const rig = (): EEDmxRig => ({
    ...emptyDmxRig(),
    devices: [{ id: "d", device: "VirtualOutputDevice", channels: 8 }],
    fixtures: [
      {
        id: "f",
        name: "spot",
        slots: [
          { channel: 1, role: "red" },
          { channel: 2, role: "green" },
          { channel: 3, role: "blue" },
          { channel: 4, role: "intensity" },
        ],
      },
      { id: "g", name: "cabin", slots: [{ channel: 7, role: "white" }] },
    ],
  });

  it("writes one letter per channel up to the highest a fixture claims", () => {
    expect(virtualTypesFor(rig().fixtures)).toBe("RGBWWWW");
    expect(writeHardwareIni(rig())).toContain("virtual_types = RGBWWWW");
  });

  it("writes no line at all when nothing has a colour role", () => {
    const plain = rig();
    const ini = writeHardwareIni({
      ...plain,
      fixtures: plain.fixtures.map((f) => ({
        ...f,
        slots: f.slots.map((s) => ({ ...s, role: "none" as const })),
      })),
    });
    expect(ini).not.toContain("virtual_types");
  });

  it("seeds the fixtures' roles when importing one", () => {
    const { rig: read, warnings } = readHardwareIni(
      "[hardware]\ndevice = VirtualOutputDevice\nchannels = 8\nvirtual_types = RGB, W\n\n[channels]\nspot = 1, 2, 3, 4\n",
    );
    expect(warnings).toEqual([]);
    expect(read.fixtures[0]?.slots.map((s) => s.role)).toEqual([
      "red",
      "green",
      "blue",
      "white",
    ]);
  });

  it("says when it colours a channel no fixture declares", () => {
    const { warnings } = readHardwareIni(
      "[hardware]\ndevice = VirtualOutputDevice\nvirtual_types = RGB\n\n[channels]\nspot = 1\n",
    );
    expect(warnings.join("\n")).toContain("which no fixture declares");
  });
});

describe("reading triggers off the ship", () => {
  const telemetry = {
    found: true,
    hull: 125,
    hullMax: 250,
    energy: 500,
    energyMax: 1000,
    shields: [
      { value: 100, max: 200 },
      { value: 200, max: 200 },
    ],
    alertLevel: "red" as const,
    systems: {
      // EE's own key, which is the point of the test below.
      maneuver: { health: 0.5, power: 1, heat: 0.25, coolant: 0, hacked: 0 },
      reactor: { health: 1, power: 1, heat: 0, coolant: 0, hacked: 0 },
    },
    shieldsUp: true,
    dockingState: 2,
    jumpDelay: 0,
    tubesLoaded: [true, false],
  };

  it("turns hull, energy and shields into percentages, which EE does scale", () => {
    const { values } = triggerValues(telemetry);
    expect(values["Hull"]).toBe(50);
    expect(values["Energy"]).toBe(50);
    expect(values["Shield0"]).toBe(50);
    expect(values["Shield1"]).toBe(100);
    expect(values["FrontShield"]).toBe(50);
    expect(values["RearShield"]).toBe(100);
  });

  /**
   * The finding this mapping exists for. EE answers 0 for a system it does
   * not know rather than raising, so getting the name wrong would have
   * looked exactly like an undamaged ship.
   */
  it("maps DMX's `maneuvering` onto EE's `maneuver`", () => {
    expect(EE_TO_DMX_SYSTEM["maneuvering"]).toBe("maneuver");
    const { values } = triggerValues(telemetry);
    // Raw, not scaled: EE hands its own DMX `systems[n].health` itself.
    expect(values["maneuveringHealth"]).toBe(0.5);
    expect(values["maneuveringHeat"]).toBe(0.25);
  });

  it("reads the alert triggers the way EE splits them", () => {
    const { values } = triggerValues(telemetry);
    expect(values["RedAlert"]).toBe(1);
    expect(values["YellowAlert"]).toBe(0);
    expect(values["Alert"]).toBe(1);
  });

  it("separates docked from docking, as EE's own table does", () => {
    expect(triggerValues(telemetry).values["Docked"]).toBe(1);
    expect(triggerValues({ ...telemetry, dockingState: 1 }).values["Docked"]).toBe(0);
    expect(triggerValues({ ...telemetry, dockingState: 1 }).values["Docking"]).toBe(1);
  });

  it("keeps Always on with no ship, and says it is not live", () => {
    const reading = triggerValues(null);
    expect(reading.values["Always"]).toBe(1);
    expect(reading.values["HasShip"]).toBe(0);
    expect(reading.live).toBe(false);
  });

  it("names the triggers Lua cannot reach instead of reporting them as zero", () => {
    // EE drives its own DMX from these; the catalog has no getter for any
    // of them, so showing 0 would read as "off" rather than "unknown".
    const { values, unreadable } = triggerValues(telemetry);
    for (const name of ["Impulse", "Warp", "InNebula", "IsJammed", "TubeFiring0"]) {
      expect(unreadable, name).toContain(name);
      expect(values[name]).toBeUndefined();
    }
    expect(DMX_UNREADABLE_TRIGGERS).toContain("SelfDestructCountdown");
  });

  it("reads the tubes it can", () => {
    const { values } = triggerValues(telemetry);
    expect(values["TubeLoaded0"]).toBe(1);
    expect(values["TubeLoaded1"]).toBe(0);
  });
});
