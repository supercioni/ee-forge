import type {
  EEDialogue,
  EEDialogueNode,
  EEDialogueReply,
  EELogic,
  EEReplyTarget,
} from "@forge/contracts";
import { uniqueObjectId } from "./factories.js";

/**
 * Blank dialogues, nodes and replies, plus the small rules the editor
 * needs about them (ADR-0039).
 *
 * Same discipline as `logic-forms.ts`: what a blank record looks like is
 * the toolkit's business, not a React component's, so a test can assert
 * every one of them is schema-valid.
 */

/** Where a reply can lead, for the picker. */
export const REPLY_TARGET_KINDS = ["node", "gm", "services"] as const;

export function describeReplyTarget(target: EEReplyTarget): string {
  switch (target.kind) {
    case "node":
      return `→ ${target.nodeId}`;
    case "gm":
      return "→ the GM";
    case "services":
      return "→ EE's station services";
  }
}

/**
 * A blank reply.
 *
 * The text is not empty: the schema requires at least one character
 * (a button with no label is a bug, not a draft), and "Continue" is the
 * word an author is most likely to keep.
 */
export function emptyReply(nodeId: string): EEDialogueReply {
  return { text: "Continue", target: { kind: "node", nodeId }, conditions: [], actions: [] };
}

export function emptyNode(id: string): EEDialogueNode {
  return { id, text: "", replies: [] };
}

/**
 * A blank dialogue: one node, which is also its entry.
 *
 * Never an empty node list — `entry` must name a node, so a dialogue with
 * none could not satisfy its own schema.
 */
export function emptyDialogue(id: string, label: string): EEDialogue {
  return { id, label, entry: "start", nodes: [emptyNode("start")] };
}

/** An id no other dialogue in the project holds. */
export function uniqueDialogueId(logic: EELogic, base: string): string {
  return uniqueObjectId(new Set(logic.dialogues.map((d) => d.id)), base);
}

/** An id no other node of this dialogue holds. */
export function uniqueNodeId(dialogue: EEDialogue, base: string): string {
  return uniqueObjectId(new Set(dialogue.nodes.map((n) => n.id)), base);
}

/**
 * Rename a node and every reply that jumps to it, entry included.
 *
 * Scoped to one dialogue on purpose: node ids are unique *within* a
 * dialogue, so two conversations may each have a "start" and renaming one
 * must not touch the other.
 */
export function renameNode(dialogue: EEDialogue, from: string, to: string): EEDialogue {
  if (from === to) return dialogue;
  if (dialogue.nodes.some((node) => node.id === to)) return dialogue;
  return {
    ...dialogue,
    entry: dialogue.entry === from ? to : dialogue.entry,
    nodes: dialogue.nodes.map((node) => ({
      ...node,
      id: node.id === from ? to : node.id,
      replies: node.replies.map((reply) =>
        reply.target.kind === "node" && reply.target.nodeId === from
          ? { ...reply, target: { kind: "node", nodeId: to } }
          : reply,
      ),
    })),
  };
}

/**
 * The replies pointing at a node, so deleting one is an informed choice.
 *
 * Returns `<node>#<index>` labels rather than a count: "3 replies" tells
 * an author there is a problem, "greeting#1, refuel#0" tells them where.
 */
export function referencesToNode(dialogue: EEDialogue, nodeId: string): readonly string[] {
  const found = dialogue.nodes.flatMap((node) =>
    node.replies
      .map((reply, index) =>
        reply.target.kind === "node" && reply.target.nodeId === nodeId
          ? `${node.id}#${index}`
          : null,
      )
      .filter((label): label is string => label !== null),
  );
  return dialogue.entry === nodeId ? ["(the opening node)", ...found] : found;
}
