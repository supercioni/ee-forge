import { useEffect, useState } from "react";
import { evaluateRig, fixtureColor, DMX_UNREADABLE_TRIGGERS } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";

/**
 * What the rig would put on the wire, right now (ADR-0040).
 *
 * The values come from the live ship — the bridge reads exactly the
 * telemetry EE's own DMX cues are built from — and the bars are rendered
 * by `evaluateRig`, the same pure function the tests pin. So a rule that
 * looks right here is right, without wiring a single lamp.
 *
 * Two honesty rules the panel keeps:
 *
 *  - Triggers EE feeds its DMX code but exposes to **no Lua getter** are
 *    listed as unreadable rather than shown as zero, which would read as
 *    "off" instead of "unknown".
 *  - Events are not previewed at all. They fire on a change over time and
 *    this is a snapshot; showing them dark would suggest they are broken.
 */
/** Only for a fixture that declares primaries; the rest show bars alone. */
function Swatch({ color }: { color: readonly number[] | null }): JSX.Element | null {
  if (color === null) return null;
  const [r, g, b] = color;
  return (
    <span
      className="dmx-swatch"
      title={`rgb(${r ?? 0}, ${g ?? 0}, ${b ?? 0})`}
      style={{ background: `rgb(${r ?? 0}, ${g ?? 0}, ${b ?? 0})` }}
    />
  );
}

export function DmxPreview(): JSX.Element {
  const rig = useEditor((s) => s.rig);
  const reading = useEditor((s) => s.dmxTriggers);
  const refresh = useEditor((s) => s.refreshDmxTriggers);
  const [clock, setClock] = useState(0);

  // Two rates on purpose: the ship is polled twice a second, which is
  // plenty for hull and alert, while the clock ticks fast so a glow or a
  // blink animates rather than stepping.
  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 500);
    const tick = setInterval(() => setClock((t) => t + 0.1), 100);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  if (rig === null) return <aside className="right" />;

  const triggers = new Map(Object.entries(reading?.values ?? { Always: 1 }));
  const output = evaluateRig(rig, triggers, clock);

  /** Which trigger names this rig actually mentions. */
  const used = new Set<string>();
  for (const state of rig.states) {
    used.add(state.condition.trigger);
    if (state.effect.kind === "variable") for (const input of state.effect.inputs) used.add(input);
  }
  for (const event of rig.events) {
    used.add(event.variable);
    if (event.effect.kind === "variable") for (const input of event.effect.inputs) used.add(input);
  }

  const blind = [...used].filter((name) => DMX_UNREADABLE_TRIGGERS.includes(name));

  return (
    <aside className="right dmx-preview">
      <section className="panel">
        <div className="panel-head">
          <h2>Preview</h2>
          <span className={reading?.live === true ? "live-dot on" : "live-dot"}>
            {reading?.live === true ? "live ship" : "no ship"}
          </span>
        </div>
        <p className="hint">
          {reading?.live === true
            ? "Values read from the running ship."
            : "EmptyEpsilon is not running, or has no player ship. Rules still evaluate — with every trigger at zero."}
        </p>

        {rig.fixtures.length === 0 && <p className="hint">Declare a fixture to see it here.</p>}

        {rig.fixtures.map((fixture) => {
          const levels = output.get(fixture.name) ?? [];
          return (
            <div className="dmx-bar-row" key={fixture.id}>
              <span className="dmx-bar-name">
                {/* The same projection the editor picks with, so what you
                    chose and what would go out are visibly one thing. */}
                <Swatch color={fixtureColor(fixture, levels)} />
                {fixture.name}
              </span>
              <div className="dmx-bars">
                {levels.map((level, i) => (
                  <div
                    className="dmx-bar"
                    key={i}
                    title={`channel ${fixture.slots[i]?.channel ?? "?"} — ${
                      fixture.slots[i]?.role ?? "level"
                    }`}
                  >
                    <div className="dmx-bar-fill" style={{ width: `${level * 100}%` }} />
                  </div>
                ))}
              </div>
              <span className="dmx-bar-value">
                {levels.map((level) => level.toFixed(2)).join(" ")}
              </span>
            </div>
          );
        })}
      </section>

      <section className="panel">
        <h2>Triggers this rig watches</h2>
        {used.size === 0 && <p className="hint">None yet.</p>}
        {[...used].sort().map((name) => {
          const value = triggers.get(name);
          const readable = !DMX_UNREADABLE_TRIGGERS.includes(name);
          return (
            <div className="dmx-trigger" key={name}>
              <span>{name}</span>
              <span className={readable ? "" : "muted"}>
                {readable ? (value ?? 0).toFixed(1) : "not readable from Lua"}
              </span>
            </div>
          );
        })}

        {blind.length > 0 && (
          <p className="hint">
            EmptyEpsilon drives its own DMX from these, but exposes no Lua getter for them in
            this build — so they work in game and cannot be previewed here.
          </p>
        )}
        {rig.events.length > 0 && (
          <p className="hint">
            {rig.events.length} event(s) are not previewed: they fire on a change over time, and
            this is a snapshot.
          </p>
        )}
      </section>
    </aside>
  );
}
