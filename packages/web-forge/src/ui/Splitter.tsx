import { useCallback, useRef, useState } from "react";
import { clampColumn, SHIP_DIAGRAMS, type ColumnSpec } from "./split.js";

/**
 * The grab handle between a workspace's centre and one of its side columns (either side).
 *
 * Measured as a **delta from where the drag started**, not from a
 * container's edge: the grid it sits in has three tracks and a border, and
 * arithmetic against any of those is arithmetic that breaks when the
 * layout changes. A delta only needs the pointer.
 *
 * Pointer capture rather than window listeners, so a drag survives the
 * cursor leaving the handle — which it does immediately, because the
 * handle is six pixels wide.
 */
export function Splitter({
  width,
  onChange,
  label,
  side = "right",
  spec = SHIP_DIAGRAMS,
}: {
  /** Current width of the panel this handle resizes, in px. */
  width: number;
  onChange: (width: number) => void;
  /** What the panel is, for the separator's accessible name. */
  label: string;
  /** Which side of the handle the panel is on: a panel on the right grows when the handle moves left. */
  side?: "left" | "right";
  /** Limits and default of this column. */
  spec?: ColumnSpec;
}): JSX.Element {
  const sign = side === "right" ? -1 : 1;
  const clamp = (w: number): number => clampColumn(w, spec, window.innerWidth);
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // The panel is on the right, so dragging left widens it.
  const applyDelta = useCallback(
    (clientX: number): void => {
      const from = start.current;
      if (from === null) return;
      onChange(clampColumn(from.width + sign * (clientX - from.x), spec, window.innerWidth));
    },
    [onChange, sign, spec],
  );

  return (
    <div
      className={dragging ? "splitter dragging" : "splitter"}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (start.current !== null) applyDelta(e.clientX);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
        setDragging(false);
      }}
      // A pointer-only control is one a keyboard cannot reach, and this one
      // decides how much of the window the author can read.
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") onChange(clamp(width - sign * step));
        else if (e.key === "ArrowRight") onChange(clamp(width + sign * step));
        else if (e.key === "Home") onChange(clamp(spec.default));
        else return;
        e.preventDefault();
      }}
      onDoubleClick={() => onChange(clamp(spec.default))}
      title="Drag to resize — double-click to reset"
    />
  );
}
