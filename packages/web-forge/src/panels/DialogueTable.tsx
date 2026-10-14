import { describeAction, describePredicate, describeReplyTarget } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";

/**
 * The conversations a project defines, and their nodes (ADR-0039).
 *
 * A flat list of nodes rather than an indented tree, because the model is
 * a graph: a node can be reached from several places and every EE comms
 * script loops back to its main menu. An indented view would have to
 * either repeat nodes or lie about the shape.
 */
export function DialogueTable(): JSX.Element {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.logicSelection);
  const selectLogic = useEditor((s) => s.selectLogic);
  const addDialogue = useEditor((s) => s.addDialogue);
  const deleteDialogue = useEditor((s) => s.deleteDialogue);
  const addNode = useEditor((s) => s.addNode);
  const focusObject = useEditor((s) => s.focusObject);
  const setView = useEditor((s) => s.setView);

  if (project === null) return <section className="panel" />;
  const dialogues = project.logic.dialogues;

  // Which objects answer with each dialogue, so an author can see at a
  // glance whether a conversation is wired to anything.
  const speakers = new Map<string, string[]>();
  for (const object of project.map.groups.flatMap((g) => g.objects)) {
    if (!("dialogueId" in object) || object.dialogueId === null) continue;
    speakers.set(object.dialogueId, [...(speakers.get(object.dialogueId) ?? []), object.id]);
  }

  return (
    <section className="panel">
      <h2>
        Dialogues <span className="muted">— what an object says when hailed</span>
      </h2>

      {dialogues.length === 0 && (
        <p className="hint">
          None yet. A dialogue is a graph of nodes: each says a line and offers replies, and a
          reply can jump to another node, run actions, or hand the conversation to the GM.
          Attach one to a ship or station in the Map view.
        </p>
      )}

      {dialogues.map((dialogue) => (
        <div className="dialogue" key={dialogue.id}>
          <div className="dialogue-head">
            <strong>{dialogue.label}</strong>
            <span className="muted">{dialogue.id}</span>
            <span className="muted">
              {speakers.get(dialogue.id) === undefined ? (
                "not attached to anything"
              ) : (
                <>
                  spoken by{" "}
                  {speakers.get(dialogue.id)!.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ", "}
                      <button
                        type="button"
                        className="row-link"
                        title="Show it on the Map"
                        onClick={() => {
                          focusObject(id);
                          setView("map");
                        }}
                      >
                        {id}
                      </button>
                    </span>
                  ))}
                </>
              )}
            </span>
            <button type="button" className="small" aria-label={`+ Node in ${dialogue.label}`} onClick={() => addNode(dialogue.id)}>
              + Node
            </button>
            <button
              type="button"
              className="small danger"
              aria-label={`Delete dialogue ${dialogue.label}`}
              onClick={() => deleteDialogue(dialogue.id)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <ul className="node-list" aria-label={`Nodes of ${dialogue.label}`}>
            {dialogue.nodes.map((node) => {
              const active =
                selection?.kind === "dialogueNode" &&
                selection.id === dialogue.id &&
                selection.nodeId === node.id;
              const open = (nodeId: string): void => selectLogic({ kind: "dialogueNode", id: dialogue.id, nodeId });
              return (
                <li
                  key={node.id}
                  className={`node-card${active ? " selected" : ""}`}
                  onClick={() => open(node.id)}
                >
                  <div className="node-head">
                    <button
                      type="button"
                      className="row-link node-id"
                      aria-pressed={active}
                      onClick={(e) => {
                        e.stopPropagation();
                        open(node.id);
                      }}
                    >
                      {node.id}
                      {dialogue.entry === node.id && <em title="Opens the conversation"> ▸<span className="sr-only"> (opens the conversation)</span></em>}
                    </button>
                    <span className="node-text">
                      {node.text === "" ? <em className="muted">(no line yet)</em> : `“${node.text}”`}
                    </span>
                  </div>
                  {node.replies.length === 0 ? (
                    <p className="muted node-end">The conversation ends here.</p>
                  ) : (
                    <ul className="reply-links" aria-label={`Replies offered at ${node.id}`}>
                      {node.replies.map((reply, i) => {
                        const missing = reply.target.kind === "node" && !dialogue.nodes.some((n) => n.id === (reply.target as { nodeId: string }).nodeId);
                        return (
                          <li key={i}>
                            <span className="reply-text">“{reply.text}”</span>{" "}
                            {reply.target.kind === "node" ? (
                              <button
                                type="button"
                                className="row-link"
                                disabled={missing}
                                title={missing ? "That node does not exist" : `Go to node ${reply.target.nodeId}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  open((reply.target as { nodeId: string }).nodeId);
                                }}
                              >
                                {describeReplyTarget(reply.target)}
                                {missing ? " (missing)" : ""}
                              </button>
                            ) : (
                              <span className="muted">{describeReplyTarget(reply.target)}</span>
                            )}
                            {reply.conditions.length > 0 && (
                              <span className="badge" title={reply.conditions.map(describePredicate).join(" and ")}>
                                only if {reply.conditions.length}
                              </span>
                            )}
                            {reply.actions.length > 0 && (
                              <span className="badge beat" title={reply.actions.map(describeAction).join("; ")}>
                                runs {reply.actions.length}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <button type="button" onClick={() => addDialogue("New dialogue")}>
        + Dialogue
      </button>
    </section>
  );
}
