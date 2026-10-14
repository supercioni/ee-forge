import type {
  EEBeamDef,
  EEDialogue,
  EEDoorDef,
  EEMissileSize,
  EEMissileType,
  EEMarker,
  EEPointRef,
  EERoomDef,
  EESpawnOrder,
  EESpawnOrderKind,
  EETubeDef,
  ShipSystemName,
  Vec2,
} from "@forge/contracts";
import {
  SPAWN_ORDER_OPTIONS,
  blankSpawnOrder,
  createBeam,
  createTube,
} from "@forge/core/editor";
import type { FieldSpec } from "@forge/core/editor";
import { ColorPicker } from "../ui/ColorPicker.js";
import { PlaceField } from "./PlaceField.js";
import { NumberInput } from "../ui/NumberInput.js";
import { formatPeriod } from "../ui/duration.js";

/**
 * One control per field descriptor.
 *
 * Lives apart from the object inspector because the ship-template editor
 * renders the same descriptors: one widget vocabulary, two forms. A widget
 * added here is available to both, and the descriptor tables in
 * `@forge/core/editor` decide which form uses it.
 */

/**
 * Read a typed starting value out of one text box.
 *
 * A variable may hold a number, a flag or a string, and asking an author
 * to pick the type before typing the value is a question they should not
 * have to answer: `12` is a number, `true` is a flag, everything else is
 * text.
 */
function parseInitial(text: string): string | number | boolean {
  if (text === "true") return true;
  if (text === "false") return false;
  const numeric = Number(text);
  return text.trim() !== "" && Number.isFinite(numeric) ? numeric : text;
}

/** Fallback for forms that edit something with no place on the map. */
const ORIGIN: Vec2 = { x: 0, y: 0 };

/**
 * What a fresh orbit starts at: one revolution per hour.
 *
 * The old default was 3 — three seconds a lap — because the field was
 * believed to be a rate. At a typical moon radius of 5000 units an hour
 * works out near 9 units/s, a tenth of a warship's impulse speed: the
 * body visibly moves across a session without reading as a fairground
 * ride.
 */
const DEFAULT_ORBIT_PERIOD_S = 3600;

/** The ship-template form has no map behind it, and so no markers. */
const NO_MARKERS: readonly EEMarker[] = [];
const NO_DIALOGUES: readonly EEDialogue[] = [];

