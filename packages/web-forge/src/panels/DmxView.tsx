import { useEffect } from "react";
import {
  booleanDmxCondition,
  defaultDmxDevice,
  emptyDmxRig,
  DMX_TRIGGERS,
  EE_DMX_DEVICES,
  type EEDmxCondition,
  type EEDmxDevice,
  type EEDmxDeviceKind,
  type EEDmxEdge,
  type EEDmxEffect,
  type EEDmxFixture,
  type EEDmxOperator,
  type EEDmxRig,
  type EEDmxRole,
} from "@forge/contracts";
import {
  danglingDmxTargets,
  expandLevels,
  DMX_TRIGGER_CAVEATS,
} from "@forge/core/editor";
import { getDesktop } from "../api/desktop.js";
import { useEditor } from "../store/editor.js";
import { NumberInput } from "../ui/NumberInput.js";
import { InstallSelect } from "./DesktopPanels.js";
import { DmxPreview } from "./DmxPreview.js";
import { Splitter } from "../ui/Splitter.js";
import { DMX_PREVIEW } from "../ui/split.js";
import { useColumnCap } from "../ui/useColumnCap.js";
import { useColumnWidth } from "../ui/useColumnWidth.js";
import { LevelField, ValueField } from "./LevelField.js";

/**
 * The DMX rig: devices, fixtures, and the rules that light them
 * (ADR-0040).
 *
 * A separate document from any project, and the view says so — the lights
 * belong to the room, and every trigger EmptyEpsilon offers is ship
 * telemetry, so there is nothing scenario-specific to put in a project.
 */
