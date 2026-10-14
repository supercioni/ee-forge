import {
  dmxLevel,
  dmxValueOf,
  expandLevels,
  expandValues,
  fixtureColor,
  fixtureValueColor,
  hasColorRoles,
  withFixtureColor,
  withFixtureValueColor,
} from "@forge/core/editor";
import type { EEDmxFixture, EEDmxRole, EEDmxValue } from "@forge/contracts";
import { NumberInput } from "../ui/NumberInput.js";
import { ColorPicker } from "../ui/ColorPicker.js";

/**
 * A level on the wire — one control per channel, and a colour above them.
 *
 * The colour is a **projection**, never a stored field: it is read out of
 * the channels an author labelled red, green and blue, and picking a
 * swatch writes back into exactly those. So "set it by colour" and "set
 * the three numbers" are two views of one array and cannot disagree —
 * which is the package's rule about derived data, applied to the one place
 * an author would most like to have both.
 *
 * A colour never touches white or intensity. They are real channels on
 * real fixtures, but they are not part of the mix, so they keep their own
 * box.
 */

const ROLE_LABEL: Readonly<Record<EEDmxRole, string>> = {
  red: "Red",
  green: "Green",
  blue: "Blue",
  white: "White",
  intensity: "Intensity",
  none: "level",
};

function SlotLabel({ channel, role }: { channel: number; role: EEDmxRole }): JSX.Element {
  return (
    <span className="dmx-slot-label">
      <span className="muted">{channel}</span> {ROLE_LABEL[role]}
    </span>
  );
}

/**
 * A plain 0..1 level per channel — glow, blink, flicker, follow.
 *
 * A one-entry list means "the same on every channel", which is what EE
 * does with a single number, so it stays a single number in the file until
 * an author actually differs one channel from another.
 */
export function LevelField({
  label,
  fixture,
  levels,
  onChange,
}: {
  label: string;
  fixture: EEDmxFixture | null;
  levels: readonly number[];
  onChange: (levels: number[]) => void;
}): JSX.Element {
  if (fixture === null || fixture.slots.length === 1) {
    return (
      <label>
        {label}
        <NumberInput
          value={levels[0] ?? 0}
          step={0.1}
          min={0}
          max={1}
          onChange={(v) => v !== null && onChange([v])}
        />
      </label>
    );
  }

  const expanded = expandLevels(levels, fixture.slots.length);
  const color = fixtureColor(fixture, expanded);

  return (
    <div className="dmx-level">
      <div className="dmx-level-head">
        <span>{label}</span>
        {color !== null && (
          <ColorPicker
            value={color}
            scale={255}
            onChange={(rgb) => rgb !== null && onChange(withFixtureColor(fixture, expanded, rgb))}
          />
        )}
      </div>
      {fixture.slots.map((slot, index) => (
        <div className="dmx-level-row" key={index}>
          <SlotLabel channel={slot.channel} role={slot.role} />
          <NumberInput label={`Channel ${slot.channel} level`}
            value={expanded[index] ?? 0}
            step={0.1}
            min={0}
            max={1}
            onChange={(v) => {
              if (v === null) return;
              onChange(expanded.map((level, i) => (i === index ? v : level)));
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The same, for a held value — which carries its own spelling.
 *
 * `$ff`, `[255]` and `1` are one number written three ways, and EE's own
 * shipped file mixes them on a line, so the format stays per channel and
 * changing it never changes the level.
 */
export function ValueField({
  label,
  fixture,
  values,
  onChange,
}: {
  label: string;
  fixture: EEDmxFixture | null;
  values: readonly EEDmxValue[];
  onChange: (values: EEDmxValue[]) => void;
}): JSX.Element {
  if (fixture === null) {
    return (
      <label>
        {label}
        <NumberInput
          value={dmxLevel(values[0] ?? { format: "float", value: 0 })}
          step={0.1}
          min={0}
          max={1}
          onChange={(v) => v !== null && onChange([dmxValueOf(v, values[0]?.format ?? "float")])}
        />
      </label>
    );
  }

  const expanded = expandValues(values, fixture.slots.length);
  const color = hasColorRoles(fixture) ? fixtureValueColor(fixture, expanded) : null;
  const replace = (index: number, value: EEDmxValue): void => {
    onChange(expanded.map((old, i) => (i === index ? value : old)));
  };

  return (
    <div className="dmx-level">
      <div className="dmx-level-head">
        <span>{label}</span>
        {color !== null && (
          <ColorPicker
            value={color}
            scale={255}
            onChange={(rgb) =>
              rgb !== null && onChange(withFixtureValueColor(fixture, expanded, rgb))
            }
          />
        )}
      </div>
      {fixture.slots.map((slot, index) => {
        const value = expanded[index] ?? { format: "float" as const, value: 0 };
        return (
          <div className="dmx-level-row" key={index}>
            <SlotLabel channel={slot.channel} role={slot.role} />
            <NumberInput label={`Channel ${slot.channel} level`}
              value={value.format === "float" ? value.value : value.value}
              step={value.format === "float" ? 0.1 : 1}
              min={0}
              max={value.format === "float" ? 1 : 255}
              onChange={(v) => v !== null && replace(index, { format: value.format, value: v })}
            />
            <select aria-label={`Channel ${slot.channel} format`}
              value={value.format}
              title="How this channel is written in hardware.ini. The level does not change."
              onChange={(e) => {
                const format = e.target.value as EEDmxValue["format"];
                replace(index, dmxValueOf(dmxLevel(value), format));
              }}
            >
              <option value="float">0-1</option>
              <option value="hex">$hex</option>
              <option value="byte">[255]</option>
            </select>
          </div>
        );
      })}
    </div>
  );
}
