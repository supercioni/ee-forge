import type {
  EEDmxCondition,
  EEDmxDevice,
  EEDmxEffect,
  EEDmxFixture,
  EEDmxRig,
  EEDmxValue,
} from "@forge/contracts";
import { virtualTypesFor } from "./color.js";

/**
 * Renders a rig to EmptyEpsilon's `hardware.ini` (ADR-0040).
 *
 * Hand-written rather than run through an INI library, for one reason
 * that rules the format out: **`[hardware]`, `[state]` and `[event]`
 * repeat**. A generic serialiser keyed by section name would collapse two
 * devices into one, or refuse the file entirely.
 *
 * The output is deliberately close to the file EE ships — same key order,
 * same spacing — so a diff against a hand-written original reads.
 */

type EEDmxEvent = EEDmxRig["events"][number];

/** `0.5`, `$af`, or `[255]` — the three formats EE accepts. */
export function renderDmxValue(value: EEDmxValue): string {
  switch (value.format) {
    case "float":
      return String(value.value);
    case "hex":
      return `$${value.value.toString(16).padStart(2, "0")}`;
    case "byte":
      return `[${value.value}]`;
  }
}

function renderValues(values: readonly EEDmxValue[]): string {
  return values.map(renderDmxValue).join(", ");
}

/**
 * A level list, as EE reads it back.
 *
 * One entry means "the same on every channel" — EE takes
 * `values[idx % values.size()]` per channel — so the common case still
 * writes a single number.
 */
function renderLevels(levels: readonly number[]): string {
  return levels.join(", ");
}

function effectLines(effect: EEDmxEffect): string[] {
  switch (effect.kind) {
    case "static":
      return [`value = ${renderValues(effect.values)}`];
    case "glow":
      return [
        "effect = Glow",
        `min_value = ${renderLevels(effect.minValue)}`,
        `max_value = ${renderLevels(effect.maxValue)}`,
        `time = ${effect.timeS}`,
      ];
    case "blink":
      return [
        "effect = Blink",
        `on_value = ${renderLevels(effect.onValue)}`,
        `off_value = ${renderLevels(effect.offValue)}`,
        `on_time = ${effect.onTimeS}`,
        `off_time = ${effect.offTimeS}`,
      ];
    case "variable":
      return [
        "effect = Variable",
        `input = ${effect.inputs.join(", ")}`,
        `min_input = ${effect.minInput}`,
        `max_input = ${effect.maxInput}`,
        `min_output = ${renderLevels(effect.minOutput)}`,
        `max_output = ${renderLevels(effect.maxOutput)}`,
      ];
    case "noise":
      return [
        "effect = Noise",
        `min_value = ${renderLevels(effect.minValue)}`,
        `max_value = ${renderLevels(effect.maxValue)}`,
        `smoothness = ${effect.smoothness}`,
      ];
  }
}

/**
 * `RedAlert`, or `Hull < 0.3`.
 *
 * The bare form is emitted whenever the test is EE's own default (`> 0`),
 * so a boolean trigger reads the way every hand-written file writes it.
 */
export function renderDmxCondition(condition: EEDmxCondition): string {
  if (condition.operator === "greater" && condition.value === 0) return condition.trigger;
  const symbol = {
    greater: ">",
    less: "<",
    equal: "==",
    notEqual: "!=",
  }[condition.operator];
  return `${condition.trigger} ${symbol} ${condition.value}`;
}

/** Only the keys EE's `configure()` reads for this kind of device. */
function deviceLines(device: EEDmxDevice, fixtures: readonly EEDmxFixture[]): string[] {
  switch (device.device) {
    case "DMX512SerialDevice":
      return [
        `port = ${device.port}`,
        `channels = ${device.channels}`,
        `resend_delay = ${device.resendDelayMs}`,
      ];
    case "EnttecDMXProDevice":
      return [`port = ${device.port}`, `channels = ${device.channels}`];
    case "sACNDevice":
      return [
        `channels = ${device.channels}`,
        `universe = ${device.universe}`,
        `resend_delay = ${device.resendDelayMs}`,
        `multicast = ${device.multicast ? 1 : 0}`,
      ];
    case "uDMXDevice":
      return [];
    case "PhilipsHueDevice": {
      const lines = [`ip = ${device.ip}`];
      if (device.port !== null) lines.push(`port = ${device.port}`);
      // An empty username is how EE is told to ask the bridge for one, so
      // the line is omitted rather than written blank.
      if (device.username !== "") lines.push(`username = ${device.username}`);
      if (device.userfile !== "") lines.push(`userfile = ${device.userfile}`);
      return lines;
    }
    case "VirtualOutputDevice": {
      const lines = [`channels = ${device.channels}`];
      // Derived from the fixtures' channel roles rather than authored:
      // it is the same fact, and two copies of a fact drift.
      const types = virtualTypesFor(fixtures);
      if (types !== "") lines.push(`virtual_types = ${types}`);
      return lines;
    }
  }
}

/** The `<`/`>` prefix EE reads as "only when it falls / rises". */
function edgePrefix(edge: EEDmxEvent["edge"]): string {
  switch (edge) {
    case "rising":
      return ">";
    case "falling":
      return "<";
    case "any":
      return "";
  }
}

export function writeHardwareIni(rig: EEDmxRig): string {
  const out: string[] = [
    "# GENERATED BY EE FORGE — DO NOT EDIT",
    "#",
    "# Edit the rig in the editor's DMX view and build again. Hand edits",
    "# here are overwritten on the next build.",
  ];
  if (rig.label !== "") out.push(`# rig: ${rig.label}`);

  for (const device of rig.devices) {
    out.push("", "[hardware]", `device = ${device.device}`, ...deviceLines(device, rig.fixtures));
  }

  if (rig.fixtures.length > 0) {
    out.push("", "[channels]");
    for (const fixture of rig.fixtures) {
      out.push(`${fixture.name} = ${fixture.slots.map((slot) => slot.channel).join(", ")}`);
    }
  }

  for (const state of rig.states) {
    out.push(
      "",
      "[state]",
      `condition = ${renderDmxCondition(state.condition)}`,
      `target = ${state.target}`,
    );
    out.push(...effectLines(state.effect));
  }

  for (const event of rig.events) {
    out.push(
      "",
      "[event]",
      `trigger = ${edgePrefix(event.edge)}${event.variable}`,
      `target = ${event.target}`,
      `runtime = ${event.runtimeS}`,
      ...effectLines(event.effect),
    );
  }

  return `${out.join("\n")}\n`;
}