export function DmxView(): JSX.Element {
  const rig = useEditor((s) => s.rig);
  const cap = useColumnCap();
  const [previewWidth, setPreviewWidth] = useColumnWidth("dmxPreview", DMX_PREVIEW);
  const rigDirty = useEditor((s) => s.rigDirty);
  const warnings = useEditor((s) => s.dmxWarnings);
  const loadRig = useEditor((s) => s.loadRig);
  const importRig = useEditor((s) => s.importRig);
  const buildRig = useEditor((s) => s.buildRig);
  const applyRig = useEditor((s) => s.applyRig);

  // Shared with the library rescan, and remembered across reloads.
  const eeDir = useEditor((s) => s.eeDir);
  const setEeDir = useEditor((s) => s.setEeDir);
  const desktop = getDesktop() !== null;

  useEffect(() => {
    void loadRig();
  }, [loadRig]);

  if (rig === null) {
    return (
      <div className="dmx-view">
        <section className="panel">
          <h2>DMX rig</h2>
          <p className="hint">
            No rig yet. DMX is not part of a scenario: EmptyEpsilon configures it in{" "}
            <code>hardware.ini</code>, and every trigger it offers is ship telemetry — hull,
            shields, alert, systems. So a rig describes <em>this room</em> and lives beside the
            projects.
          </p>
          <div className="field">
            <label>{desktop ? "EmptyEpsilon installation" : "EmptyEpsilon directory"}</label>
            {desktop ? (
              <InstallSelect value={eeDir} onChange={setEeDir} />
            ) : (
              <input aria-label="EmptyEpsilon directory"
                value={eeDir}
                placeholder="Folder that holds EmptyEpsilon"
                onChange={(e) => setEeDir(e.target.value)}
              />
            )}
          </div>
          <div className="field-row">
            <button type="button" disabled={eeDir === ""} onClick={() => void importRig(eeDir)}>
              Import its hardware.ini
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => applyRigFrom(applyRig, emptyDmxRig())}
            >
              Start a blank rig
            </button>
          </div>
        </section>
      </div>
    );
  }

  const dangling = danglingDmxTargets(rig);

  return (
    <div className="dmx-view" style={{ gridTemplateColumns: `1fr 6px ${cap(previewWidth, 40)}` }}>
      <div className="dmx-edit">
        <section className="panel">
          <div className="panel-head">
            <h2>
              DMX rig <span className="muted">{rig.label}</span>
            </h2>
            {/* Saving the rig is in the header (“Save rig”), with the rig's own unsaved marker. */}
            <span className="muted">{rigDirty ? "unsaved changes" : "saved"}</span>
          </div>
          <p className="hint">
            Renders to <code>hardware.ini</code>, which EmptyEpsilon reads <strong>at
            launch</strong> — restart it after installing. Not part of any scenario.
          </p>
          <div className="field-row">
            {desktop ? (
              <InstallSelect value={eeDir} onChange={setEeDir} />
            ) : (
              <input aria-label="EE directory, to install"
                value={eeDir}
                placeholder="EE directory, to install"
                onChange={(e) => setEeDir(e.target.value)}
              />
            )}
            <button type="button" onClick={() => void buildRig(null)}>
              Build
            </button>
            <button
              type="button"
              disabled={eeDir === ""}
              onClick={() => void buildRig(eeDir)}
              title="Copies hardware.ini into the install, backing up any file already there"
            >
              Build &amp; install
            </button>
          </div>

          {warnings.length > 0 && (
            <div className="dmx-warnings">
              <strong>The import could not read these lines:</strong>
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {dangling.length > 0 && (
            <p className="hint error">
              These rules aim at a fixture nothing declares: {dangling.join(", ")}
            </p>
          )}
        </section>

        <Devices rig={rig} applyRig={applyRig} />
        <Fixtures rig={rig} applyRig={applyRig} />
        <Rules rig={rig} applyRig={applyRig} />
        <Events rig={rig} applyRig={applyRig} />
      </div>

      <Splitter width={previewWidth} onChange={setPreviewWidth} spec={DMX_PREVIEW} label="Preview column width" />
      <DmxPreview />
    </div>
  );
}

type Apply = (fn: (rig: EEDmxRig) => EEDmxRig) => void;

/** `applyRig` needs an existing rig; this seeds one before applying. */
function applyRigFrom(apply: Apply, seed: EEDmxRig): void {
  useEditor.setState({ rig: seed, rigDirty: true });
  apply((rig) => rig);
}

const nextId = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

function Devices({ rig, applyRig }: { rig: EEDmxRig; applyRig: Apply }): JSX.Element {
  const replace = (id: string, device: EEDmxDevice): void => {
    applyRig((r) => ({ ...r, devices: r.devices.map((d) => (d.id === id ? device : d)) }));
  };

  return (
    <section className="panel">
      <h2>
        Devices <span className="muted">— what is on the wire</span>
      </h2>
      {rig.devices.length === 0 && (
        <p className="hint">
          None. <code>VirtualOutputDevice</code> simulates hardware, which is how a rig is
          tested without touching a serial port.
        </p>
      )}
      {rig.devices.map((device) => (
        <div className="dmx-rule" key={device.id}>
          <div className="field-row">
            <select aria-label={`Device ${device.id} type`}
              value={device.device}
              title="Each kind reads its own settings; changing this resets them to EE's defaults."
              onChange={(e) =>
                replace(device.id, defaultDmxDevice(device.id, e.target.value as EEDmxDeviceKind))
              }
            >
              {EE_DMX_DEVICES.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <button aria-label={`Remove device ${device.id}`}
              type="button"
              className="small danger"
              onClick={() =>
                applyRig((r) => ({ ...r, devices: r.devices.filter((d) => d.id !== device.id) }))
              }
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <DeviceFields device={device} onChange={(next) => replace(device.id, next)} />
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          applyRig((r) => ({
            ...r,
            devices: [...r.devices, defaultDmxDevice(nextId("device"), "VirtualOutputDevice")],
          }))
        }
      >
        + Device
      </button>
    </section>
  );
}

/**
 * Exactly the settings EE's `configure()` reads for this kind of device,
 * and no others — a `universe` on a serial device is a line that does
 * nothing, so the editor never offers one.
 */
function DeviceFields({
  device,
  onChange,
}: {
  device: EEDmxDevice;
  onChange: (device: EEDmxDevice) => void;
}): JSX.Element {
  const channelCount = (value: number): JSX.Element => (
    <label>
      Channels
      <NumberInput
        value={value}
        min={1}
        max={512}
        onChange={(v) =>
          v !== null && onChange({ ...device, channels: v } as EEDmxDevice)
        }
      />
    </label>
  );

  switch (device.device) {
    case "DMX512SerialDevice":
      return (
        <div className="field-row">
          <label>
            Port
            <input
              value={device.port}
              placeholder="COM9, /dev/ttyUSB0…"
              onChange={(e) => onChange({ ...device, port: e.target.value })}
            />
          </label>
          {channelCount(device.channels)}
          <label>
            Resend (ms)
            <NumberInput
              value={device.resendDelayMs}
              min={0}
              onChange={(v) => v !== null && onChange({ ...device, resendDelayMs: v })}
            />
          </label>
        </div>
      );
    case "EnttecDMXProDevice":
      return (
        <div className="field-row">
          <label>
            Port
            <input
              value={device.port}
              placeholder="COM9, /dev/ttyUSB0…"
              onChange={(e) => onChange({ ...device, port: e.target.value })}
            />
          </label>
          {channelCount(device.channels)}
        </div>
      );
    case "sACNDevice":
      return (
        <div className="field-row">
          {channelCount(device.channels)}
          <label>
            Universe
            <NumberInput
              value={device.universe}
              min={1}
              max={63999}
              onChange={(v) => v !== null && onChange({ ...device, universe: v })}
            />
          </label>
          <label>
            Resend (ms)
            <NumberInput
              value={device.resendDelayMs}
              min={1}
              onChange={(v) => v !== null && onChange({ ...device, resendDelayMs: v })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={device.multicast}
              onChange={(e) => onChange({ ...device, multicast: e.target.checked })}
            />
            Multicast
          </label>
        </div>
      );
    case "uDMXDevice":
      return (
        <p className="hint">
          No settings: <code>uDMX.dll</code> decides the port and the channel count, and EE
          passes it nothing.
        </p>
      );
    case "PhilipsHueDevice":
      return (
        <>
          <div className="field-row">
            <label>
              Bridge IP
              <input
                value={device.ip}
                placeholder="192.168.1.2"
                onChange={(e) => onChange({ ...device, ip: e.target.value })}
              />
            </label>
            <label>
              Port
              <NumberInput
                value={device.port}
                nullable
                min={1}
                max={65535}
                placeholder="default"
                onChange={(v) => onChange({ ...device, port: v })}
              />
            </label>
          </div>
          <div className="field-row">
            <label>
              Username
              <input
                value={device.username}
                placeholder="blank — EE will request one"
                onChange={(e) => onChange({ ...device, username: e.target.value })}
              />
            </label>
            <label>
              User file
              <input
                value={device.userfile}
                onChange={(e) => onChange({ ...device, userfile: e.target.value })}
              />
            </label>
          </div>
          <p className="hint">
            Leave the username blank and press the button on the bridge when EE asks; it
            saves what it is granted into the user file.
          </p>
        </>
      );
    case "VirtualOutputDevice":
      return (
        <>
          <div className="field-row">{channelCount(device.channels)}</div>
          <p className="hint">
            What colour each channel is drawn in comes from the fixtures&apos; channel roles —
            set them there and the build writes <code>virtual_types</code> to match.
          </p>
        </>
      );
  }
}

/** Layouts common enough to be worth one click instead of four. */
const ROLE_PRESETS: Readonly<Record<string, readonly EEDmxRole[]>> = {
  RGB: ["red", "green", "blue"],
  RGBW: ["red", "green", "blue", "white"],
  "RGB + intensity": ["red", "green", "blue", "intensity"],
  Dimmer: ["intensity"],
};

const ROLE_LABEL: Readonly<Record<EEDmxRole, string>> = {
  red: "Red",
  green: "Green",
  blue: "Blue",
  white: "White",
  intensity: "Intensity",
  none: "—",
};

function Fixtures({ rig, applyRig }: { rig: EEDmxRig; applyRig: Apply }): JSX.Element {
  // A channel number claimed twice is legal DMX — two fixtures can share a
  // dimmer — but far more often a typo, so it is flagged rather than
  // refused.
  const seen = new Map<number, number>();
  for (const fixture of rig.fixtures) {
    for (const slot of fixture.slots) seen.set(slot.channel, (seen.get(slot.channel) ?? 0) + 1);
  }

  const edit = (id: string, next: (fixture: EEDmxFixture) => EEDmxFixture): void => {
    applyRig((r) => ({
      ...r,
      fixtures: r.fixtures.map((f) => (f.id === id ? next(f) : f)),
    }));
  };

  return (
    <section className="panel">
      <h2>
        Fixtures <span className="muted">— names the rules address</span>
      </h2>
      <p className="hint">
        Tell a channel what it drives and the rules can offer you a colour instead of three
        numbers. Red, green and blue are the ones that mix; white and intensity keep their own
        control.
      </p>

      {rig.fixtures.map((fixture) => (
        <div className="dmx-rule" key={fixture.id}>
          <div className="field-row">
            <input aria-label={`Fixture ${fixture.id} name`}
              value={fixture.name}
              onChange={(e) => edit(fixture.id, (f) => ({ ...f, name: e.target.value }))}
            />
            <select aria-label={`Fixture ${fixture.name}: assign roles`}
              value=""
              title="Assign roles to this fixture's channels in one go."
              onChange={(e) => {
                const preset = ROLE_PRESETS[e.target.value];
                if (preset === undefined) return;
                edit(fixture.id, (f) => ({
                  ...f,
                  // Longer than the preset: the rest keeps whatever it had.
                  slots: f.slots.map((slot, i) => ({ ...slot, role: preset[i] ?? slot.role })),
                }));
              }}
            >
              <option value="">Preset…</option>
              {Object.keys(ROLE_PRESETS).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button aria-label={`Remove fixture ${fixture.id}`}
              type="button"
              className="small danger"
              onClick={() =>
                applyRig((r) => ({
                  ...r,
                  fixtures: r.fixtures.filter((f) => f.id !== fixture.id),
                }))
              }
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          {fixture.slots.map((slot, index) => (
            <div className="field-row dmx-slot" key={index}>
              <label>
                Channel
                <NumberInput
                  value={slot.channel}
                  min={1}
                  max={512}
                  onChange={(v) =>
                    v !== null &&
                    edit(fixture.id, (f) => ({
                      ...f,
                      slots: f.slots.map((s, i) => (i === index ? { ...s, channel: v } : s)),
                    }))
                  }
                />
              </label>
              {(seen.get(slot.channel) ?? 0) > 1 && (
                <span className="warn" title="Two fixtures claim this channel.">
                  claimed twice
                </span>
              )}
              <select aria-label={`${fixture.name} channel ${slot.channel} role`}
                value={slot.role}
                onChange={(e) =>
                  edit(fixture.id, (f) => ({
                    ...f,
                    slots: f.slots.map((s, i) =>
                      i === index ? { ...s, role: e.target.value as EEDmxRole } : s,
                    ),
                  }))
                }
              >
                {(Object.keys(ROLE_LABEL) as EEDmxRole[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
              <button aria-label={`Remove channel ${index + 1} of ${fixture.id}`}
                type="button"
                className="small danger"
                disabled={fixture.slots.length === 1}
                title={fixture.slots.length === 1 ? "A fixture needs a channel" : undefined}
                onClick={() =>
                  edit(fixture.id, (f) => ({
                    ...f,
                    slots: f.slots.filter((_, i) => i !== index),
                  }))
                }
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          ))}

          <button
            type="button"
            className="small"
            onClick={() =>
              edit(fixture.id, (f) => ({
                ...f,
                slots: [
                  ...f.slots,
                  {
                    channel: Math.min((f.slots[f.slots.length - 1]?.channel ?? 0) + 1, 512),
                    role: "none",
                  },
                ],
              }))
            }
          >
            + Channel
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          applyRig((r) => ({
            ...r,
            fixtures: [
              ...r.fixtures,
              {
                id: nextId("fixture"),
                name: `fixture${r.fixtures.length + 1}`,
                slots: [{ channel: 1, role: "none" }],
              },
            ],
          }))
        }
      >
        + Fixture
      </button>
    </section>
  );
}

function blankEffect(kind: EEDmxEffect["kind"]): EEDmxEffect {
  switch (kind) {
    case "static":
      return { kind: "static", values: [{ format: "float", value: 1 }] };
    case "glow":
      return { kind: "glow", minValue: [0.3], maxValue: [1], timeS: 1 };
    case "blink":
      return { kind: "blink", onValue: [1], offValue: [0], onTimeS: 0.5, offTimeS: 0.5 };
    case "variable":
      return {
        kind: "variable",
        inputs: ["Hull"],
        minInput: 0,
        maxInput: 100,
        minOutput: [0],
        maxOutput: [1],
      };
    case "noise":
      return { kind: "noise", minValue: [0], maxValue: [1], smoothness: 0 };
  }
}

/** The five EE has. `Noise` is in its source but not on the wiki page. */
function EffectOptions(): JSX.Element {
  return (
    <>
      <option value="static">Hold a value</option>
      <option value="glow">Glow</option>
      <option value="blink">Blink</option>
      <option value="variable">Follow a value</option>
      <option value="noise">Flicker</option>
    </>
  );
}

function Rules({ rig, applyRig }: { rig: EEDmxRig; applyRig: Apply }): JSX.Element {
  const targets = rig.fixtures.map((fixture) => fixture.name);
  const fixtureOf = (name: string): EEDmxFixture | null =>
    rig.fixtures.find((fixture) => fixture.name === name) ?? null;

  return (
    <section className="panel">
      <h2>
        Rules <span className="muted">— while a condition holds</span>
      </h2>
      <p className="hint">
        Applied in order: a later rule wins a fixture two of them claim, so put the general
        one first and the exception after.
      </p>

      {rig.states.map((state) => (
        <div className="dmx-rule" key={state.id}>
          <div className="field-row">
            <ConditionFields
              prefix={`State ${state.id}`}
              condition={state.condition}
              onChange={(condition) =>
                applyRig((r) => ({
                  ...r,
                  states: r.states.map((s) => (s.id === state.id ? { ...s, condition } : s)),
                }))
              }
            />
            <select aria-label={`State ${state.id} target`}
              value={state.target}
              onChange={(e) =>
                applyRig((r) => ({
                  ...r,
                  states: r.states.map((s) =>
                    s.id === state.id ? { ...s, target: e.target.value } : s,
                  ),
                }))
              }
            >
              {targets.length === 0 && <option value={state.target}>{state.target}</option>}
              {targets.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select aria-label={`State ${state.id} effect`}
              value={state.effect.kind}
              onChange={(e) =>
                applyRig((r) => ({
                  ...r,
                  states: r.states.map((s) =>
                    s.id === state.id
                      ? { ...s, effect: blankEffect(e.target.value as EEDmxEffect["kind"]) }
                      : s,
                  ),
                }))
              }
            >
              <EffectOptions />
            </select>
            <button aria-label={`Remove state ${state.id}`}
              type="button"
              className="small danger"
              onClick={() =>
                applyRig((r) => ({ ...r, states: r.states.filter((s) => s.id !== state.id) }))
              }
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <EffectFields
            effect={state.effect}
            fixture={fixtureOf(state.target)}
            onChange={(effect) =>
              applyRig((r) => ({
                ...r,
                states: r.states.map((s) => (s.id === state.id ? { ...s, effect } : s)),
              }))
            }
          />
        </div>
      ))}

      <button
        type="button"
        disabled={rig.fixtures.length === 0}
        title={rig.fixtures.length === 0 ? "Declare a fixture first" : undefined}
        onClick={() =>
          applyRig((r) => ({
            ...r,
            states: [
              ...r.states,
              {
                id: nextId("state"),
                condition: booleanDmxCondition("Always"),
                target: r.fixtures[0]?.name ?? "",
                effect: blankEffect("static"),
              },
            ],
          }))
        }
      >
        + Rule
      </button>
    </section>
  );
}

/** What a trigger will not do, said where it is chosen rather than in a doc. */
function TriggerCaveat({ trigger }: { trigger: string }): JSX.Element | null {
  const caveat = DMX_TRIGGER_CAVEATS[trigger];
  if (caveat === undefined) return null;
  return (
    <span className="warn" title={caveat}>
      conditions apply
    </span>
  );
}

/**
 * A trigger and how it is tested.
 *
 * The value box appears only once an operator needs one, so a boolean
 * trigger stays the single dropdown it reads as — which is also the bare
 * line EE writes.
 */
function ConditionFields({
  condition,
  onChange,
  prefix,
}: {
  condition: EEDmxCondition;
  onChange: (condition: EEDmxCondition) => void;
  /** Which rule these fields belong to ("State s3"), so each control has a name of its own. */
  prefix: string;
}): JSX.Element {
  const bare = condition.operator === "greater" && condition.value === 0;
  // EE takes the compare value from one character past a two-character
  // operator, so these two can only ever mean "against 0".
  const broken =
    (condition.operator === "equal" || condition.operator === "notEqual") &&
    condition.value !== 0;

  return (
    <>
      <select aria-label={`${prefix} trigger`}
        value={condition.trigger}
        onChange={(e) => onChange({ ...condition, trigger: e.target.value })}
      >
        {DMX_TRIGGERS.map((trigger) => (
          <option key={trigger} value={trigger}>
            {trigger}
          </option>
        ))}
      </select>
      <TriggerCaveat trigger={condition.trigger} />
      <select aria-label={`${prefix} test`}
        value={bare ? "any" : condition.operator}
        title="How the trigger's value is tested."
        onChange={(e) =>
          onChange(
            e.target.value === "any"
              ? booleanDmxCondition(condition.trigger)
              : { ...condition, operator: e.target.value as EEDmxOperator },
          )
        }
      >
        <option value="any">is on</option>
        <option value="greater">&gt;</option>
        <option value="less">&lt;</option>
        <option value="equal">==</option>
        <option value="notEqual">!=</option>
      </select>
      {!bare && (
        <NumberInput label={`${prefix} value`}
          value={condition.value}
          step={0.1}
          onChange={(v) => v !== null && onChange({ ...condition, value: v })}
        />
      )}
      {broken && (
        <span className="warn" title="EE's parser mis-slices == and !=, so it compares against 0.">
          EE compares against 0
        </span>
      )}
    </>
  );
}

/**
 * One-shots. They fire on a *change* in the trigger, which is why they
 * are not in the preview: it is a snapshot, and they need two.
 */
function Events({ rig, applyRig }: { rig: EEDmxRig; applyRig: Apply }): JSX.Element {
  const targets = rig.fixtures.map((fixture) => fixture.name);
  const fixtureOf = (name: string): EEDmxFixture | null =>
    rig.fixtures.find((fixture) => fixture.name === name) ?? null;

  return (
    <section className="panel">
      <h2>
        Events <span className="muted">— when a value moves</span>
      </h2>
      <p className="hint">
        A rule holds while something is true; an event fires once when it changes, runs for
        its time, and stops. Not shown in the preview — that is a snapshot, and these need a
        before and an after.
      </p>

      {rig.events.map((event) => (
        <div className="dmx-rule" key={event.id}>
          <div className="field-row">
            <select aria-label={`Event ${event.id} direction`}
              value={event.edge}
              title="Which way the value has to move."
              onChange={(e) =>
                applyRig((r) => ({
                  ...r,
                  events: r.events.map((v) =>
                    v.id === event.id ? { ...v, edge: e.target.value as EEDmxEdge } : v,
                  ),
                }))
              }
            >
              <option value="any">changes</option>
              <option value="rising">rises</option>
              <option value="falling">falls</option>
            </select>
            <select aria-label={`Event ${event.id} trigger`}
              value={event.variable}
              onChange={(e) =>
                applyRig((r) => ({
                  ...r,
                  events: r.events.map((v) =>
                    v.id === event.id ? { ...v, variable: e.target.value } : v,
                  ),
                }))
              }
            >
              {DMX_TRIGGERS.map((trigger) => (
                <option key={trigger} value={trigger}>
                  {trigger}
                </option>
              ))}
            </select>
            <TriggerCaveat trigger={event.variable} />
            <select aria-label={`Event ${event.id} target`}
              value={event.target}
              onChange={(e) =>
                applyRig((r) => ({
                  ...r,
                  events: r.events.map((v) =>
                    v.id === event.id ? { ...v, target: e.target.value } : v,
                  ),
                }))
              }
            >
              {targets.length === 0 && <option value={event.target}>{event.target}</option>}
              {targets.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <label>
              For (s)
              <NumberInput
                value={event.runtimeS}
                step={0.5}
                min={0.1}
                onChange={(v) =>
                  v !== null &&
                  applyRig((r) => ({
                    ...r,
                    events: r.events.map((e) => (e.id === event.id ? { ...e, runtimeS: v } : e)),
                  }))
                }
              />
            </label>
            <select
              aria-label={`Event ${event.id} effect`}
              value={event.effect.kind}
              onChange={(e) =>
                applyRig((r) => ({
                  ...r,
                  events: r.events.map((v) =>
                    v.id === event.id
                      ? { ...v, effect: blankEffect(e.target.value as EEDmxEffect["kind"]) }
                      : v,
                  ),
                }))
              }
            >
              <EffectOptions />
            </select>
            <button aria-label={`Remove event ${event.id}`}
              type="button"
              className="small danger"
              onClick={() =>
                applyRig((r) => ({ ...r, events: r.events.filter((v) => v.id !== event.id) }))
              }
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <EffectFields
            effect={event.effect}
            fixture={fixtureOf(event.target)}
            onChange={(effect) =>
              applyRig((r) => ({
                ...r,
                events: r.events.map((v) => (v.id === event.id ? { ...v, effect } : v)),
              }))
            }
          />
        </div>
      ))}

      <button
        type="button"
        disabled={rig.fixtures.length === 0}
        title={rig.fixtures.length === 0 ? "Declare a fixture first" : undefined}
        onClick={() =>
          applyRig((r) => ({
            ...r,
            events: [
              ...r.events,
              {
                id: nextId("event"),
                edge: "falling",
                variable: "Hull",
                target: r.fixtures[0]?.name ?? "",
                runtimeS: 2,
                effect: blankEffect("static"),
              },
            ],
          }))
        }
      >
        + Event
      </button>
    </section>
  );
}

function EffectFields({
  effect,
  fixture,
  onChange,
}: {
  effect: EEDmxEffect;
  /** The rule's target, so levels can be shown per channel and as a colour. */
  fixture: EEDmxFixture | null;
  onChange: (effect: EEDmxEffect) => void;
}): JSX.Element {
  switch (effect.kind) {
    case "static":
      return (
        <ValueField
          label="Values"
          fixture={fixture}
          values={effect.values}
          onChange={(values) => onChange({ kind: "static", values })}
        />
      );
    case "glow":
      return (
        <>
          <LevelField
            label="From"
            fixture={fixture}
            levels={effect.minValue}
            onChange={(minValue) => onChange({ ...effect, minValue })}
          />
          <LevelField
            label="To"
            fixture={fixture}
            levels={effect.maxValue}
            onChange={(maxValue) => onChange({ ...effect, maxValue })}
          />
          <div className="field-row">
            <label>
              Seconds
              <NumberInput
                value={effect.timeS}
                step={0.1}
                min={0.1}
                onChange={(v) => v !== null && onChange({ ...effect, timeS: v })}
              />
            </label>
          </div>
        </>
      );
    case "blink":
      return (
        <>
          <LevelField
            label="On"
            fixture={fixture}
            levels={effect.onValue}
            onChange={(onValue) => onChange({ ...effect, onValue })}
          />
          <LevelField
            label="Off"
            fixture={fixture}
            levels={effect.offValue}
            onChange={(offValue) => onChange({ ...effect, offValue })}
          />
          <div className="field-row">
            <label>
              On (s)
              <NumberInput
                value={effect.onTimeS}
                step={0.1}
                min={0.1}
                onChange={(v) => v !== null && onChange({ ...effect, onTimeS: v })}
              />
            </label>
            <label>
              Off (s)
              <NumberInput
                value={effect.offTimeS}
                step={0.1}
                min={0.1}
                onChange={(v) => v !== null && onChange({ ...effect, offTimeS: v })}
              />
            </label>
          </div>
        </>
      );
    case "variable":
      return (
        <>
          <InputsField
            fixture={fixture}
            inputs={effect.inputs}
            onChange={(inputs) => onChange({ ...effect, inputs })}
          />
          <div className="field-row">
            <label>
              From
              <NumberInput
                value={effect.minInput}
                onChange={(v) => v !== null && onChange({ ...effect, minInput: v })}
              />
            </label>
            <label>
              To
              <NumberInput
                value={effect.maxInput}
                onChange={(v) => v !== null && onChange({ ...effect, maxInput: v })}
              />
            </label>
          </div>
          <LevelField
            label="Out min"
            fixture={fixture}
            levels={effect.minOutput}
            onChange={(minOutput) => onChange({ ...effect, minOutput })}
          />
          <LevelField
            label="Out max"
            fixture={fixture}
            levels={effect.maxOutput}
            onChange={(maxOutput) => onChange({ ...effect, maxOutput })}
          />
        </>
      );
    case "noise":
      return (
        <>
          <LevelField
            label="Min"
            fixture={fixture}
            levels={effect.minValue}
            onChange={(minValue) => onChange({ ...effect, minValue })}
          />
          <LevelField
            label="Max"
            fixture={fixture}
            levels={effect.maxValue}
            onChange={(maxValue) => onChange({ ...effect, maxValue })}
          />
          <div className="field-row">
            <label title="Seconds to fade from one random level to the next. 0 flickers hard.">
              Smoothness
              <NumberInput
                value={effect.smoothness}
                step={0.1}
                min={0}
                onChange={(v) => v !== null && onChange({ ...effect, smoothness: v })}
              />
            </label>
          </div>
        </>
      );
  }
}

/**
 * Which trigger each channel follows.
 *
 * One per channel, because EE's Variable effect reads a single variable
 * and the comma list is split the same way every other setting is. One
 * entry means every channel follows the same thing.
 */
function InputsField({
  fixture,
  inputs,
  onChange,
}: {
  fixture: EEDmxFixture | null;
  inputs: readonly string[];
  onChange: (inputs: string[]) => void;
}): JSX.Element {
  const perChannel = fixture !== null && (fixture.slots.length > 1 || inputs.length > 1);
  const triggers = (
    <>
      {DMX_TRIGGERS.map((trigger) => (
        <option key={trigger} value={trigger}>
          {trigger}
        </option>
      ))}
    </>
  );

  if (!perChannel) {
    return (
      <div className="field-row">
        <label>
          Follows
          <select value={inputs[0] ?? "Hull"} onChange={(e) => onChange([e.target.value])}>
            {triggers}
          </select>
        </label>
      </div>
    );
  }

  const expanded = expandLevels(
    inputs.map((_, i) => i),
    fixture.slots.length,
  ).map((i) => inputs[i] ?? "Hull");

  return (
    <div className="dmx-level">
      <div className="dmx-level-head">
        <span>Follows</span>
        <button
          type="button"
          className="small"
          title="Make every channel follow the first one."
          onClick={() => onChange([expanded[0] ?? "Hull"])}
        >
          all the same
        </button>
      </div>
      {fixture.slots.map((slot, index) => (
        <div className="dmx-level-row" key={index}>
          <span className="dmx-slot-label">
            <span className="muted">{slot.channel}</span> {slot.role === "none" ? "" : slot.role}
          </span>
          <select aria-label={`Channel ${slot.channel} follows`}
            value={expanded[index] ?? "Hull"}
            onChange={(e) =>
              onChange(expanded.map((name, i) => (i === index ? e.target.value : name)))
            }
          >
            {triggers}
          </select>
        </div>
      ))}
    </div>
  );
}


