import type { DiagramEdge, DiagramModel, DiagramNode } from "@forge/core/editor";
import { describeEdge } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";

/**
 * The picture: three columns drawn as plain SVG, no library, so it works offline and costs nothing until it is asked
 * for (this module is loaded only when "Show diagram" is pressed).
 *
 * It lays out and draws `buildDiagram`'s nodes and edges and decides nothing: sources on the left (timed events in clock
 * order, GM controls, dialogue replies, EXODUS fallbacks), groups in the middle, rules on the right. Each box opens its
 * item; each link is also a sentence in the list above, so the picture is never the only way to read it.
 */

const W = 230;
const H = 50;
const GAP = 16;
const COLS = [20, 330, 640];
const KIND_LABEL: Record<DiagramNode["kind"], string> = { timed: "Timed event", rule: "Rule", gm: "GM control", reply: "Dialogue reply", step: "EXODUS step", group: "Group" };

function column(kind: DiagramNode["kind"]): 0 | 1 | 2 {
  return kind === "group" ? 1 : kind === "rule" ? 2 : 0;
}

const STROKE: Record<DiagramEdge["kind"], { color: string; dash: string }> = {
  spawns: { color: "#4fc3f7", dash: "" },
  wiped: { color: "#ffb74d", dash: "6 4" },
  variable: { color: "#aed581", dash: "2 4" },
  destroys: { color: "#ef9a9a", dash: "8 3 2 3" },
};

export default function DiagramView({ model }: { model: DiagramModel }): JSX.Element {
  const openReference = useEditor((s) => s.openReference);
  const place = new Map<string, { x: number; y: number }>();
  const counts = [0, 0, 0];
  for (const node of model.nodes) {
    const c = column(node.kind);
    place.set(node.id, { x: COLS[c] ?? 0, y: 30 + (counts[c] ?? 0) * (H + GAP) });
    counts[c] = (counts[c] ?? 0) + 1;
  }
  const rows = Math.max(1, ...counts);
  const height = 30 + rows * (H + GAP);

  const path = (a: { x: number; y: number }, b: { x: number; y: number }, lane: number): string => {
    if (a.x === b.x) {
      // Same column: loop out to the right so the link does not run over the boxes between.
      const x = a.x + W;
      const out = 26 + lane * 10;
      return `M ${x} ${a.y + H / 2} C ${x + out} ${a.y + H / 2}, ${x + out} ${b.y + H / 2}, ${x} ${b.y + H / 2}`;
    }
    const forward = a.x < b.x;
    const x1 = forward ? a.x + W : a.x;
    const x2 = forward ? b.x : b.x + W;
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${a.y + H / 2} C ${mid} ${a.y + H / 2}, ${mid} ${b.y + H / 2}, ${x2} ${b.y + H / 2}`;
  };

  return (
    <div className="diagram-wrap">
      <svg
        className="flow-diagram"
        viewBox={`0 0 ${COLS[2]! + W + 70} ${height}`}
        role="group"
        aria-label={`Mission diagram: ${model.nodes.length} parts, ${model.edges.length} links. The links are listed above as sentences.`}
      >
        <defs>
          {Object.entries(STROKE).map(([kind, s]) => (
            <marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={s.color} />
            </marker>
          ))}
        </defs>
        {["Sources", "Groups", "Rules"].map((title, i) => (
          <text key={title} x={COLS[i]} y={16} className="diagram-colhead">
            {title}
          </text>
        ))}
        {model.edges.map((edge, i) => {
          const a = place.get(edge.from);
          const b = place.get(edge.to);
          if (a === undefined || b === undefined) return null;
          const s = STROKE[edge.kind];
          const lane = i % 4;
          const mx = a.x === b.x ? a.x + W + 30 + lane * 10 : (a.x + b.x + W) / 2;
          const my = (a.y + b.y) / 2 + H / 2;
          return (
            <g key={i} className={`diagram-edge ${edge.kind}`}>
              <title>{describeEdge(model, edge)}</title>
              <path d={path(a, b, lane)} fill="none" stroke={s.color} strokeWidth={1.6} strokeDasharray={s.dash} markerEnd={`url(#arrow-${edge.kind})`} />
              <text x={mx} y={my - 4} className="diagram-edge-label" textAnchor="middle">
                {edge.label}
              </text>
            </g>
          );
        })}
        {model.nodes.map((node) => {
          const p = place.get(node.id);
          if (p === undefined) return null;
          const open = node.owner;
          return (
            <g
              key={node.id}
              className={`diagram-node ${node.kind}`}
              transform={`translate(${p.x} ${p.y})`}
              {...(open !== null
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": `Open ${KIND_LABEL[node.kind].toLowerCase()} ${node.label}`,
                    onClick: () => openReference(open),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openReference(open);
                      }
                    },
                  }
                : {})}
            >
              <title>{`${KIND_LABEL[node.kind]}: ${node.label} — ${node.detail}`}</title>
              <rect width={W} height={H} rx={node.kind === "gm" ? 25 : 4} />
              <text x={10} y={19} className="diagram-title">
                {node.label.length > 30 ? `${node.label.slice(0, 29)}…` : node.label}
              </text>
              <text x={10} y={38} className="diagram-detail">
                {KIND_LABEL[node.kind]} · {node.detail.length > 26 ? `${node.detail.slice(0, 25)}…` : node.detail}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="diagram-legend" aria-hidden="true">
        <li className="spawns">spawns a group</li>
        <li className="wiped">waits for a group to be wiped out</li>
        <li className="variable">sets / reads the same variable</li>
        <li className="destroys">destroys / waits for an object</li>
      </ul>
    </div>
  );
}
