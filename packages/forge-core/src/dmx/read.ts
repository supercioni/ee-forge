import {
  DMX_TRIGGERS,
  EE_DMX_DEVICES,
  emptyDmxRig,
  type EEDmxCondition,
  type EEDmxDevice,
  type EEDmxDeviceKind,
  type EEDmxEdge,
  type EEDmxEffect,
  type EEDmxOperator,
  type EEDmxFixture,
  type EEDmxRig,
  type EEDmxValue,
} from "@forge/contracts";
import { roleOfVirtualType } from "./color.js";

/**
 * Reads an existing `hardware.ini` into a rig document (ADR-0040).
 *
 * Same discipline as `scan/lua-data.ts`, and for the same reason: this
 * reads a file a person wrote by hand, so it **reports what it cannot
 * understand instead of guessing**. A rig that silently lost a section
 * would be worse than one that says which line it could not read — the
 * author still has the original.
 *
 * Two things the wiki does not mention, found in the file EE ships:
 * comments run to end of line with `#` (including *after* a value), and a
 * value list may mix formats — `$ff, $ff, $ff, 1`.
 *
 * A setting a device does not read is reported too. EE hands every
 * `[hardware]` key to the device's `configure()`, which ignores what it
 * does not know, so a `universe` left on a serial device is a line that
 * does nothing — worth saying out loud rather than dropping.
 */

export interface DmxReadResult {
  readonly rig: EEDmxRig;
  /** Lines this reader did not understand, with their numbers. */
  readonly warnings: readonly string[];
}

const DEVICES = new Set<string>(EE_DMX_DEVICES);
const TRIGGERS = new Set(DMX_TRIGGERS);

/** Strip a trailing `#` comment and surrounding space. */
function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return (hash === -1 ? line : line.slice(0, hash)).trim();
}

/** `$af` / `[255]` / `0.5` → a tagged value, or null when unreadable. */
export function parseDmxValue(token: string): EEDmxValue | null {
  const text = token.trim();
  if (text === "") return null;
  if (text.startsWith("$")) {
    const parsed = Number.parseInt(text.slice(1), 16);
    return Number.isNaN(parsed) || parsed < 0 || parsed > 255
      ? null
      : { format: "hex", value: parsed };
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    const parsed = Number.parseInt(text.slice(1, -1), 10);
    return Number.isNaN(parsed) || parsed < 0 || parsed > 255
      ? null
      : { format: "byte", value: parsed };
  }
  const parsed = Number.parseFloat(text);
  // EE clamps anything above 1 itself; the document keeps the legal range
  // so the editor cannot save something the schema would then refuse.
  return Number.isNaN(parsed) ? null : { format: "float", value: Math.min(Math.max(parsed, 0), 1) };
}

interface Section {
  readonly name: string;
  readonly entries: Map<string, string>;
  readonly line: number;
  /** Kept in order, for `[channels]` where every key is a channel. */
  readonly ordered: { key: string; value: string; line: number }[];
}

function splitSections(text: string): { sections: Section[]; warnings: string[] } {
  const sections: Section[] = [];
  const warnings: string[] = [];
  let current: Section | null = null;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = stripComment(raw);
    if (line === "") return;

    if (line.startsWith("[") && line.endsWith("]")) {
      current = {
        name: line.slice(1, -1).trim().toLowerCase(),
        entries: new Map(),
        line: index + 1,
        ordered: [],
      };
      sections.push(current);
      return;
    }

    const eq = line.indexOf("=");
    if (eq === -1) {
      warnings.push(`line ${index + 1}: not a "key = value" pair, ignored: ${line}`);
      return;
    }
    if (current === null) {
      warnings.push(`line ${index + 1}: value before any [section], ignored: ${line}`);
      return;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    current.entries.set(key.toLowerCase(), value);
    current.ordered.push({ key, value, line: index + 1 });
  });

  return { sections, warnings };
}

