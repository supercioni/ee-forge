import { useRef, useState } from "react";
import type { EEBeat } from "@forge/contracts";
import { describeAction } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";

/**
 * The story on a clock.
 *
 * A timeline rather than a list because the question an author asks of a
 * chapter is "what happens when, and how far apart" — and that is answered
 * by looking, not by reading a column of numbers. Dragging a beat is how
 * pacing gets tuned; typing 137 into a field is how it gets guessed.
 *
 * The lane is linear in seconds and sized to the last beat, so the spacing
 * on screen is the spacing in play.
 */

/** Sensible ticks for a chapter: 30 s up to an hour and a half. */
function tickStep(spanSeconds: number): number {
  for (const step of [15, 30, 60, 120, 300, 600, 900]) {
    if (spanSeconds / step <= 12) return step;
  }
  return 1800;
}

export function Timeline(): JSX.Element {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.logicSelection);
  const selectLogic = useEditor((s) => s.selectLogic);
  const addBeat = useEditor((s) => s.addBeat);
  const updateBeat = useEditor((s) => s.updateBeat);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const beats = [...(project?.logic.beats ?? [])].sort((a, b) => a.at - b.at);
  const last = beats[beats.length - 1]?.at ?? 0;
  // Always show a little road ahead, so a beat can be dragged later.
  const span = Math.max(last * 1.25, 300);
  const step = tickStep(span);

  const atFromClientX = (clientX: number): number => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    // Whole seconds: EE's clock has no use for 12.4 s, and a round number
    // is what an author will write in the chapter notes anyway.
    return Math.round(ratio * span);
  };

  return (
    <section className="panel timeline">
      <div className="panel-head">
        <h2>Timeline <span className="muted">— timed events</span></h2>
        <button type="button" className="small" onClick={() => addBeat(Math.round(last + 60))}>
          + Timed event
        </button>
      </div>

      <div
        className="timeline-lane"
        ref={laneRef}
        onPointerMove={(e) => {
          if (dragging === null) return;
          updateBeat(dragging, { at: atFromClientX(e.clientX) });
        }}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
        onDoubleClick={(e) => addBeat(atFromClientX(e.clientX))}
      >
        <div className="timeline-axis">
          {Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step).map((t) => (
            <span key={t} className="tick" style={{ left: `${(t / span) * 100}%` }}>
              {t === 0 ? "T+0" : formatClock(t)}
            </span>
          ))}
        </div>

        {beats.map((beat, index) => (
          <BeatPin
            key={beat.id}
            beat={beat}
            span={span}
            row={index % 3}
            selected={selection?.kind === "beat" && selection.id === beat.id}
            onSelect={() => selectLogic({ kind: "beat", id: beat.id })}
            onDragStart={() => setDragging(beat.id)}
            onNudge={(seconds) => updateBeat(beat.id, { at: Math.min(Math.floor(span), Math.max(0, beat.at + seconds)) })}
          />
        ))}

        {beats.length === 0 && (
          <p className="hint timeline-empty">
            Double-click the lane to drop a timed event, or use + Timed event.
          </p>
        )}
      </div>
    </section>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

function BeatPin({
  beat,
  span,
  row,
  selected,
  onSelect,
  onDragStart,
  onNudge,
}: {
  beat: EEBeat;
  span: number;
  /** Staggered across three rows so close beats stay readable. */
  row: number;
  selected: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  /** Move the beat by this many seconds: the keyboard's answer to dragging it. */
  onNudge: (seconds: number) => void;
}): JSX.Element {
  const summary =
    beat.actions.length === 0
      ? "no actions"
      : beat.actions.length === 1
        ? describeAction(beat.actions[0] as (typeof beat.actions)[number])
        : `${beat.actions.length} actions`;

  return (
    <button
      type="button"
      className={`beat-pin ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      aria-label={`Timed event ${beat.label} at ${beat.at} seconds. Arrow keys move it by 5 seconds, Shift by 30.`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onNudge((e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 30 : 5));
      }}
      style={{ left: `${(beat.at / span) * 100}%`, top: `${28 + row * 30}px` }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
        onDragStart();
      }}
      title={`${beat.label} — ${summary}`}
    >
      <span className="beat-time">T+{beat.at}s</span>
      <span className="beat-label">{beat.label}</span>
    </button>
  );
}