export function FieldControl({
  spec,
  value,
  options,
  markers = NO_MARKERS,
  dialogues = NO_DIALOGUES,
  origin = ORIGIN,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  options: readonly string[] | null;
  /** The project's named places, for the widgets that edit one. */
  markers?: readonly EEMarker[];
  /** The project's comms dialogues, for the field that attaches one. */
  dialogues?: readonly EEDialogue[];
  /**
   * Where the edited object sits, for the widgets that need a sensible
   * starting point rather than (0, 0). Only `spawnOrder` reads it today;
   * the ship-template form has no position to give and takes the default.
   */
  origin?: Vec2;
  onChange: (value: unknown) => void;
}): JSX.Element {
  switch (spec.widget) {
    case "text":
      return (
        <input
          aria-label={spec.label}
          value={typeof value === "string" ? value : ""}
          placeholder={spec.nullable ? "(unset)" : ""}
          onChange={(e) => onChange(e.target.value === "" && spec.nullable ? null : e.target.value)}
        />
      );
    case "textarea":
      return (
        <textarea
          aria-label={spec.label}
          rows={2}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" && spec.nullable ? null : e.target.value)}
        />
      );
    case "number":
      return (
        <NumberInput
          label={spec.label}
          value={typeof value === "number" ? value : null}
          nullable={spec.nullable}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          placeholder={spec.nullable ? "(unset)" : ""}
          onChange={onChange}
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          aria-label={spec.label}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "select":
      return (
        <select
          aria-label={spec.label}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" && spec.nullable ? null : e.target.value)}
        >
          {spec.nullable && <option value="">(unset)</option>}
          {options === null ? (
            <option value={typeof value === "string" ? value : ""}>
              {typeof value === "string" ? value : "(scan the install for options)"}
            </option>
          ) : (
            <>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              {/* A name the project holds that this list does not offer stays on show, marked, instead of the
                  select quietly displaying a different entry: what is saved is what is written here. */}
              {typeof value === "string" && value !== "" && !options.includes(value) && (
                <option value={value}>{value} (not in this list)</option>
              )}
            </>
          )}
        </select>
      );
    case "vec2": {
      const vec = (value ?? { x: 0, y: 0 }) as Vec2;
      return (
        <div className="vec2">
          <NumberInput
            label={`${spec.label} x`}
            value={vec.x}
            step={100}
            onChange={(next) => next !== null && onChange({ ...vec, x: next })}
          />
          <NumberInput
            label={`${spec.label} y`}
            value={vec.y}
            step={100}
            onChange={(next) => next !== null && onChange({ ...vec, y: next })}
          />
        </div>
      );
    }
    case "color255":
    case "color01":
      return (
        <ColorPicker
          label={spec.label}
          value={Array.isArray(value) ? (value as number[]) : null}
          scale={spec.widget === "color01" ? 1 : 255}
          nullable={spec.nullable}
          onChange={onChange}
        />
      );
    case "points": {
      const points = Array.isArray(value) ? (value as Vec2[]) : [];
      return (
        <div className="points">
          {points.map((point, i) => (
            <div className="vec2" key={i}>
              <NumberInput
                label={`${spec.label} corner ${i + 1} x`}
                value={point.x}
                step={100}
                onChange={(x) => {
                  if (x === null) return;
                  const next = [...points];
                  next[i] = { ...point, x };
                  onChange(next);
                }}
              />
              <NumberInput
                label={`${spec.label} corner ${i + 1} y`}
                value={point.y}
                step={100}
                onChange={(y) => {
                  if (y === null) return;
                  const next = [...points];
                  next[i] = { ...point, y };
                  onChange(next);
                }}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const last = points[points.length - 1] ?? { x: 0, y: 0 };
              onChange([...points, { x: last.x + 1000, y: last.y }]);
            }}
          >
            Add corner
          </button>
        </div>
      );
    }
    case "orbit": {
      const orbit = value as { targetId: string; orbitTimeS: number } | null;
      return (
        <div className="orbit-field">
          <div className="vec2">
            <input
              aria-label="Orbit target object id"
              autoComplete="off"
              spellCheck={false}
              placeholder="target object id"
              value={orbit?.targetId ?? ""}
              onChange={(e) =>
                onChange(
                  e.target.value === ""
                    ? null
                    : {
                        targetId: e.target.value,
                        orbitTimeS: orbit?.orbitTimeS ?? DEFAULT_ORBIT_PERIOD_S,
                      },
                )
              }
            />
            <NumberInput
              label="Orbital period (s)"
              // One click, one minute: the arrows should walk the value
              // through the range a planet actually lives in.
              step={60}
              value={orbit?.orbitTimeS ?? null}
              disabled={orbit === null}
              onChange={(orbitTimeS) => {
                if (orbit === null || orbitTimeS === null) return;
                onChange({ ...orbit, orbitTimeS });
              }}
            />
          </div>
          {orbit !== null &&
            (orbit.orbitTimeS === 0 ? (
              <p className="hint error">
                A period of 0 makes EE divide by zero: the planet&apos;s position becomes NaN.
              </p>
            ) : (
              <p className="hint">one revolution every {formatPeriod(orbit.orbitTimeS)}</p>
            ))}
        </div>
      );
    }
    case "dialogueRef": {
      // The station warning lives in the descriptor's hint, which the
      // inspector already shows; this control only picks.
      const id = typeof value === "string" ? value : "";
      return (
        <select
          aria-label={spec.label}
          value={id}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">(none — EE's own comms for this class)</option>
          {dialogues.map((dialogue) => (
            <option key={dialogue.id} value={dialogue.id}>
              {dialogue.label}
            </option>
          ))}
          {id !== "" && !dialogues.some((d) => d.id === id) && (
            <option value={id}>{id} — missing</option>
          )}
        </select>
      );
    }
    case "pointRef": {
      // A place on an object: a wormhole's exit, a probe's target. Both
      // are somewhere the author may also want a trigger on, which is
      // exactly what a marker is for.
      const ref = value as EEPointRef | null;
      if (ref === null) {
        return (
          <button
            type="button"
            className="small"
            onClick={() => onChange({ ref: "point", position: { ...origin } })}
          >
            Set a place
          </button>
        );
      }
      return (
        <div className="place-clearable">
          <PlaceField value={ref} markers={markers} onChange={onChange} />
          {spec.nullable && (
            <button type="button" className="small" onClick={() => onChange(null)}>
              Clear
            </button>
          )}
        </div>
      );
    }
    case "spawnOrder": {
      const order = value as EESpawnOrder | null;
      const chosen = SPAWN_ORDER_OPTIONS.find((option) => option.kind === order?.kind);
      return (
        <div className="spawn-order">
          <select
            aria-label={spec.label}
            value={order?.kind ?? ""}
            onChange={(e) =>
              onChange(
                e.target.value === ""
                  ? null
                  : blankSpawnOrder(e.target.value as EESpawnOrderKind, origin),
              )
            }
          >
            <option value="">(none — EE leaves it Idle)</option>
            {SPAWN_ORDER_OPTIONS.map((option) => (
              <option key={option.kind} value={option.kind}>
                {option.label}
              </option>
            ))}
          </select>
          {order?.kind === "defend_location" && (
            // Coordinates seeded with the ship's own position, so the
            // common case — "hold this station" — is already correct on
            // arrival; or a marker, so the patrol anchor can be moved once
            // and every record that names it follows.
            <PlaceField
              value={order.position}
              markers={markers}
              onChange={(position) => onChange({ ...order, position })}
            />
          )}
          {chosen !== undefined && <p className="hint">{chosen.hint}</p>}
        </div>
      );
    }
    case "variables": {
      // Per-object state (ADR-0035). Rows rather than free JSON: the
      // narrative forms offer these names in a picker, and a name that
      // exists only inside a blob is a name nothing else can find.
      const rows = Array.isArray(value)
        ? (value as { name: string; initial: string | number | boolean }[])
        : [];
      return (
        <div className="points">
          {rows.map((row, i) => (
            <div className="vec2" key={i}>
              <input
                aria-label={`${spec.label} ${i + 1} name`}
                autoComplete="off"
                spellCheck={false}
                value={row.name}
                placeholder="name"
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, name: e.target.value };
                  onChange(next);
                }}
              />
              <input
                aria-label={`${spec.label} ${i + 1} initial value`}
                autoComplete="off"
                spellCheck={false}
                value={String(row.initial)}
                placeholder="initial"
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, initial: parseInitial(e.target.value) };
                  onChange(next);
                }}
              />
              <button aria-label={`Remove ${spec.label} row ${i + 1}`}
                type="button"
                className="small danger"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() => onChange([...rows, { name: "flag", initial: 0 }])}
          >
            + Variable
          </button>
        </div>
      );
    }
    case "weaponStorage": {
      const rows = Array.isArray(value)
        ? (value as { weapon: string; amount: number }[])
        : [];
      return (
        <div className="points">
          {rows.map((row, i) => (
            <div className="vec2" key={i}>
              <span className="muted">{row.weapon}</span>
              <NumberInput
                label={`${spec.label}: ${row.weapon}`}
                min={0}
                value={row.amount}
                onChange={(amount) => {
                  if (amount === null) return;
                  const next = [...rows];
                  next[i] = { ...row, amount };
                  onChange(next);
                }}
              />
            </div>
          ))}
          {rows.length === 0 && <span className="hint">none</span>}
        </div>
      );
    }
    case "stringList": {
      const rows = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="points">
          {rows.map((row, i) => (
            <div className="vec2" key={i}>
              <input
                aria-label={`${spec.label} ${i + 1}`}
                autoComplete="off"
                spellCheck={false}
                value={row}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = e.target.value;
                  onChange(next);
                }}
              />
              <button aria-label={`Remove ${spec.label} row ${i + 1}`}
                type="button"
                className="small danger"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ))}
          <button type="button" className="small" onClick={() => onChange([...rows, ""])}>
            + Class
          </button>
        </div>
      );
    }
    case "numberList": {
      const rows = Array.isArray(value) ? (value as number[]) : [];
      return (
        <div className="points">
          {rows.map((row, i) => (
            <div className="vec2" key={i}>
              <NumberInput
                label={`${spec.label} ${i + 1}`}
                value={row}
                min={spec.min}
                onChange={(next) => {
                  if (next === null) return;
                  const copy = [...rows];
                  copy[i] = next;
                  onChange(copy);
                }}
              />
              <button aria-label={`Remove ${spec.label} row ${i + 1}`}
                type="button"
                className="small danger"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() => onChange([...rows, rows[rows.length - 1] ?? 0])}
          >
            + Arc
          </button>
        </div>
      );
    }
    case "speed": {
      // EE takes reverse speed and reverse acceleration as optional trailing
      // arguments, so they are only offered once the forward three exist.
      const speed = value as {
        impulse: number;
        turn: number;
        acceleration: number;
        reverseSpeed: number | null;
        reverseAcceleration: number | null;
      } | null;
      if (speed === null) {
        return (
          <button
            type="button"
            className="small"
            onClick={() =>
              onChange({
                impulse: 60,
                turn: 10,
                acceleration: 20,
                reverseSpeed: null,
                reverseAcceleration: null,
              })
            }
          >
            + Engines
          </button>
        );
      }
      const part = (
        key: "impulse" | "turn" | "acceleration" | "reverseSpeed" | "reverseAcceleration",
        label: string,
        nullable: boolean,
      ): JSX.Element => (
        <label className="sub" key={key}>
          <span>{label}</span>
          <NumberInput
            value={speed[key]}
            min={0}
            nullable={nullable}
            onChange={(next) => {
              if (next === null && !nullable) return;
              onChange({ ...speed, [key]: next });
            }}
          />
        </label>
      );
      return (
        <div className="record">
          {part("impulse", "impulse", false)}
          {part("turn", "turn", false)}
          {part("acceleration", "accel", false)}
          {part("reverseSpeed", "reverse", true)}
          {speed.reverseSpeed !== null && part("reverseAcceleration", "rev accel", true)}
          <button aria-label={`Clear ${spec.label}`} type="button" className="small danger" onClick={() => onChange(null)}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      );
    }
    case "combatManeuver": {
      const cm = value as { boost: number; strafe: number } | null;
      if (cm === null) {
        return (
          <button
            type="button"
            className="small"
            onClick={() => onChange({ boost: 400, strafe: 200 })}
          >
            + Manoeuvre
          </button>
        );
      }
      return (
        <div className="record">
          <label className="sub">
            <span>boost</span>
            <NumberInput
              value={cm.boost}
              min={0}
              onChange={(boost) => boost !== null && onChange({ ...cm, boost })}
            />
          </label>
          <label className="sub">
            <span>strafe</span>
            <NumberInput
              value={cm.strafe}
              min={0}
              onChange={(strafe) => strafe !== null && onChange({ ...cm, strafe })}
            />
          </label>
          <button aria-label={`Clear ${spec.label}`} type="button" className="small danger" onClick={() => onChange(null)}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      );
    }
    case "jumpDrive": {
      const jump = value as {
        enabled: boolean;
        minRange: number | null;
        maxRange: number | null;
      } | null;
      if (jump === null) {
        return (
          <button
            type="button"
            className="small"
            onClick={() => onChange({ enabled: true, minRange: null, maxRange: null })}
          >
            + Jump drive
          </button>
        );
      }
      return (
        <div className="record">
          <label className="sub">
            <span>enabled</span>
            <input
              type="checkbox"
              checked={jump.enabled}
              onChange={(e) => onChange({ ...jump, enabled: e.target.checked })}
            />
          </label>
          <label className="sub">
            <span>min</span>
            <NumberInput
              value={jump.minRange}
              min={0}
              nullable
              onChange={(minRange) => onChange({ ...jump, minRange })}
            />
          </label>
          <label className="sub">
            <span>max</span>
            <NumberInput
              value={jump.maxRange}
              min={0}
              nullable
              onChange={(maxRange) => onChange({ ...jump, maxRange })}
            />
          </label>
          <button aria-label={`Clear ${spec.label}`} type="button" className="small danger" onClick={() => onChange(null)}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      );
    }
    case "beams": {
      const beams = Array.isArray(value) ? (value as EEBeamDef[]) : [];
      const patch = (i: number, next: EEBeamDef): void =>
        onChange(beams.map((b, j) => (j === i ? next : b)));
      return (
        <div className="table">
          {beams.map((beam, i) => (
            <div className="table-row" key={beam.index}>
              <span className="index">#{beam.index}</span>
              {(
                [
                  ["arc", "arc°"],
                  ["direction", "dir°"],
                  ["range", "range"],
                  ["cycleTime", "cycle"],
                  ["damage", "dmg"],
                ] as const
              ).map(([key, label]) => (
                <label className="sub" key={key}>
                  <span>{label}</span>
                  <NumberInput
                    value={beam[key]}
                    onChange={(next) => next !== null && patch(i, { ...beam, [key]: next })}
                  />
                </label>
              ))}
              <label className="sub">
                <span>turret</span>
                <input
                  type="checkbox"
                  checked={beam.turret !== null}
                  onChange={(e) =>
                    patch(i, {
                      ...beam,
                      turret: e.target.checked
                        ? { arc: 270, direction: beam.direction, rotationRate: 5 }
                        : null,
                    })
                  }
                />
              </label>
              {beam.turret !== null && (
                <>
                  <label className="sub">
                    <span>t.arc°</span>
                    <NumberInput
                      value={beam.turret.arc}
                      onChange={(arc) =>
                        arc !== null &&
                        beam.turret !== null &&
                        patch(i, { ...beam, turret: { ...beam.turret, arc } })
                      }
                    />
                  </label>
                  <label className="sub">
                    <span>t.dir°</span>
                    <NumberInput
                      value={beam.turret.direction}
                      onChange={(direction) =>
                        direction !== null &&
                        beam.turret !== null &&
                        patch(i, { ...beam, turret: { ...beam.turret, direction } })
                      }
                    />
                  </label>
                  <label className="sub">
                    <span>°/s</span>
                    <NumberInput
                      value={beam.turret.rotationRate}
                      onChange={(rotationRate) =>
                        rotationRate !== null &&
                        beam.turret !== null &&
                        patch(i, { ...beam, turret: { ...beam.turret, rotationRate } })
                      }
                    />
                  </label>
                </>
              )}
              <label className="sub">
                <span>energy</span>
                <NumberInput
                  value={beam.energyPerFire}
                  nullable
                  onChange={(energyPerFire) => patch(i, { ...beam, energyPerFire })}
                />
              </label>
              <label className="sub">
                <span>heat</span>
                <NumberInput
                  value={beam.heatPerFire}
                  nullable
                  step={0.01}
                  onChange={(heatPerFire) => patch(i, { ...beam, heatPerFire })}
                />
              </label>
              <label className="sub wide">
                <span>texture</span>
                <input
                  value={beam.texture ?? ""}
                  placeholder="(default)"
                  onChange={(e) =>
                    patch(i, { ...beam, texture: e.target.value === "" ? null : e.target.value })
                  }
                />
              </label>
              <button aria-label={`Remove ${spec.label} row ${i + 1}`}
                type="button"
                className="small danger"
                onClick={() => onChange(beams.filter((_, j) => j !== i))}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() => onChange([...beams, createBeam(beams)])}
          >
            + Beam
          </button>
        </div>
      );
    }
    case "tubes": {
      const tubes = value as { count: number; loadTime: number; perTube: EETubeDef[] } | null;
      if (tubes === null) {
        return (
          <button
            type="button"
            className="small"
            onClick={() => onChange({ count: 1, loadTime: 10, perTube: [] })}
          >
            + Tubes
          </button>
        );
      }
      const patch = (i: number, next: EETubeDef): void =>
        onChange({ ...tubes, perTube: tubes.perTube.map((t, j) => (j === i ? next : t)) });
      const toggle = (
        row: EETubeDef,
        i: number,
        key: "allow" | "disallow",
        weapon: EEMissileType,
      ): void => {
        const has = row[key].includes(weapon);
        patch(i, {
          ...row,
          [key]: has ? row[key].filter((w) => w !== weapon) : [...row[key], weapon],
        });
      };
      const MISSILES: readonly EEMissileType[] = ["Homing", "Nuke", "Mine", "EMP", "HVLI"];
      return (
        <div className="table">
          <div className="table-row">
            <label className="sub">
              <span>count</span>
              <NumberInput
                value={tubes.count}
                min={0}
                max={16}
                onChange={(count) => count !== null && onChange({ ...tubes, count })}
              />
            </label>
            <label className="sub">
              <span>load</span>
              <NumberInput
                value={tubes.loadTime}
                min={0.1}
                onChange={(loadTime) => loadTime !== null && onChange({ ...tubes, loadTime })}
              />
            </label>
            <button aria-label={`Clear ${spec.label}`} type="button" className="small danger" onClick={() => onChange(null)}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          {tubes.perTube.map((row, i) => (
            <div className="table-row" key={row.index}>
              <span className="index">#{row.index}</span>
              <label className="sub">
                <span>dir°</span>
                <NumberInput
                  value={row.direction}
                  nullable
                  onChange={(direction) => patch(i, { ...row, direction })}
                />
              </label>
              <label className="sub">
                <span>load</span>
                <NumberInput
                  value={row.loadTime}
                  nullable
                  min={0.1}
                  onChange={(loadTime) => patch(i, { ...row, loadTime })}
                />
              </label>
              <label className="sub">
                <span>size</span>
                <select
                  value={row.size ?? ""}
                  onChange={(e) =>
                    patch(i, {
                      ...row,
                      size: e.target.value === "" ? null : (e.target.value as EEMissileSize),
                    })
                  }
                >
                  <option value="">(default)</option>
                  <option value="small">small</option>
                  <option value="medium">medium</option>
                  <option value="large">large</option>
                </select>
              </label>
              <label className="sub">
                <span>only</span>
                <select
                  value={row.exclusiveFor ?? ""}
                  onChange={(e) =>
                    patch(i, {
                      ...row,
                      exclusiveFor:
                        e.target.value === "" ? null : (e.target.value as EEMissileType),
                    })
                  }
                >
                  <option value="">(any)</option>
                  {MISSILES.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
              <div className="chips">
                {MISSILES.map((w) => (
                  <button
                    type="button"
                    key={w}
                    className={
                      row.allow.includes(w)
                        ? "chip allow"
                        : row.disallow.includes(w)
                          ? "chip deny"
                          : "chip"
                    }
                    title={
                      row.allow.includes(w)
                        ? `${w} explicitly allowed — click to clear`
                        : row.disallow.includes(w)
                          ? `${w} disallowed — click to allow`
                          : `${w} left at EE's default — click to disallow`
                    }
                    onClick={() =>
                      row.disallow.includes(w)
                        ? (toggle(row, i, "disallow", w), toggle(row, i, "allow", w))
                        : row.allow.includes(w)
                          ? toggle(row, i, "allow", w)
                          : toggle(row, i, "disallow", w)
                    }
                  >
                    {w}
                  </button>
                ))}
              </div>
              <button aria-label={`Remove ${spec.label} row ${i + 1}`}
                type="button"
                className="small danger"
                onClick={() =>
                  onChange({ ...tubes, perTube: tubes.perTube.filter((_, j) => j !== i) })
                }
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() =>
              onChange({ ...tubes, perTube: [...tubes.perTube, createTube(tubes.perTube)] })
            }
          >
            + Tube override
          </button>
        </div>
      );
    }
    case "rooms": {
      const rooms = Array.isArray(value) ? (value as EERoomDef[]) : [];
      const SYSTEMS: readonly ShipSystemName[] = [
        "reactor",
        "beamweapons",
        "missilesystem",
        "maneuver",
        "impulse",
        "warp",
        "jumpdrive",
        "frontshield",
        "rearshield",
      ];
      const patch = (i: number, next: EERoomDef): void =>
        onChange(rooms.map((r, j) => (j === i ? next : r)));
      return (
        <div className="table">
          {rooms.map((room, i) => (
            <div className="table-row" key={i}>
              {(
                [
                  ["x", "x"],
                  ["y", "y"],
                  ["width", "w"],
                  ["height", "h"],
                ] as const
              ).map(([key, label]) => (
                <label className="sub" key={key}>
                  <span>{label}</span>
                  <NumberInput
                    value={room[key]}
                    step={1}
                    onChange={(next) => next !== null && patch(i, { ...room, [key]: next })}
                  />
                </label>
              ))}
              <label className="sub wide">
                <span>system</span>
                <select
                  value={room.system ?? ""}
                  onChange={(e) =>
                    patch(i, {
                      ...room,
                      system: e.target.value === "" ? null : (e.target.value as ShipSystemName),
                    })
                  }
                >
                  <option value="">(corridor)</option>
                  {SYSTEMS.map((sys) => (
                    <option key={sys} value={sys}>
                      {sys}
                    </option>
                  ))}
                </select>
              </label>
              <button aria-label={`Remove ${spec.label} row ${i + 1}`}
                type="button"
                className="small danger"
                onClick={() => onChange(rooms.filter((_, j) => j !== i))}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() => onChange([...rooms, { x: 0, y: 0, width: 1, height: 1, system: null }])}
          >
            + Room
          </button>
        </div>
      );
    }
    case "doors": {
      const doors = Array.isArray(value) ? (value as EEDoorDef[]) : [];
      const patch = (i: number, next: EEDoorDef): void =>
        onChange(doors.map((d, j) => (j === i ? next : d)));
      return (
        <div className="table">
          {doors.map((door, i) => (
            <div className="table-row" key={i}>
              <label className="sub">
                <span>x</span>
                <NumberInput
                  value={door.x}
                  step={1}
                  onChange={(x) => x !== null && patch(i, { ...door, x })}
                />
              </label>
              <label className="sub">
                <span>y</span>
                <NumberInput
                  value={door.y}
                  step={1}
                  onChange={(y) => y !== null && patch(i, { ...door, y })}
                />
              </label>
              <label className="sub">
                <span>horizontal</span>
                <input
                  type="checkbox"
                  checked={door.horizontal}
                  onChange={(e) => patch(i, { ...door, horizontal: e.target.checked })}
                />
              </label>
              <button aria-label={`Remove ${spec.label} row ${i + 1}`}
                type="button"
                className="small danger"
                onClick={() => onChange(doors.filter((_, j) => j !== i))}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() => onChange([...doors, { x: 0, y: 0, horizontal: true }])}
          >
            + Door
          </button>
        </div>
      );
    }
  }
}
