import type { EEBeamDef, EETemplateDef } from "@forge/contracts";

/**
 * Firing arcs, drawn from the numbers.
 *
 * Not a picture of the hull — a picture of what the hull *covers*. Beam
 * arc and direction are the two numbers authors get wrong most easily
 * (a 90° arc at direction 180 is a rear battery, and reading that off a
 * table takes a moment that a wedge does not), so the diagram is a second
 * view onto the same array the table edits.
 *
 * Forward is drawn up. `direction` is relative to the hull with 0 straight
 * ahead — the same convention EE's own templates are written in — so the
 * wedge for direction 0 points at the top of the panel.
 */

const SIZE = 260;
const CENTRE = SIZE / 2;
/** Leaves room for the range labels outside the widest arc. */
const MAX_RADIUS = CENTRE - 26;

export function ShipDiagram({ template }: { template: EETemplateDef }): JSX.Element {
  const beams = template.beams;
  const tubes = template.tubes;

  const longest = Math.max(1, ...beams.map((b) => b.range));
  const scale = (range: number): number => (range / longest) * MAX_RADIUS;

  return (
    <div className="diagram">
      <h3>Firing arcs</h3>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="arc-diagram">
        <circle cx={CENTRE} cy={CENTRE} r={MAX_RADIUS} className="arc-ring" />
        <circle cx={CENTRE} cy={CENTRE} r={MAX_RADIUS / 2} className="arc-ring faint" />
        <line x1={CENTRE} y1={8} x2={CENTRE} y2={SIZE - 8} className="arc-axis" />
        <line x1={8} y1={CENTRE} x2={SIZE - 8} y2={CENTRE} className="arc-axis" />

        {beams.map((beam) => (
          <g key={`beam-${beam.index}`}>
            {beam.turret !== null && (
              <path
                d={wedge(beam.turret.direction, beam.turret.arc, scale(beam.range))}
                className="arc turret"
              />
            )}
            <path d={wedge(beam.direction, beam.arc, scale(beam.range))} className="arc beam" />
            <text
              x={labelPoint(beam).x}
              y={labelPoint(beam).y}
              className="arc-label"
              textAnchor="middle"
            >
              {beam.index}
            </text>
          </g>
        ))}

        {tubes?.perTube
          .filter((tube) => tube.direction !== null)
          .map((tube) => {
            const angle = ((tube.direction ?? 0) - 90) * (Math.PI / 180);
            return (
              <line
                key={`tube-${tube.index}`}
                x1={CENTRE}
                y1={CENTRE}
                x2={CENTRE + Math.cos(angle) * MAX_RADIUS}
                y2={CENTRE + Math.sin(angle) * MAX_RADIUS}
                className="tube-line"
              />
            );
          })}

        <polygon points={`${CENTRE},${CENTRE - 14} ${CENTRE - 8},${CENTRE + 10} ${CENTRE + 8},${CENTRE + 10}`} className="hull" />
      </svg>
      <p className="hint">
        {beams.length === 0 ? "No beams." : `Longest beam ${longest} — the outer ring.`}
        {tubes !== null && ` ${tubes.count} tube${tubes.count === 1 ? "" : "s"}.`}
      </p>
    </div>
  );
}

/** SVG path for an arc centred on `direction`, `arc` degrees wide. */
function wedge(direction: number, arc: number, radius: number): string {
  if (radius <= 0) return "";
  // A 360° arc has no chord to draw: two half circles instead, otherwise
  // the start and end points coincide and SVG renders nothing.
  if (arc >= 360) {
    return (
      `M ${CENTRE - radius} ${CENTRE} ` +
      `A ${radius} ${radius} 0 1 1 ${CENTRE + radius} ${CENTRE} ` +
      `A ${radius} ${radius} 0 1 1 ${CENTRE - radius} ${CENTRE} Z`
    );
  }
  const half = arc / 2;
  const from = (direction - half - 90) * (Math.PI / 180);
  const to = (direction + half - 90) * (Math.PI / 180);
  const x1 = CENTRE + Math.cos(from) * radius;
  const y1 = CENTRE + Math.sin(from) * radius;
  const x2 = CENTRE + Math.cos(to) * radius;
  const y2 = CENTRE + Math.sin(to) * radius;
  const large = arc > 180 ? 1 : 0;
  return `M ${CENTRE} ${CENTRE} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
}

function labelPoint(beam: EEBeamDef): { x: number; y: number } {
  const angle = (beam.direction - 90) * (Math.PI / 180);
  const r = MAX_RADIUS + 12;
  return { x: CENTRE + Math.cos(angle) * r, y: CENTRE + Math.sin(angle) * r + 4 };
}