function readEffect(section: Section, warnings: string[]): EEDmxEffect | null {
  const effect = section.entries.get("effect");
  const num = (key: string, fallback: number): number => {
    const raw = section.entries.get(key);
    if (raw === undefined) return fallback;
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) {
      warnings.push(`line ${section.line}: ${key} is not a number ("${raw}"), used ${fallback}`);
      return fallback;
    }
    return parsed;
  };

  /**
   * A level, per channel.
   *
   * EE splits every setting on commas and gives the Nth channel the Nth
   * entry, wrapping — so one number means "the same everywhere" and three
   * paint an RGB fixture.
   */
  const levels = (key: string, fallback: number): number[] => {
    const raw = section.entries.get(key);
    if (raw === undefined) return [fallback];
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const parsed = parts.map((part) => Number.parseFloat(part));
    if (parsed.length === 0 || parsed.some((value) => Number.isNaN(value))) {
      warnings.push(`line ${section.line}: ${key} is not a number list ("${raw}"), used ${fallback}`);
      return [fallback];
    }
    return parsed.map((value) => Math.min(Math.max(value, 0), 1));
  };

  if (effect === undefined) {
    const raw = section.entries.get("value");
    if (raw === undefined) {
      warnings.push(`line ${section.line}: [${section.name}] has neither "effect" nor "value"`);
      return null;
    }
    const values = raw.split(",").map(parseDmxValue);
    if (values.some((value) => value === null)) {
      warnings.push(`line ${section.line}: could not read every value in "${raw}"`);
      return null;
    }
    return { kind: "static", values: values as EEDmxValue[] };
  }

  switch (effect.toLowerCase()) {
    case "glow":
      return {
        kind: "glow",
        minValue: levels("min_value", 0),
        maxValue: levels("max_value", 1),
        timeS: num("time", 1),
      };
    case "blink":
      return {
        kind: "blink",
        onValue: levels("on_value", 1),
        offValue: levels("off_value", 0),
        onTimeS: num("on_time", 0.5),
        offTimeS: num("off_time", 0.5),
      };
    case "noise":
      return {
        kind: "noise",
        minValue: levels("min_value", 0),
        maxValue: levels("max_value", 1),
        smoothness: num("smoothness", 0),
      };
    case "variable": {
      const raw = section.entries.get("input") ?? "";
      const inputs = raw
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      const unknown = inputs.filter((entry) => !TRIGGERS.has(entry));
      if (inputs.length === 0 || unknown.length > 0) {
        // Dropping just the bad ones would silently re-align the rest:
        // these are one input *per channel*, not a set.
        warnings.push(
          inputs.length === 0
            ? `line ${section.line}: Variable effect has no input`
            : `line ${section.line}: unknown trigger(s) ${unknown.join(", ")}, rule dropped`,
        );
        return null;
      }
      return {
        kind: "variable",
        inputs,
        minInput: num("min_input", 0),
        maxInput: num("max_input", 100),
        minOutput: levels("min_output", 0),
        maxOutput: levels("max_output", 1),
      };
    }
    default:
      warnings.push(`line ${section.line}: unknown effect "${effect}"`);
      return null;
  }
}

/** Which keys each device's `configure()` actually looks at. */
const DEVICE_KEYS: Readonly<Record<EEDmxDeviceKind, readonly string[]>> = {
  DMX512SerialDevice: ["port", "channels", "resend_delay"],
  EnttecDMXProDevice: ["port", "channels"],
  sACNDevice: ["channels", "universe", "resend_delay", "multicast"],
  uDMXDevice: [],
  PhilipsHueDevice: ["ip", "port", "username", "userfile"],
  VirtualOutputDevice: ["channels", "virtual_types"],
};

