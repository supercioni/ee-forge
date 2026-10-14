import { lazy, Suspense, useMemo, useState } from "react";
import {
  buildDiagram,
  describeAction,
  describeEdge,
  describePredicate,
  toMermaid,
  variableInfos,
  type VariableInfo,
} from "@forge/core/editor";
import type { EEAction, EEExodusStep, EEProject, EEVariableValue } from "@forge/contracts";
import { useEditor } from "../store/editor.js";
import { LOGIC_WORDS, MISSION_TABS, type MissionTabId } from "../ui/glossary.js";
import { NumberInput } from "../ui/NumberInput.js";
import { Timeline } from "./Timeline.js";

const DiagramView = lazy(() => import("./DiagramView.js"));

/**
 * The Mission view's centre: five sections, one at a time.
 *
 * *Rules* (when something becomes true, do something), *Timeline* (timed events — things that happen at a set time),
 * *GM controls* (buttons on the GM console), *Variables* and *Diagram*. They are the same three kinds of logic the
 * project always had, told apart on purpose: a timed event, a condition and a GM control are different things, and
 * one long page used to run them together. Whichever item is selected stays selected when the section changes, and
 * the side column edits it.
 */
export function Mission(): JSX.Element {
  const tab = useEditor((s) => s.missionTab);
  const setTab = useEditor((s) => s.setMissionTab);
  const project = useEditor((s) => s.project);
  const counts: Record<MissionTabId, number | null> = {
    rules: project?.logic.rules.length ?? 0,
    timeline: project?.logic.beats.length ?? 0,
    gm: project?.logic.gmButtons.length ?? 0,
    variables: project === null ? 0 : variableInfos(project).length,
    diagram: null,
    campaign: null,
  };
  return (
    <>
      <nav className="mission-tabs" aria-label="Mission sections">
        {MISSION_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : ""}
            aria-current={tab === t.id ? "page" : undefined}
            title={t.hint}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {counts[t.id] !== null && <span className="muted"> {counts[t.id]}</span>}
          </button>
        ))}
      </nav>
      {tab === "rules" && <RulesList />}
      {tab === "timeline" && <TimedEvents />}
      {tab === "gm" && <GmControls />}
      {tab === "variables" && <VariablesPanel />}
      {tab === "diagram" && <DiagramPanel />}
      {tab === "campaign" && <CampaignPanel />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Summaries: When / If / Then in words, with every detail one click away
// ---------------------------------------------------------------------------

/** What an EXODUS action does without EXODUS, so a nested alternative is reachable from the summary too. */
function nestedAlternative(action: EEAction, steps: readonly EEExodusStep[]): { step: string; lines: string[] } | null {
  if (!("stepId" in action) || action.stepId === null) return null;
  const step = steps.find((s) => s.id === action.stepId);
  if (step === undefined) return { step: action.stepId, lines: ["(the step is missing)"] };
  const alt = step.alternative;
  if (alt === null) return { step: step.id, lines: ["(not decided yet)"] };
  if (alt.kind === "none") return { step: step.id, lines: ["nothing, on purpose"] };
  const lines = alt.actions.map(describeAction);
  const lead = alt.kind === "wait" ? `after ${alt.seconds} s: ` : alt.kind === "gm" ? `GM presses “${alt.label}”: ` : "";
  return { step: step.id, lines: lines.length === 0 ? [`${lead}(no actions)`] : lines.map((l) => `${lead}${l}`) };
}

function ActionSummary({ actions, steps, limit = 3 }: { actions: readonly EEAction[]; steps: readonly EEExodusStep[]; limit?: number }): JSX.Element {
  if (actions.length === 0) return <span className="muted">nothing yet</span>;
  const row = (action: EEAction, i: number): JSX.Element => {
    const nested = nestedAlternative(action, steps);
    return (
      <li key={i}>
        {describeAction(action)}
        {nested !== null && (
          <ul className="nested">
            <li className="muted">
              without EXODUS (step {nested.step}): {nested.lines.join("; ")}
            </li>
          </ul>
        )}
      </li>
    );
  };
  const first = actions.slice(0, limit);
  const rest = actions.slice(limit);
  return (
    <>
      <ol className="then-list">{first.map(row)}</ol>
      {rest.length > 0 && (
        <details className="more-actions">
          <summary>
            +{rest.length} more action{rest.length === 1 ? "" : "s"}
          </summary>
          <ol className="then-list" start={limit + 1}>
            {rest.map((a, i) => row(a, limit + i))}
          </ol>
        </details>
      )}
    </>
  );
}

function RuleCard({ id }: { id: string }): JSX.Element | null {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.logicSelection);
  const selectLogic = useEditor((s) => s.selectLogic);
  const rule = project?.logic.rules.find((r) => r.id === id);
  if (project === null || rule === undefined) return null;
  const selected = selection?.kind === "rule" && selection.id === rule.id;
  return (
    <li className={`rule-card${selected ? " selected" : ""}`} onClick={() => selectLogic({ kind: "rule", id: rule.id })}>
      <div className="card-head">
        <button
          type="button"
          className="row-link card-title"
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            selectLogic({ kind: "rule", id: rule.id });
          }}
        >
          <strong>{rule.label || rule.id}</strong>
        </button>
        <span className="badge">{rule.once ? "runs once" : "repeats"}</span>
      </div>
      <dl className="www">
        <div>
          <dt>When</dt>
          <dd>{describePredicate(rule.when)}</dd>
        </div>
        <div>
          <dt>If</dt>
          <dd>{rule.conditions.length === 0 ? <span className="muted">no extra condition</span> : rule.conditions.map(describePredicate).join(" and ")}</dd>
        </div>
        <div>
          <dt>Then</dt>
          <dd>
            <ActionSummary actions={rule.actions} steps={project.logic.exodusSteps ?? []} />
          </dd>
        </div>
      </dl>
      <details className="tech" onClick={(e) => e.stopPropagation()}>
        <summary>Technical details</summary>
        <p className="hint">
          id <code>{rule.id}</code> · trigger <code>{rule.when.kind}</code>
          {rule.conditions.length > 0 && <> · conditions {rule.conditions.map((c, i) => <code key={i}>{c.kind} </code>)}</>}
          {rule.actions.length > 0 && <> · actions {rule.actions.map((a, i) => <code key={i}>{a.kind} </code>)}</>}
        </p>
      </details>
    </li>
  );
}

