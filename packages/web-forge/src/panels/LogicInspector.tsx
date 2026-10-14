import {
  addCondition,
  emptyPredicate,
  removeCondition,
  writeRecord,
  type LogicPath,
} from "@forge/core/editor";
import type { EEPredicate } from "@forge/contracts";
import { useEditor } from "../store/editor.js";
import { ActionList } from "./ActionList.js";
import { DialogueNodeEditor } from "./DialogueNodeEditor.js";
import { LogicRecordEditor } from "./LogicRecord.js";
import { NumberInput } from "../ui/NumberInput.js";

/**
 * Editor for whatever the timeline or the rules table has selected.
 *
 * One panel for beats, rules and GM buttons, because all three are the
 * same sentence with different subjects: *when* something is true, *then*
 * these actions run. A beat's "when" is the clock, a GM button's is a
 * person pressing it, and a rule's is a predicate the author writes.
 */
export function LogicInspector(): JSX.Element {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.logicSelection);
  const updateBeat = useEditor((s) => s.updateBeat);
  const deleteBeat = useEditor((s) => s.deleteBeat);
  const updateRule = useEditor((s) => s.updateRule);
  const deleteRule = useEditor((s) => s.deleteRule);
  const updateGmButton = useEditor((s) => s.updateGmButton);
  const deleteGmButton = useEditor((s) => s.deleteGmButton);
  const applyLogic = useEditor((s) => s.applyLogic);

  if (project === null || selection === null) {
    return (
      <section className="panel">
        <h2>Inspector</h2>
        <p className="hint">Pick a rule, a timed event or a GM control to edit it here.</p>
      </section>
    );
  }

  if (selection.kind === "dialogueNode") {
    const dialogue = project.logic.dialogues.find((d) => d.id === selection.id);
    const node = dialogue?.nodes.find((n) => n.id === selection.nodeId);
    if (dialogue === undefined || node === undefined) return <section className="panel" />;
    return <DialogueNodeEditor dialogue={dialogue} node={node} />;
  }

  if (selection.kind === "beat") {
    const beat = project.logic.beats.find((b) => b.id === selection.id);
    if (beat === undefined) return <section className="panel" />;
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>
            Timed event <span className="muted">{beat.id}</span>
          </h2>
          <button type="button" className="small danger" onClick={() => deleteBeat(beat.id)}>
            Delete
          </button>
        </div>

        <label className="logic-field">
          <span>Label</span>
          <input
            value={beat.label}
            onChange={(e) => updateBeat(beat.id, { label: e.target.value })}
          />
        </label>
        <label className="logic-field">
          <span>Runs at (s)</span>
          <NumberInput
            value={beat.at}
            min={0}
            step={5}
            onChange={(at) => at !== null && updateBeat(beat.id, { at })}
          />
        </label>

        <label className="logic-field">
          <span>Belongs to</span>
          <select
            aria-label="Sector scope"
            value={beat.sector ?? ""}
            onChange={(e) => updateBeat(beat.id, { sector: e.target.value === "" ? null : e.target.value })}
          >
            <option value="">The whole game (campaign clock)</option>
            {project.map.sectors.map((sector) => (
              <option key={sector.id} value={sector.id}>
                Only in {sector.label} (that sector&apos;s own clock)
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          A sector-scoped one runs only while its sector is active and its time stops when the ship is away. Needs Campaign saves (Mission → Campaign).
        </p>
        <ActionList owner={{ kind: "beat", id: beat.id }} actions={beat.actions} />
      </section>
    );
  }

  if (selection.kind === "gmButton") {
    const button = project.logic.gmButtons.find((b) => b.id === selection.id);
    if (button === undefined) return <section className="panel" />;
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>
            GM control <span className="muted">{button.id}</span>
          </h2>
          <button type="button" className="small danger" onClick={() => deleteGmButton(button.id)}>
            Delete
          </button>
        </div>
        <label className="logic-field">
          <span>Label</span>
          <input
            value={button.label}
            onChange={(e) => updateGmButton(button.id, { label: e.target.value })}
          />
        </label>
        <ActionList owner={{ kind: "gmButton", id: button.id }} actions={button.actions} />
      </section>
    );
  }

  const rule = project.logic.rules.find((r) => r.id === selection.id);
  if (rule === undefined) return <section className="panel" />;
  const whenPath: LogicPath = { owner: { kind: "rule", id: rule.id }, target: { slot: "when" } };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          Rule <span className="muted">{rule.id}</span>
        </h2>
        <button type="button" className="small danger" onClick={() => deleteRule(rule.id)}>
          Delete
        </button>
      </div>

      <label className="logic-field">
        <span>Label</span>
        <input value={rule.label} onChange={(e) => updateRule(rule.id, { label: e.target.value })} />
      </label>

      <label className="logic-field inline">
        <input
          type="checkbox"
          checked={rule.once}
          onChange={(e) => updateRule(rule.id, { once: e.target.checked })}
        />
        <span>Run once</span>
      </label>
      <p className="hint">
        A rule runs on the rising edge — the moment its test first becomes
        true. Unchecked, it re-arms and can run again the next time it
        becomes true.
      </p>

      <label className="logic-field">
        <span>Belongs to</span>
        <select
          aria-label="Sector scope"
          value={rule.sector ?? ""}
          onChange={(e) => updateRule(rule.id, { sector: e.target.value === "" ? null : e.target.value })}
        >
          <option value="">The whole game (campaign clock)</option>
          {project.map.sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              Only in {sector.label} (that sector&apos;s own clock)
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        A sector-scoped one runs only while its sector is active and its time stops when the ship is away. Needs Campaign saves (Mission → Campaign).
      </p>

      <h3>When</h3>
      <LogicRecordEditor
        label="When"
        record={rule.when}
        path={whenPath}
        onChange={(next) => applyLogic((logic) => writeRecord(logic, whenPath, next))}
      />

      <div className="action-head">
        <h3>If</h3>
        <button
          type="button"
          className="small"
          onClick={() => applyLogic((logic) => addCondition(logic, { kind: "rule", id: rule.id }, emptyPredicate("always")))}
        >
          + Condition
        </button>
      </div>
      {rule.conditions.length === 0 && <p className="hint">No extra condition — the trigger is enough.</p>}
      {rule.conditions.map((condition: EEPredicate, index: number) => {
        const path: LogicPath = {
          owner: { kind: "rule", id: rule.id },
          target: { slot: "condition", index },
        };
        return (
          <div className="guard" key={index}>
            <div className="action-row">
              <span className="muted">AND</span>
              <button aria-label={`Remove guard ${index + 1}`}
                type="button"
                className="small danger"
                onClick={() => applyLogic((logic) => removeCondition(logic, { kind: "rule", id: rule.id }, index))}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <LogicRecordEditor
              label={`Condition ${index + 1}`}
              record={condition}
              path={path}
              onChange={(next) => applyLogic((logic) => writeRecord(logic, path, next))}
            />
          </div>
        );
      })}

      <ActionList owner={{ kind: "rule", id: rule.id }} actions={rule.actions} />
    </section>
  );
}