function readDevice(
  section: Section,
  kind: EEDmxDeviceKind,
  id: string,
  warnings: string[],
): EEDmxDevice {
  const int = (key: string, whenAbsent: number): number => {
    const raw = section.entries.get(key);
    if (raw === undefined) return whenAbsent;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      warnings.push(`line ${section.line}: ${key} is not a number ("${raw}"), used ${whenAbsent}`);
      return whenAbsent;
    }
    return parsed;
  };
  const clamp = (value: number, low: number, high: number): number =>
    Math.min(Math.max(value, low), high);
  const text = (key: string, whenAbsent: string): string => section.entries.get(key) ?? whenAbsent;

  for (const [key] of section.entries) {
    if (key !== "device" && !DEVICE_KEYS[kind].includes(key)) {
      warnings.push(`line ${section.line}: ${kind} does not read "${key}", it will do nothing`);
    }
  }

  switch (kind) {
    case "DMX512SerialDevice":
      return {
        id,
        device: kind,
        port: text("port", ""),
        channels: clamp(int("channels", 512), 1, 512),
        resendDelayMs: Math.max(int("resend_delay", 25), 0),
      };
    case "EnttecDMXProDevice":
      return {
        id,
        device: kind,
        port: text("port", ""),
        channels: clamp(int("channels", 512), 1, 512),
      };
    case "sACNDevice":
      return {
        id,
        device: kind,
        channels: clamp(int("channels", 512), 1, 512),
        universe: clamp(int("universe", 1), 1, 63999),
        resendDelayMs: Math.max(int("resend_delay", 50), 1),
        // EE reads any non-zero as true.
        multicast: int("multicast", 0) !== 0,
      };
    case "uDMXDevice":
      return { id, device: kind };
    case "PhilipsHueDevice": {
      const port = section.entries.get("port");
      return {
        id,
        device: kind,
        ip: text("ip", ""),
        port: port === undefined ? null : clamp(int("port", 80), 1, 65535),
        username: text("username", ""),
        userfile: text("userfile", "philips_hue.name"),
      };
    }
    // `virtual_types` is read here only to be checked; it is applied to
    // the fixtures' roles at the end, since the sections may arrive in
    // any order.
    case "VirtualOutputDevice":
      return { id, device: kind, channels: clamp(int("channels", 512), 1, 512) };
  }
}

const OPERATORS: readonly (readonly [string, EEDmxOperator])[] = [
  ["==", "equal"],
  ["!=", "notEqual"],
  ["<", "less"],
  [">", "greater"],
];

/**
 * `RedAlert` or `Hull < 0.3` → a condition.
 *
 * The author's number is kept even for `==` and `!=`, where EE's own
 * parser would read 0 (it slices one character past a two-character
 * operator). The warning says so; importing the 0 would hide the bug
 * inside a document that looked deliberate.
 */
function readCondition(raw: string, line: number, warnings: string[]): EEDmxCondition | null {
  for (const [symbol, operator] of OPERATORS) {
    const at = raw.indexOf(symbol);
    if (at === -1) continue;
    const trigger = raw.slice(0, at).trim();
    const value = Number.parseFloat(raw.slice(at + symbol.length).trim());
    if (!TRIGGERS.has(trigger)) {
      warnings.push(`line ${line}: unknown condition trigger "${trigger}"`);
      return null;
    }
    if (Number.isNaN(value)) {
      warnings.push(`line ${line}: condition "${raw}" has no number after ${symbol}`);
      return null;
    }
    if ((operator === "equal" || operator === "notEqual") && value !== 0) {
      warnings.push(
        `line ${line}: EE compares "${raw}" against 0, not ${value} — its parser mis-slices ${symbol}`,
      );
    }
    return { trigger, operator, value };
  }
  if (!TRIGGERS.has(raw)) {
    warnings.push(`line ${line}: unknown condition "${raw}"`);
    return null;
  }
  // No operator is EE's default test, and the reason a bare trigger works.
  return { trigger: raw, operator: "greater", value: 0 };
}

/**
 * `virtual_types` becomes the fixtures' channel roles.
 *
 * EE walks the letters across DMX channels from the first, one letter per
 * channel, substituting `W` for an empty entry. A colour landing on a
 * channel no fixture declares is reported: the document has nowhere to
 * keep it, and dropping it quietly would lose what the author drew.
 */
function applyVirtualTypes(
  fixtures: EEDmxFixture[],
  raw: string,
  line: number,
  warnings: string[],
): void {
  const letters = raw
    .split(",")
    .map((entry) => (entry.trim() === "" ? "W" : entry.trim()))
    .join("");
  const bad = letters.replace(/[RGBWrgbw]/g, "");
  if (bad !== "") {
    warnings.push(`line ${line}: virtual_types has letters EE does not know: ${bad}`);
  }
  const homeless: number[] = [];
  [...letters].forEach((letter, index) => {
    const channel = index + 1;
    const role = roleOfVirtualType(letter);
    let placed = false;
    for (const fixture of fixtures) {
      fixture.slots = fixture.slots.map((slot) => {
        if (slot.channel !== channel) return slot;
        placed = true;
        return { ...slot, role };
      });
    }
    if (!placed && role !== "white") homeless.push(channel);
  });
  if (homeless.length > 0) {
    warnings.push(
      `line ${line}: virtual_types colours channel(s) ${homeless.join(", ")}, which no fixture declares`,
    );
  }
}

