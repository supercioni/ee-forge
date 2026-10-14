import type { EEProject } from "@forge/contracts";
import { buildDiagram, summarizeActions, type DiagramNode } from "./diagram.js";

/**
 * The diagram's source, as mermaid.
 *
 * A text rendering of `buildDiagram` — the same nodes and the same edges as the picture in the editor, so the two
 * cannot disagree, and a project that is pasted into a markdown renderer reads like what the author saw. Generated,
 * never edited, never parsed back (the same one-way rule as the Lua, ADR-0034 §2). The in-editor picture is drawn
 * with no library (it works offline); this text is for anyone who wants it elsewhere.
 */

/** Mermaid ids must be identifier-ish; project ids are already close. */
function mid(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Mermaid node labels are quoted, so only quotes and newlines need care. */
function label(text: string): string {
  return text.replace(/"/g, "'").replace(/\r?\n/g, " ").trim();
}

export function toMermaid(project: EEProject): string {
  const model = buildDiagram(project);
  const lines: string[] = ["flowchart LR"];
  const { beats, rules, gmButtons } = project.logic;
  const byId = new Map(model.nodes.map((n) => [n.id, n] as const));

  const draw = (node: DiagramNode, extra = ""): string => {
    const id = mid(node.id);
    const text = `${label(node.label)}<br/><small>${label(node.detail)}${extra === "" ? "" : `<br/>${label(extra)}`}</small>`;
    switch (node.kind) {
      case "timed":
        return `${id}["T+${node.at ?? 0}s ${text}"]`;
      case "rule":
        return `${id}{"${text}"}`;
      case "gm":
        return `${id}(["GM: ${text}"])`;
      case "group":
        return `${id}[("${text}")]`;
      default:
        return `${id}["${text}"]`;
    }
  };

  const timed = model.nodes.filter((n) => n.kind === "timed");
  if (timed.length > 0) {
    // Clock order, but deliberately not joined: being earlier is not a cause of what comes after.
    lines.push("  subgraph timeline[Timed events]");
    lines.push("    direction TB");
    for (const node of timed) {
      const beat = beats.find((b) => `timed:${b.id}` === node.id);
      lines.push(`    ${draw(node, summarizeActions(beat?.actions ?? []))}`);
    }
    lines.push("  end");
  }
  for (const node of model.nodes.filter((n) => n.kind === "rule")) {
    const rule = rules.find((r) => `rule:${r.id}` === node.id);
    lines.push(`  ${draw(node, `${rule?.once === false ? "each time" : "once"}: ${summarizeActions(rule?.actions ?? [])}`)}`);
  }
  for (const node of model.nodes.filter((n) => n.kind === "gm")) {
    const button = gmButtons.find((b) => `gm:${b.id}` === node.id);
    lines.push(`  ${draw(node, summarizeActions(button?.actions ?? []))}`);
  }
  for (const node of model.nodes.filter((n) => n.kind === "reply" || n.kind === "step" || n.kind === "group")) {
    lines.push(`  ${draw(node)}`);
  }
  for (const edge of model.edges) {
    const arrow = edge.kind === "spawns" ? "-->" : "-.->";
    if (byId.has(edge.from) && byId.has(edge.to)) lines.push(`  ${mid(edge.from)} ${arrow}|${label(edge.label)}| ${mid(edge.to)}`);
  }

  if (model.nodes.length === 0) lines.push("  empty[No timed events, rules or GM controls yet]");
  return lines.join("\n");
}
