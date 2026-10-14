import {
  addAction,
  describeAction,
  emptyAction,
  moveAction,
  removeAction,
  writeRecord,
  type LogicOwner,
} from "@forge/core/editor";
import type { EEAction } from "@forge/contracts";
import { useState } from "react";
import { useEditor } from "../store/editor.js";
import { LogicRecordEditor } from "./LogicRecord.js";

/**
 * The THEN half: what a beat, rule or GM button does when it fires.
 *
 * Order is meaning — spawning a wave and then ordering it to attack is not
 * the same script as the reverse — so the list is explicitly ordered and
 * movable, not a set.
 */
export function ActionList({
  owner,
  actions,
  title = "Then",
  vanillaOnly = false,
}: {
  owner: LogicOwner;
  actions: readonly EEAction[];
  title?: string;
  /** Plain-EE actions only: the lists inside an EXODUS step cannot hold EXODUS actions. */
  vanillaOnly?: boolean;
}): JSX.Element {
  const project = useEditor((s) => s.project);
  const applyLogic = useEditor((s) => s.applyLogic);
  // The page-level lists share one "which row is open" slot in the store.
  // A list nested inside an action's own form keeps its own, or opening a
  // row in it would open (or close) the row of the list that contains it.
  const storeOpen = useEditor((s) => s.openActionIndex);
  const storeSetOpen = useEditor((s) => s.setOpenActionIndex);
  const [localOpen, setLocalOpen] = useState<number | null>(null);
  const nested = owner.kind === "exodusStep";
  const openIndex = nested ? localOpen : storeOpen;
  const setOpenIndex = nested ? setLocalOpen : storeSetOpen;

  const defaults = {
    objectId: project?.map.groups.flatMap((g) => g.objects)[0]?.id,
    groupId: project?.map.groups[0]?.id,
  };

  return (
    <div className="action-list">
      <div className="action-head">
        <h3>{title}</h3>
        <button
          type="button"
          className="small"
          onClick={() => {
            applyLogic((logic) => addAction(logic, owner, emptyAction("global_message", defaults)));
            setOpenIndex(actions.length);
          }}
        >
          + Action
        </button>
      </div>

      {actions.length === 0 && <p className="hint">Nothing happens yet.</p>}

      <ol className="action-rows">
        {actions.map((action, index) => {
          const path = { owner, target: { slot: "action" as const, index } };
          const open = openIndex === index;
          return (
            <li key={index} className={open ? "open" : ""}>
              <div className="action-row">
                <button
                  type="button"
                  className="action-summary"
                  onClick={() => setOpenIndex(open ? null : index)}
                >
                  {describeAction(action)}
                </button>
                <button aria-label={`Move action ${index + 1} up`}
                  type="button"
                  className="small"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => applyLogic((logic) => moveAction(logic, owner, index, -1))}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button aria-label={`Move action ${index + 1} down`}
                  type="button"
                  className="small"
                  title="Move down"
                  disabled={index === actions.length - 1}
                  onClick={() => applyLogic((logic) => moveAction(logic, owner, index, 1))}
                >
                  <span aria-hidden="true">↓</span>
                </button>
                <button aria-label={`Remove action ${index + 1}`}
                  type="button"
                  className="small danger"
                  title="Remove"
                  onClick={() => {
                    applyLogic((logic) => removeAction(logic, owner, index));
                    setOpenIndex(null);
                  }}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>

              {open && (
                <LogicRecordEditor
                  vanillaOnly={vanillaOnly}
                  record={action}
                  path={path}
                  onChange={(next) => applyLogic((logic) => writeRecord(logic, path, next))}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