export function readHardwareIni(text: string): DmxReadResult {
  const { sections, warnings } = splitSections(text);
  const rig = emptyDmxRig();
  const devices = [...rig.devices];
  const fixtures = [...rig.fixtures];
  const states = [...rig.states];
  const events = [...rig.events];
  /** Applied once every fixture is known — sections may come in any order. */
  let virtualTypes: { raw: string; line: number } | null = null;

  let n = 0;
  const nextId = (prefix: string): string => `${prefix}_${(n += 1)}`;

  for (const section of sections) {
    switch (section.name) {
      case "hardware": {
        const device = section.entries.get("device");
        if (device === undefined || !DEVICES.has(device)) {
          warnings.push(
            `line ${section.line}: [hardware] names ${
              device === undefined ? "no device" : `an unknown device "${device}"`
            }`,
          );
          break;
        }
        devices.push(readDevice(section, device as EEDmxDeviceKind, nextId("device"), warnings));
        const types = section.entries.get("virtual_types");
        if (types !== undefined) virtualTypes = { raw: types, line: section.line };
        break;
      }

      /** The singular form: one `name` and one `channel` per section. */
      case "channel": {
        const name = section.entries.get("name");
        const number = Number.parseInt(section.entries.get("channel") ?? "", 10);
        if (name === undefined || Number.isNaN(number) || number < 1 || number > 512) {
          warnings.push(`line ${section.line}: [channel] needs a "name" and a "channel" of 1-512`);
          break;
        }
        fixtures.push({
          id: nextId("fixture"),
          name,
          slots: [{ channel: number, role: "none" }],
        });
        break;
      }

      case "channels":
        for (const entry of section.ordered) {
          const numbers = entry.value.split(",").map((part) => Number.parseInt(part.trim(), 10));
          if (numbers.some((value) => Number.isNaN(value) || value < 1 || value > 512)) {
            warnings.push(`line ${entry.line}: "${entry.key}" has a channel outside 1-512`);
            break;
          }
          fixtures.push({
            id: nextId("fixture"),
            name: entry.key,
            // Roles are not guessed from a channel count: a `virtual_types`
            // line can say, and otherwise the author does.
            slots: numbers.map((channel) => ({ channel, role: "none" as const })),
          });
        }
        break;

      case "state": {
        const condition = section.entries.get("condition");
        const target = section.entries.get("target");
        if (condition === undefined || target === undefined) {
          warnings.push(`line ${section.line}: [state] needs both "condition" and "target"`);
          break;
        }
        const parsed = readCondition(condition, section.line, warnings);
        if (parsed === null) break;
        const effect = readEffect(section, warnings);
        if (effect !== null) {
          states.push({ id: nextId("state"), condition: parsed, target, effect });
        }
        break;
      }

      case "event": {
        const trigger = section.entries.get("trigger");
        const target = section.entries.get("target");
        if (trigger === undefined || target === undefined) {
          warnings.push(`line ${section.line}: [event] needs both "trigger" and "target"`);
          break;
        }
        const edge: EEDmxEdge =
          trigger.startsWith(">") ? "rising" : trigger.startsWith("<") ? "falling" : "any";
        const variable = trigger.replace(/^[<>]/, "").trim();
        if (!TRIGGERS.has(variable)) {
          warnings.push(`line ${section.line}: unknown trigger "${variable}"`);
          break;
        }
        const effect = readEffect(section, warnings);
        if (effect === null) break;
        const runtime = Number.parseFloat(section.entries.get("runtime") ?? "1");
        events.push({
          id: nextId("event"),
          edge,
          variable,
          target,
          runtimeS: Number.isNaN(runtime) || runtime <= 0 ? 1 : runtime,
          effect,
        });
        break;
      }

      default:
        warnings.push(`line ${section.line}: unknown section [${section.name}], ignored`);
    }
  }

  if (virtualTypes !== null) {
    applyVirtualTypes(fixtures, virtualTypes.raw, virtualTypes.line, warnings);
  }

  return { rig: { ...rig, devices, fixtures, states, events }, warnings };
}
