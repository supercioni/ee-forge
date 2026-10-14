import {
  ALTERNATIVE_CHOICES,
  addStep,
  choiceOf,
  nextStepId,
  patchAlternative,
  removeStep,
  setStepAnswerWithin,
  setStepChoice,
  setStepEssential,
  type AlternativeChoice,
} from "@forge/core/editor";
import { useEditor } from "../store/editor.js";
import { NumberInput } from "../ui/NumberInput.js";
import { ActionList } from "./ActionList.js";

/**
 * What the crew gets when EXODUS is not there (ADR-0049).
 *
 * An EXODUS action points at a *step*; the step records the author's
 * decision. "Not decided yet" is a real state — a vanilla export refuses it
 * and says which actions are waiting — and it is never turned into "nothing"
 * on the author's behalf.
 */
export function ExodusStepField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (stepId: string | null) => void;
}): JSX.Element {
  const logic = useEditor((s) => s.project?.logic);
  const applyLogic = useEditor((s) => s.applyLogic);
  const steps = logic?.exodusSteps ?? [];
  const stepId = typeof value === "string" ? value : null;
  const step = steps.find((candidate) => candidate.id === stepId) ?? null;
  const alternative = step?.alternative ?? null;
  const choice = choiceOf(alternative);

  return (
    <div className="exodus-step">
      <div className="ref-field">
        <select
          aria-label="Without EXODUS step"
          value={stepId ?? ""}
          onChange={(e) => {
            if (e.target.value === "__new") {
              if (logic === undefined) return;
              const id = nextStepId(logic, "step");
              applyLogic((l) => addStep(l, id));
              onChange(id);
            } else {
              onChange(e.target.value === "" ? null : e.target.value);
            }
          }}
        >
          <option value="">(not decided yet)</option>
          {steps.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.id}
            </option>
          ))}
          <option value="__new">+ new step…</option>
        </select>
        {stepId !== null && step === null && <span className="error"> “{stepId}” does not exist</span>}
      </div>

      {step !== null && (
        <div className="exodus-step-body">
          <label className="logic-field">
            <span>Essential to the mission</span>
            <input
              type="checkbox"
              checked={step.essential}
              onChange={(e) => applyLogic((l) => setStepEssential(l, step.id, e.target.checked))}
            />
          </label>
          {step.essential && (
            <p className="hint">The mission cannot move on without this. It needs a real alternative: “at once”, “after a delay” or “GM presses a button”, with at least one action.</p>
          )}

          <label className="logic-field">
            <span>Without EXODUS</span>
            <select
              aria-label="Alternative"
              value={choice}
              onChange={(e) => applyLogic((l) => setStepChoice(l, step.id, e.target.value as AlternativeChoice))}
            >
              {ALTERNATIVE_CHOICES.map((option) => (
                <option key={option.value} value={option.value} title={option.hint}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{ALTERNATIVE_CHOICES.find((o) => o.value === choice)?.hint}</p>

          {alternative?.kind === "wait" && (
            <label className="logic-field">
              <span>Delay (s)</span>
              <NumberInput
                value={alternative.seconds}
                nullable={false}
                min={1}
                step={1}
                onChange={(seconds) => {
                  if (typeof seconds === "number") applyLogic((l) => patchAlternative(l, step.id, { seconds }));
                }}
              />
            </label>
          )}
          {alternative?.kind === "gm" && (
            <>
              <label className="logic-field">
                <span>Button label</span>
                <input
                  value={alternative.label}
                  onChange={(e) => applyLogic((l) => patchAlternative(l, step.id, { label: e.target.value }))}
                />
              </label>
              <label className="logic-field">
                <span>Message to the GM</span>
                <textarea
                  rows={2}
                  value={alternative.message}
                  onChange={(e) => applyLogic((l) => patchAlternative(l, step.id, { message: e.target.value }))}
                />
              </label>
            </>
          )}

          {alternative !== null && alternative.kind !== "none" && (
            <ActionList
              owner={{ kind: "exodusStep", id: step.id, list: "alternative" }}
              actions={alternative.actions}
              title="Instead"
              vanillaOnly
            />
          )}
          <label className="logic-field">
            <span>Answer within (s)</span>
            <NumberInput
              value={step.answerWithinS}
              nullable
              min={1}
              step={5}
              onChange={(seconds) => applyLogic((l) => setStepAnswerWithin(l, step.id, typeof seconds === "number" ? seconds : null))}
            />
          </label>
          <p className="hint">
            Puzzles only. If EXODUS is running but has not answered this many scenario seconds after the request, the alternative
            starts and a later answer is ignored. Empty = keep waiting while EXODUS is alive. This is not the puzzle's own time limit,
            nor the check that EXODUS is still running (15 s without a heartbeat).
          </p>
          <ActionList
            owner={{ kind: "exodusStep", id: step.id, list: "success" }}
            actions={step.onSuccess}
            title="When it succeeds — once, whoever settles it"
            vanillaOnly
          />
          <p className="hint">
            “Succeeds” depends on the action. A puzzle: EXODUS reported solved or bypassed. Any other EXODUS action (event, lore,
            critical action, encrypted comms, state, chapter): the request was handed to EXODUS, which does <strong>not</strong> confirm
            it did anything — treat it as sent, not done. With the alternative: the alternative ran.
          </p>

          <button
            type="button"
            className="small danger"
            onClick={() => {
              applyLogic((l) => removeStep(l, step.id));
              onChange(null);
            }}
          >
            Delete this step
          </button>
        </div>
      )}
    </div>
  );
}
