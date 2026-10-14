import { useEffect, useState } from "react";
import {
  addCondition,
  emptyPredicate,
  referencesToNode,
  removeCondition,
  writeRecord,
  type LogicOwner,
  type LogicPath,
} from "@forge/core/editor";
import type { EEDialogue, EEDialogueNode, EEPredicate, EEReplyTarget } from "@forge/contracts";
import { useEditor } from "../store/editor.js";
import { ActionList } from "./ActionList.js";
import { LogicRecordEditor } from "./LogicRecord.js";

/**
 * One node of a conversation: its line, and the replies it offers
 * (ADR-0039).
 *
 * A reply's conditions and actions are edited with the very same
 * components a rule uses, because a `dialogueReply` is a `LogicOwner` like
 * any other. That is the whole reason the owner type grew a case instead
 * of this panel growing its own editors.
 */
export function DialogueNodeEditor({
  dialogue,
  node,
}: {
  dialogue: EEDialogue;
  node: EEDialogueNode;
}): JSX.Element {
  const updateDialogue = useEditor((s) => s.updateDialogue);
  const updateNode = useEditor((s) => s.updateNode);
  const renameNode = useEditor((s) => s.renameNode);
  const deleteNode = useEditor((s) => s.deleteNode);
  const addReply = useEditor((s) => s.addReply);
  const updateReply = useEditor((s) => s.updateReply);
  const removeReply = useEditor((s) => s.removeReply);
  const applyLogic = useEditor((s) => s.applyLogic);

  const [draftId, setDraftId] = useState(node.id);
  useEffect(() => setDraftId(node.id), [node.id]);

  const isEntry = dialogue.entry === node.id;
  const reachedFrom = referencesToNode(dialogue, node.id);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          Node <span className="muted">{dialogue.label}</span>
        </h2>
        <button
          type="button"
          className="small danger"
          onClick={() => deleteNode(dialogue.id, node.id)}
        >
          Delete
        </button>
      </div>

      <label className="logic-field">
        <span>Id</span>
        <input
          value={draftId}
          onChange={(e) => setDraftId(e.target.value)}
          onBlur={() => renameNode(dialogue.id, node.id, draftId)}
          onKeyDown={(e) => {
            if (e.key === "Enter") renameNode(dialogue.id, node.id, draftId);
            if (e.key === "Escape") setDraftId(node.id);
          }}
        />
      </label>

      <label className="logic-field">
        <span>Says</span>
        <textarea
          rows={3}
          value={node.text}
          placeholder="What the object says here"
          onChange={(e) => updateNode(dialogue.id, node.id, { text: e.target.value })}
        />
      </label>

      <label className="inline">
        <input
          type="checkbox"
          checked={isEntry}
          disabled={isEntry}
          onChange={() => updateDialogue(dialogue.id, { entry: node.id })}
        />
        Opens the conversation
      </label>
      <p className="hint">
        {isEntry
          ? "This is what the crew hears when they hail."
          : reachedFrom.length === 0
            ? "Nothing reaches this node yet — the build will warn about it."
            : `Reached from ${reachedFrom.join(", ")}.`}
      </p>

      <h3>Replies</h3>
      {node.replies.length === 0 && (
        <p className="hint">
          None — the crew reads the line and closes the window. That is how a conversation
          ends; there is no separate "hang up".
        </p>
      )}

      {node.replies.map((reply, index) => {
        const owner: LogicOwner = {
          kind: "dialogueReply",
          id: dialogue.id,
          nodeId: node.id,
          index,
        };
        return (
          <div className="reply" key={index}>
            <div className="reply-head">
              <input
                value={reply.text}
                onChange={(e) =>
                  updateReply(dialogue.id, node.id, index, { text: e.target.value })
                }
              />
              <button aria-label={`Remove reply ${index + 1}`}
                type="button"
                className="small danger"
                onClick={() => removeReply(dialogue.id, node.id, index)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <label className="logic-field">
              <span>Leads to</span>
              <select
                value={
                  reply.target.kind === "node" ? `node:${reply.target.nodeId}` : reply.target.kind
                }
                onChange={(e) => {
                  const chosen = e.target.value;
                  const target: EEReplyTarget = chosen.startsWith("node:")
                    ? { kind: "node", nodeId: chosen.slice("node:".length) }
                    : chosen === "gm"
                      ? { kind: "gm" }
                      : { kind: "services" };
                  updateReply(dialogue.id, node.id, index, { target });
                }}
              >
                {dialogue.nodes.map((candidate) => (
                  <option key={candidate.id} value={`node:${candidate.id}`}>
                    {candidate.id}
                  </option>
                ))}
                <option value="gm">the GM (chat)</option>
                <option value="services">EE's station services</option>
              </select>
            </label>
            {reply.target.kind === "services" && (
              <p className="hint">
                Hands off to EmptyEpsilon's own station menu — restocking, repairs, supply
                drops, reinforcements. Only meaningful on a SpaceStation, and the crew cannot
                come back to this conversation from there.
              </p>
            )}

            <h4>Offered only when</h4>
            {reply.conditions.length === 0 && <p className="hint">Always offered.</p>}
            {reply.conditions.map((condition, ci) => {
              const path: LogicPath = { owner, target: { slot: "condition", index: ci } };
              return (
                <div className="condition" key={ci}>
                  <LogicRecordEditor
                    record={condition}
                    path={path}
                    onChange={(next) =>
                      applyLogic((logic) => writeRecord(logic, path, next as EEPredicate))
                    }
                  />
                  <button aria-label={`Remove condition ${ci + 1}`}
                    type="button"
                    className="small danger"
                    onClick={() => applyLogic((logic) => removeCondition(logic, owner, ci))}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="small"
              onClick={() =>
                applyLogic((logic) => addCondition(logic, owner, emptyPredicate("always")))
              }
            >
              + Condition
            </button>

            <h4>When picked</h4>
            <ActionList owner={owner} actions={reply.actions} />
          </div>
        );
      })}

      <button type="button" onClick={() => addReply(dialogue.id, node.id)}>
        + Reply
      </button>
    </section>
  );
}
