import { useMemo, useState } from "react";
import { simulate, type SimEvent, type SimExodus, type SimExodusEvent } from "@forge/core/editor";
import type { EEProject } from "@forge/contracts";
import { useEditor } from "../store/editor.js";
import { SIMULATION_SCOPE } from "../ui/glossary.js";
import { NumberInput } from "../ui/NumberInput.js";
import { useCollapsed } from "../ui/useCollapsed.js";

/**
 * The dry run.
 *
 * This is the same executor the parity test uses as its oracle against the
 * generated Lua (ADR-0034 §5), so what it prints here is what the emitted
 * scheduler will do — not a second implementation that agrees by luck.
 *
 * What it cannot model, it says out loud rather than quietly skipping:
 * absolute hull values need a template's hull max, AI orders need a combat
 * model, sound needs a speaker. A dry run that hid those would be worse
 * than none, because it would look complete.
 *
 * Events are the other half. A chapter's shape depends on things only a
 * live game produces — a wave destroyed, the player crossing a line — so
 * they are injected by hand here, which is also how an author checks the
 * branch that nobody plays.
 */
export function Simulator(): JSX.Element {
  const project = useEditor((s) => s.project);
  const [until, setUntil] = useState(600);
  const [folded, setFolded] = useCollapsed("simulator");
  const [events, setEvents] = useState<readonly (SimEvent | SimExodusEvent)[]>([]);
  const [exodusChoice, setExodusChoice] = useState<ExodusChoice>("running");
  const [lostAt, setLostAt] = useState(60);

  const objects = (project?.map.groups ?? []).flatMap((g) => g.objects);
  const groups = project?.map.groups ?? [];

  const usesExodus = (project?.requires.length ?? 0) > 0;
  const steps = project?.logic.exodusSteps ?? [];
  const exodus: SimExodus = exodusModel(exodusChoice, lostAt);

  const result = useMemo(
    () =>
      project === null
        ? null
        : simulate(project, { untilSeconds: until, events, ...(usesExodus ? { exodus } : {}) }),
    // `exodus` is rebuilt from the two inputs below on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, until, events, usesExodus, exodusChoice, lostAt],
  );

  const addEvent = (event: SimEvent | SimExodusEvent): void =>
    setEvents((current) => [...current, event].sort((a, b) => a.at - b.at));

  return (
    <section className="panel simulator" aria-label="Logic simulation">
      <div className="panel-head">
        <h2>
          <button type="button" className="section-toggle" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
            <span aria-hidden="true">{folded ? "▸" : "▾"}</span> Logic simulation
          </button>
        </h2>
        {folded && result !== null && (
          <span className="muted sim-oneline">
            {result.firings.length} thing{result.firings.length === 1 ? "" : "s"} ran in {until} s
          </span>
        )}
      </div>

      {!folded && (
        <>
      <p className="hint sim-scope" data-testid="sim-scope">
        {SIMULATION_SCOPE}
      </p>

      <h3>Test inputs</h3>
      <label className="inline">
        <span className="muted">Simulate the first</span>
        <NumberInput
          label="Simulated seconds"
          value={until}
          min={10}
          step={60}
          onChange={(next) => next !== null && setUntil(next)}
        />
        <span className="muted">seconds</span>
      </label>

      {usesExodus && (
        <div className="sim-exodus">
          <div className="action-head">
            <h3>EXODUS during the test</h3>
          </div>
          <select
            aria-label="EXODUS during the dry run"
            value={exodusChoice}
            onChange={(e) => setExodusChoice(e.target.value as ExodusChoice)}
          >
            <option value="running">running — the integrated scenario with EXODUS up</option>
            <option value="absent">not running — the integrated scenario, alternatives take over</option>
            <option value="stale">a beacon is left behind, but nothing is running</option>
            <option value="incompatible">running, wrong protocol</option>
            <option value="lost">running, then lost…</option>
            <option value="vanilla">vanilla export — no EXODUS at all</option>
          </select>
          {exodusChoice === "lost" && (
            <label className="inline">
              <span className="muted">noticed lost at</span>
              <NumberInput value={lostAt} min={1} step={10} onChange={(next) => next !== null && setLostAt(next)} />
            </label>
          )}
        </div>
      )}

      <div className="sim-events">
        <div className="action-head">
          <h3>Things that happen during the test</h3>
          {events.length > 0 && (
            <button type="button" className="small" onClick={() => setEvents([])}>
              Clear
            </button>
          )}
        </div>
        <p className="hint">
          The things only a live game produces. Without them a rule that waits
          for a wave to die never runs — which is a fact about the simulation,
          not about the mission.
        </p>
        <div className="field-row">
          <button
            type="button"
            className="small"
            disabled={groups.length === 0}
            onClick={() =>
              addEvent({
                at: Math.round(until / 2),
                kind: "destroy_group",
                groupId: groups[0]?.id ?? "",
              })
            }
          >
            + Group wiped
          </button>
          <button
            type="button"
            className="small"
            disabled={objects.length === 0}
            onClick={() =>
              addEvent({
                at: Math.round(until / 2),
                kind: "destroy_object",
                objectId: objects[0]?.id ?? "",
              })
            }
          >
            + Object destroyed
          </button>
          <button
            type="button"
            className="small"
            onClick={() => addEvent({ at: Math.round(until / 2), kind: "player_position", x: 0, y: 0 })}
          >
            + Player moves
          </button>
          {usesExodus && steps.length > 0 && (
            <>
              <button
                type="button"
                className="small"
                onClick={() =>
                  addEvent({ at: Math.round(until / 2), kind: "exodus_outcome", stepId: steps[0]?.id ?? "", outcome: "solved" })
                }
              >
                + EXODUS answers
              </button>
              <button
                type="button"
                className="small"
                onClick={() => addEvent({ at: Math.round(until / 2), kind: "gm_press", stepId: steps[0]?.id ?? "" })}
              >
                + GM presses
              </button>
            </>
          )}
        </div>

        <ul className="event-list">
          {events.map((event, index) => (
            <li key={index}>
              <NumberInput
                value={event.at}
                min={0}
                step={10}
                onChange={(at) =>
                  at !== null &&
                  setEvents((current) =>
                    current
                      .map((e, i) => (i === index ? { ...e, at } : e))
                      .sort((a, b) => a.at - b.at),
                  )
                }
              />
              {(event.kind === "exodus_outcome" || event.kind === "gm_press") && (
                <select
                  aria-label="step"
                  value={event.stepId}
                  onChange={(e) =>
                    setEvents((current) =>
                      current.map((x, i) => (i === index && "stepId" in x ? { ...x, stepId: e.target.value } : x)),
                    )
                  }
                >
                  {steps.map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.id}
                    </option>
                  ))}
                </select>
              )}
              {(() => {
                const patch = (changes: Record<string, unknown>): void =>
                  setEvents((current) => current.map((e, i) => (i === index ? ({ ...e, ...changes } as SimEvent | SimExodusEvent) : e)));
                if (event.kind === "destroy_group")
                  return (
                    <label className="inline">
                      <span className="muted">group wiped out:</span>
                      <select aria-label={`Event ${index + 1}: group`} value={event.groupId} onChange={(e) => patch({ groupId: e.target.value })}>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                if (event.kind === "destroy_object" || event.kind === "scan")
                  return (
                    <label className="inline">
                      <span className="muted">{event.kind === "scan" ? "scanned:" : "destroyed:"}</span>
                      <select aria-label={`Event ${index + 1}: object`} value={event.objectId} onChange={(e) => patch({ objectId: e.target.value })}>
                        {objects.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.callsign ?? o.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                if (event.kind === "player_position")
                  return (
                    <span className="inline">
                      <span className="muted">player at</span>
                      <NumberInput label={`Event ${index + 1}: player x`} value={event.x} step={500} onChange={(x) => x !== null && patch({ x })} />
                      <NumberInput label={`Event ${index + 1}: player y`} value={event.y} step={500} onChange={(y) => y !== null && patch({ y })} />
                    </span>
                  );
                if (event.kind === "player_hull")
                  return (
                    <span className="inline">
                      <span className="muted">player hull</span>
                      <NumberInput label={`Event ${index + 1}: hull fraction`} value={event.fraction} min={0} max={1} step={0.1} onChange={(fraction) => fraction !== null && patch({ fraction })} />
                    </span>
                  );
                return <span className="muted">{describeEvent(event)}</span>;
              })()}
              <button aria-label={`Remove injected event ${index + 1}`}
                type="button"
                className="small danger"
                onClick={() => setEvents((current) => current.filter((_, i) => i !== index))}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <h3>Result</h3>
      {result !== null && (
        <p className="hint sim-summary" role="status">
          {summary(result.firings.map((f) => f.source), project)} in {until} s.
          {neverRan(project, result.firings.filter((f) => f.source === "rule").map((f) => f.id)).length > 0 && (
            <>
              {" "}
              Never ran: {neverRan(project, result.firings.filter((f) => f.source === "rule").map((f) => f.id)).join(", ")}.
            </>
          )}
        </p>
      )}
      {result === null || result.firings.length === 0 ? (
        <p className="hint">Nothing runs in this window.</p>
      ) : (
        <ol className="firing-list" aria-label="What ran, in time order">
          {result.firings.map((firing, index) => (
            <li key={index}>
              <span className="firing-at">T+{firing.at}s</span>
              <span className={`badge ${firing.source}`}>{sourceWord(firing.source)}</span>
              <span>{firing.label}</span>
              <ul>
                {firing.actions.map((action, i) => (
                  <li key={i} className="muted">
                    {action}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {result !== null && usesExodus && (
        <>
          <h3>EXODUS steps in the test</h3>
          {Object.keys(result.steps).length === 0 && result.exodusLog.length === 0 ? (
            <p className="hint">No EXODUS step is reached in this window.</p>
          ) : (
            <>
              <ul className="hint">
                {Object.entries(result.steps).map(([id, phase]) => (
                  <li key={id}>
                    <strong>{id}</strong> — {phase}
                    {result.settledBy[id] !== undefined && ` (by ${settledLabel(result.settledBy[id])})`}
                  </li>
                ))}
              </ul>
              <ol className="firing-list">
                {result.exodusLog.map((line, index) => (
                  <li key={index}>
                    <span className="firing-at">T+{line.at}s</span>
                    <span className="muted">{line.text}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}

      {result !== null && result.endedWith !== null && (
        <p className="hint">Scenario ends: victory for {result.endedWith}.</p>
      )}

      {result !== null && result.notSimulated.length > 0 && (
        <>
          <h3>Left out of this simulation</h3>
          <ul className="hint">
            {result.notSimulated.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
        </>
      )}
    </section>
  );
}

type ExodusChoice = "running" | "absent" | "stale" | "incompatible" | "lost" | "vanilla";

function exodusModel(choice: ExodusChoice, lostAt: number): SimExodus {
  switch (choice) {
    case "vanilla":
      return { mode: "vanilla" };
    case "absent":
      return { mode: "integrated", service: { kind: "absent" } };
    case "stale":
      return { mode: "integrated", service: { kind: "stale" } };
    case "incompatible":
      return { mode: "integrated", service: { kind: "incompatible" } };
    case "lost":
      return { mode: "integrated", service: { kind: "active", lostAt } };
    case "running":
      return { mode: "integrated", service: { kind: "active" } };
  }
}

function settledLabel(via: string | undefined): string {
  switch (via) {
    case "service":
      return "EXODUS, which confirmed it";
    case "handoff":
      return "handing it to EXODUS — not confirmed";
    default:
      return "the alternative";
  }
}

function describeEvent(event: SimEvent | SimExodusEvent): string {
  switch (event.kind) {
    case "exodus_outcome":
      return `EXODUS reports “${event.outcome}”`;
    case "gm_press":
      return "the GM presses the button";
    case "checkpoint":
      return "the crew saves a checkpoint";
    case "restart":
      return "EmptyEpsilon is closed and started again";
    case "destroy_group":
      return `group ${event.groupId} wiped out`;
    case "destroy_object":
      return `${event.objectId} destroyed`;
    case "player_position":
      return `player at ${event.x}, ${event.y}`;
    case "player_hull":
      return `player hull ${event.fraction}`;
    case "system_health":
      return `${event.system} health ${event.value}`;
    case "scan":
      return `${event.objectId} ${event.full ? "fully " : ""}scanned`;
  }
}

/** What a firing's `source` is called in the editor. */
function sourceWord(source: string): string {
  return source === "beat" ? "timed event" : source === "gm" || source === "gmButton" ? "GM control" : source;
}

/** "3 things ran: 1 timed event, 2 rules" — counts by kind. */
function summary(sources: readonly string[], project: EEProject | null): string {
  if (sources.length === 0) return "Nothing ran";
  const count = new Map<string, number>();
  for (const s of sources) count.set(sourceWord(s), (count.get(sourceWord(s)) ?? 0) + 1);
  const parts = [...count].map(([word, n]) => `${n} ${word}${n === 1 ? "" : "s"}`);
  void project;
  return `${sources.length} thing${sources.length === 1 ? "" : "s"} ran: ${parts.join(", ")}`;
}

/** Rules that did not run in this window. */
function neverRan(project: EEProject | null, ranIds: readonly string[]): string[] {
  if (project === null) return [];
  const ran = new Set(ranIds);
  return project.logic.rules.filter((r) => !ran.has(r.id)).map((r) => r.label || r.id);
}