function RulesList(): JSX.Element {
  const project = useEditor((s) => s.project);
  const addRule = useEditor((s) => s.addRule);
  const rules = project?.logic.rules ?? [];
  return (
    <section className="panel mission-section">
      <div className="panel-head">
        <h2>Rules</h2>
        <button type="button" className="small" onClick={addRule}>
          + Rule
        </button>
      </div>
      <p className="hint">
        A rule runs its <strong>Then</strong> actions the moment its <strong>When</strong> becomes true and its <strong>If</strong> conditions
        hold. Select one to edit it in the column on the right.
      </p>
      {rules.length === 0 && <p className="hint">No rules yet. Rules cover what the clock cannot: arrival in a zone, a wave wiped out, a system dropping below a threshold.</p>}
      <ul className="card-list" aria-label="Rules">
        {rules.map((rule) => (
          <RuleCard key={rule.id} id={rule.id} />
        ))}
      </ul>
    </section>
  );
}

function GmControls(): JSX.Element {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.logicSelection);
  const selectLogic = useEditor((s) => s.selectLogic);
  const addGmButton = useEditor((s) => s.addGmButton);
  const buttons = project?.logic.gmButtons ?? [];
  return (
    <section className="panel mission-section">
      <div className="panel-head">
        <h2>GM controls</h2>
        <button type="button" className="small" onClick={addGmButton}>
          + GM control
        </button>
      </div>
      <p className="hint">Buttons on EmptyEpsilon's own GM console. The game master presses one; its actions run. They are a source of events, not a condition — which is why they are listed apart from the rules.</p>
      {buttons.length === 0 && <p className="hint">No GM controls yet.</p>}
      <ul className="card-list" aria-label="GM controls">
        {buttons.map((button) => {
          const selected = selection?.kind === "gmButton" && selection.id === button.id;
          return (
            <li key={button.id} className={`rule-card${selected ? " selected" : ""}`} onClick={() => selectLogic({ kind: "gmButton", id: button.id })}>
              <div className="card-head">
                <button
                  type="button"
                  className="row-link card-title"
                  aria-pressed={selected}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectLogic({ kind: "gmButton", id: button.id });
                  }}
                >
                  <strong>{button.label || button.id}</strong>
                </button>
                <span className="badge">GM presses</span>
              </div>
              <dl className="www">
                <div>
                  <dt>Then</dt>
                  <dd>
                    <ActionSummary actions={button.actions} steps={project?.logic.exodusSteps ?? []} />
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TimedEvents(): JSX.Element {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.logicSelection);
  const selectLogic = useEditor((s) => s.selectLogic);
  const beats = [...(project?.logic.beats ?? [])].sort((a, b) => a.at - b.at);
  return (
    <>
      <Timeline />
      <section className="panel mission-section">
        <h2>Timed events in order</h2>
        <p className="hint">The same events as the lane above, as a list: select one to edit it. Being earlier does not make an event cause a later one.</p>
        <ul className="card-list" aria-label="Timed events">
          {beats.map((beat) => {
            const selected = selection?.kind === "beat" && selection.id === beat.id;
            return (
              <li key={beat.id} className={`rule-card${selected ? " selected" : ""}`} onClick={() => selectLogic({ kind: "beat", id: beat.id })}>
                <div className="card-head">
                  <button
                    type="button"
                    className="row-link card-title"
                    aria-pressed={selected}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectLogic({ kind: "beat", id: beat.id });
                    }}
                  >
                    <strong>{beat.label || beat.id}</strong>
                  </button>
                  <span className="badge beat">T+{beat.at}s</span>
                </div>
                <dl className="www">
                  <div>
                    <dt>Then</dt>
                    <dd>
                      <ActionSummary actions={beat.actions} steps={project?.logic.exodusSteps ?? []} />
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

function ValueEditor({ value, onChange, label }: { value: EEVariableValue; onChange: (v: EEVariableValue) => void; label: string }): JSX.Element {
  const kind = typeof value === "boolean" ? "flag" : typeof value === "number" ? "number" : "text";
  return (
    <span className="value-editor">
      <select
        aria-label={`${label}: type`}
        value={kind}
        onChange={(e) => onChange(e.target.value === "number" ? 0 : e.target.value === "flag" ? false : "")}
      >
        <option value="number">number</option>
        <option value="text">text</option>
        <option value="flag">flag</option>
      </select>
      {kind === "number" ? (
        <NumberInput label={label} value={value as number} onChange={(n) => n !== null && onChange(n)} />
      ) : kind === "flag" ? (
        <label className="inline">
          <input type="checkbox" aria-label={label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {value === true ? "true" : "false"}
        </label>
      ) : (
        <input aria-label={label} value={value as string} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      )}
    </span>
  );
}

function UseList({ uses, empty }: { uses: VariableInfo["writers"]; empty: string }): JSX.Element {
  const openReference = useEditor((s) => s.openReference);
  if (uses.length === 0) return <span className="muted">{empty}</span>;
  return (
    <>
      {uses.map((use, i) => (
        <span key={i}>
          {i > 0 && ", "}
          <button type="button" className="row-link" title={`${use.how} — open`} onClick={() => openReference(use.owner)}>
            {LOGIC_WORDS[use.owner.kind]}: {use.owner.label}
          </button>
        </span>
      ))}
    </>
  );
}

function VariablesPanel(): JSX.Element {
  const project = useEditor((s) => s.project);
  const setVariables = useEditor((s) => s.setVariables);
  const focusObject = useEditor((s) => s.focusObject);
  const setView = useEditor((s) => s.setView);
  const infos = useMemo(() => (project === null ? [] : variableInfos(project)), [project]);
  if (project === null) return <section className="panel" />;
  const scenario = infos.filter((v) => v.scope === "scenario");
  const objectVars = infos.filter((v) => v.scope === "object");
  const declared = project.logic.variables;
  const taken = new Set(scenario.map((v) => v.name));
  const freshName = (): string => {
    let n = declared.length + 1;
    while (taken.has(`variable_${n}`)) n += 1;
    return `variable_${n}`;
  };

  return (
    <section className="panel mission-section">
      <div className="panel-head">
        <h2>Variables</h2>
        <button type="button" className="small" onClick={() => setVariables([...declared, { name: freshName(), initial: 0 }])}>
          + Variable
        </button>
      </div>
      <p className="hint">
        Values the mission remembers. Rules and conditions read them; actions set them. A variable is declared here with its starting value; an
        object's own variables are declared on the object, in the Map.
      </p>
      {scenario.length === 0 && <p className="hint">No scenario variables yet.</p>}
      {scenario.length > 0 && (
        <table className="var-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Starts as</th>
              <th>Set by</th>
              <th>Read by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {scenario.map((v) => {
              const index = declared.findIndex((d) => d.name === v.name);
              const inUse = v.writers.length + v.readers.length > 0;
              return (
                <tr key={`${v.scope}:${v.name}`} className={v.declared ? "" : "undeclared"}>
                  <td>
                    {v.declared ? (
                      <input
                        aria-label={`Variable ${v.name}: name`}
                        value={v.name}
                        disabled={inUse}
                        title={inUse ? "A name that rules or actions use cannot be renamed here: it would break them." : undefined}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => {
                          const name = e.target.value;
                          if (name.trim() === "" || taken.has(name)) return;
                          setVariables(declared.map((d, i) => (i === index ? { ...d, name } : d)));
                        }}
                      />
                    ) : (
                      <code>{v.name}</code>
                    )}
                  </td>
                  <td>
                    {v.declared ? (
                      <ValueEditor
                        label={`Variable ${v.name}: starting value`}
                        value={v.initial ?? 0}
                        onChange={(initial) => setVariables(declared.map((d, i) => (i === index ? { ...d, initial } : d)))}
                      />
                    ) : (
                      <span className="warn-line">used but not declared</span>
                    )}
                  </td>
                  <td>
                    <UseList uses={v.writers} empty="nothing sets it" />
                  </td>
                  <td>
                    <UseList uses={v.readers} empty="nothing reads it" />
                  </td>
                  <td>
                    {v.declared ? (
                      <button type="button" className="small danger" aria-label={`Delete variable ${v.name}`} onClick={() => setVariables(declared.filter((_, i) => i !== index))}>
                        <span aria-hidden="true">×</span>
                      </button>
                    ) : (
                      <button type="button" className="small" aria-label={`Declare variable ${v.name}`} onClick={() => setVariables([...declared, { name: v.name, initial: v.suggestedInitial }])}>
                        Declare
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 className="scene-subhead">Object variables</h3>
      {objectVars.length === 0 ? (
        <p className="hint">No object declares a variable. Add one to an object in the Map (Story → Variables).</p>
      ) : (
        <table className="var-table">
          <thead>
            <tr>
              <th>Object</th>
              <th>Name</th>
              <th>Starts as</th>
              <th>Set by</th>
              <th>Read by</th>
            </tr>
          </thead>
          <tbody>
            {objectVars.map((v) => (
              <tr key={`${v.objectId}:${v.name}`} className={v.declared ? "" : "undeclared"}>
                <td>
                  {v.objectId !== null && (
                    <button
                      type="button"
                      className="row-link"
                      title="Show it on the Map"
                      onClick={() => {
                        focusObject(v.objectId as string);
                        setView("map");
                      }}
                    >
                      {v.objectId}
                    </button>
                  )}
                </td>
                <td>
                  <code>{v.name}</code>
                </td>
                <td>{v.declared ? String(v.initial) : <span className="warn-line">not declared on that object</span>}</td>
                <td>
                  <UseList uses={v.writers} empty="nothing sets it" />
                </td>
                <td>
                  <UseList uses={v.readers} empty="nothing reads it" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Diagram
// ---------------------------------------------------------------------------

function DiagramPanel(): JSX.Element {
  const project = useEditor((s) => s.project) as EEProject | null;
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const model = useMemo(() => (project === null ? { nodes: [], edges: [] } : buildDiagram(project)), [project]);
  const source = useMemo(() => (project === null ? "" : toMermaid(project)), [project]);
  const timed = model.nodes.filter((n) => n.kind === "timed").length;
  return (
    <section className="panel mission-section">
      <div className="panel-head">
        <h2>Diagram</h2>
        {!shown ? (
          <button type="button" className="primary small" onClick={() => setShown(true)}>
            Show diagram
          </button>
        ) : (
          <button type="button" className="small" aria-expanded={true} onClick={() => setShown(false)}>
            Hide diagram
          </button>
        )}
      </div>
      <p className="hint">
        Read-only, drawn from the project every time: a link appears only where the project says so — an action that spawns a group, a condition
        that waits for a group to be wiped out, a variable one part sets and another reads, an object one part destroys and another waits for.
        Timed events are listed by time and are not linked to each other.
      </p>
      {model.edges.length === 0 ? (
        <p className="hint">Nothing is connected yet{timed > 0 ? ` (${timed} timed event${timed === 1 ? "" : "s"} stand alone)` : ""}.</p>
      ) : (
        <>
          <h3 className="scene-subhead">Connections ({model.edges.length})</h3>
          <ul className="connection-list" aria-label="Connections">
            {model.edges.map((edge, i) => (
              <li key={i}>{describeEdge(model, edge)}</li>
            ))}
          </ul>
        </>
      )}
      {shown && (
        <Suspense fallback={<p className="hint" role="status">Loading the diagram…</p>}>
          <DiagramView model={model} />
        </Suspense>
      )}
      <details className="mermaid-details">
        <summary>Mermaid source</summary>
        <p className="hint">The same nodes and links as text, for any Mermaid renderer.</p>
        <button
          type="button"
          className="small"
          onClick={() => {
            void navigator.clipboard.writeText(source).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy Mermaid source"}
        </button>
        <pre className="mermaid-source">{source}</pre>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Campaign: what the running game keeps (ADR-0058)
// ---------------------------------------------------------------------------

function CampaignPanel(): JSX.Element | null {
  const project = useEditor((s) => s.project);
  const setPersistence = useEditor((s) => s.setCampaignPersistence);
  if (project === null) return null;
  const on = project.campaign.persistence;
  const start = project.map.startSector === null ? null : (project.map.sectors.find((s) => s.id === project.map.startSector)?.label ?? project.map.startSector);
  return (
    <section className="panel campaign-panel" aria-label="Campaign saves">
      <h2>Campaign saves</h2>
      <p className="hint">
        Three different things are called “saved”, and this page keeps them apart. <strong>The project</strong> is what you edit here: the Save button writes it to your projects folder.
        <strong> A checkpoint</strong> is what the <em>running game</em> writes into EmptyEpsilon&apos;s own store (<code>scriptstorage.json</code> in EmptyEpsilon&apos;s folder) — Forge does not need to be open, and EXODUS plays no part.
        <strong> The starting sector</strong> is where a new campaign begins; it is not the sector open in this editor.
      </p>
      <label className="logic-field inline">
        <input type="checkbox" checked={on} onChange={(e) => setPersistence(e.target.checked)} />
        <span>Save the campaign (checkpoints) and keep every sector as it was left</span>
      </label>
      <p className="hint">
        Starting sector: <strong>{start ?? "none chosen"}</strong>
        {start === null ? " — campaign saves need one (use the flag on a sector in Scene)." : "."}
        {" "}Open in the editor right now is a separate thing and is never saved with the game.
      </p>
      {!on && (
        <p className="hint">
          Off: a sector is rebuilt from its initial settings every time the ship comes back, and nothing is kept when EmptyEpsilon closes. The generated Lua is then exactly what it was before this option existed.
        </p>
      )}
      {on && (
        <>
          <h3>Playing</h3>
          <ul className="plain">
            <li><strong>New campaign / Resume campaign:</strong> a setting EmptyEpsilon shows before the scenario starts — <em>Campaign</em>: <em>Resume</em> (the default: resume the latest saved campaign of this project; if there is none yet, the first one starts and the crew is told so), <em>New</em> (a new campaign; a saved one is never overwritten) or <em>Off</em> (play without saving).</li>
            <li><strong>Save checkpoint:</strong> the <em>Save checkpoint</em> button on the Engineering station and on the GM console, and the <em>Save checkpoint</em> action for story moments. A checkpoint is also requested when a new campaign starts and every time a Change sector completes. The message says the checkpoint was <em>sent to the save file</em>: EmptyEpsilon does not tell the game whether it reached the disk.</li>
            <li><strong>A save that cannot be resumed is never replaced silently.</strong> Nothing of the campaign starts: no object, no timer or reward runs. One service ship, <em>NO CAMPAIGN</em>, lets the crew read why — <em>damaged</em>, or made by a <em>different version or structure</em> of the scenario — and choose, on its Engineering station or from the GM console: <em>Start a NEW campaign</em> or <em>Play without saving</em>. They can also end the game, choose the scenario again, set <em>Campaign</em> to <em>New</em> and start. The old save is kept. If only the newest checkpoint is unreadable, the one before it is used and the message names it.</li>
          </ul>
          <h3>What a checkpoint keeps</h3>
          <p className="hint">
            The active sector and every visited one, frozen while the ship is elsewhere (the sector&apos;s own clock does not run); which groups have appeared; for each object: alive or destroyed (a destroyed one is never rebuilt, so nothing it would have triggered repeats),
            its position and heading, and — where EmptyEpsilon allows it — hull, shields, energy, system health and heat, the engineer&apos;s power and coolant sliders, the weapon store, the scan-probe store and jump charge; the last order and the dialogue a Forge action gave it; variables, object variables, which rules have fired and which timed events have run; the campaign clock.
            The player ship and the Shared objects are in the campaign part.
          </p>
          <h3>What it does not keep</h3>
          <p className="hint">
            What actually happens after EmptyEpsilon is closed and the campaign is resumed (read from both engines):
          </p>
          <ul className="plain">
            <li><strong>Speed:</strong> the ship comes back at its saved position and heading, <em>at rest</em>. A course in progress and the impulse setting are lost.</li>
            <li><strong>Tubes and missiles:</strong> the store is kept as it was at the checkpoint. A missile already <em>loaded in a tube</em> is not in the store and is not kept: it is lost, and every tube comes back empty with its reload progress gone.</li>
            <li><strong>Mines, probes and missiles already launched</strong> are gone. The <em>store</em> of scan probes comes back; a probe already flying does not.</li>
            <li><strong>Docking:</strong> the ship comes back where it was, <em>not docked</em>. The crew has to dock again.</li>
            <li><strong>Scans:</strong> an object comes back <em>unscanned</em>, even one the crew had scanned, and a scan in progress is lost. The same happens to the objects of a sector when the ship comes back to it.</li>
            <li><strong>Crew settings</strong> that no Forge action set — alert level, shields up or down, the beam frequency, the selected target — go back to the ship&apos;s defaults after a restart. Within one run, and across a Change sector, it is the same ship and it keeps them.</li>
            <li><strong>Objects made outside the map</strong> (by a GM, a script or any other tool) are gone.</li>
            <li><strong>EXODUS:</strong> its state and steps are not part of a checkpoint. The restored ship is a <em>new</em> ship that is given the saved state.</li>
          </ul>
          <p className="hint">This is a checkpoint of the campaign, not a full save of the ship or of the world.</p>
          <h3>Limits you should know</h3>
          <p className="hint">
            <strong>A checkpoint is requested, not confirmed.</strong> EmptyEpsilon does not tell the game whether a write reached the disk (a read-only file looks exactly like a successful save), and reading a checkpoint back may be answered from memory. So the game says
            &ldquo;sent to the save file&rdquo;, never &ldquo;saved&rdquo;. The proof is the next start: the campaign is there, or the message says why not.
          </p>
          <p className="hint">
            <strong>One file.</strong> A checkpoint has two slots, but they live in the same file (<code>scriptstorage.json</code>): that protects against an interrupted save, not against a damaged or deleted file. If the <em>whole</em> file is damaged, EmptyEpsilon hands the game an empty file, so the game cannot tell it from a first start, and the next write replaces
            it — together with every other tool&apos;s keys. Resume&apos;s block does not protect against that case. The optional backup utility that comes with Forge (<em>forge-save-backup.ps1</em>, see the guide) copies the file on request while EmptyEpsilon is closed; it protects only up to its last copy.
          </p>
          <h3>Timed events and rules by sector</h3>
          <p className="hint">
            A timed event or a rule can belong to a sector (its Inspector): it then runs only while that sector is active, on that sector&apos;s own clock, and its progress is kept with the sector. Without a sector it runs on the campaign clock, as before. This is never guessed from a <em>Current sector is</em> condition.
          </p>
        </>
      )}
    </section>
  );
}
