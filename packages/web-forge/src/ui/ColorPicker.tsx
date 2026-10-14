import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placePopover } from "./popover-position.js";
import {
  PALETTE_COLUMNS,
  fromScale,
  paletteSwatches,
  sameColor,
  toCss,
  toScale,
  type Rgb,
} from "./palette-colors.js";

/**
 * Colour fields: a swatch you click, not three numbers you guess.
 *
 * EE's colour setters disagree about scale — factions, zones and radar
 * traces take 0..255 integers, a planet's atmosphere takes 0..1 floats —
 * so the picker works in bytes and converts on the way out. The document
 * keeps whatever the field's own scale is, unchanged, until a swatch is
 * actually picked: opening the grid never rewrites a value.
 *
 * A colour that came from somewhere else (a hand-edited project, an
 * imported faction) is shown faithfully on the chip even when it is not
 * one of the 1024 — it simply highlights nothing in the grid.
 */
export function ColorPicker({
  value,
  scale,
  nullable = false,
  label,
  onChange,
}: {
  value: readonly number[] | null;
  /** The field's own scale: 255 for EE's integer triples, 1 for its floats. */
  scale: 1 | 255;
  nullable?: boolean | undefined;
  /** The field's name, so the swatch button reads as "Colour: #aabbcc" rather than a bare hex. */
  label?: string | undefined;
  onChange: (value: [number, number, number] | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  const current: Rgb | null = value === null ? null : fromScale(value, scale);
  const swatches = paletteSwatches();
  // Roving focus inside the grid: one tab stop, arrows move between cells. 1024 tab stops would be worse than
  // none, and with none a keyboard could open the grid but never choose from it.
  const pickedIndex = current === null ? -1 : swatches.findIndex((rgb) => sameColor(rgb, current));
  const [cursor, setCursor] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  /**
   * The grid is positioned against the **viewport**, not the field.
   *
   * Both panels it opens in scroll, and a scrolling box clips on the other
   * axis too — so an absolutely positioned grid was trapped inside a 320px
   * inspector, and anchored to one edge it ran off screen in the wider
   * one. Fixed coordinates, clamped to the window, work in both without
   * either panel needing to know about it.
   *
   * Laid out before paint, so the grid is never seen in the wrong place.
   */
  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const field = wrapper.current?.getBoundingClientRect();
    const box = pop.current?.getBoundingClientRect();
    if (field === undefined || box === undefined) return;
    setAt(
      placePopover(field, box, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [open]);

  // Opening puts the cursor on the current colour (or the first cell) and the focus in the grid, so the
  // keyboard lands where the eye would.
  useEffect(() => {
    if (!open) return;
    const start = pickedIndex >= 0 ? pickedIndex : 0;
    setCursor(start);
    requestAnimationFrame(() => gridRef.current?.querySelectorAll<HTMLElement>("button")[start]?.focus({ preventScroll: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (wrapper.current?.contains(event.target as Node) !== true) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // This Escape is spoken to the grid: the map's own Escape (deselect, drop the tool) must not also hear it.
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    // Fixed coordinates go stale the moment anything moves under them, so
    // close rather than chase. `true` catches scrolls in the inner panels —
    // but not a scroll of the grid itself, which is its own business.
    const onMove = (event: Event): void => {
      if (pop.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  return (
    <div className="color-field" ref={wrapper}>
      <button
        ref={trigger}
        type="button"
        className="color-swatch"
        aria-haspopup="true"
        aria-expanded={open}
        {...(label !== undefined ? { "aria-label": `${label}: ${current === null ? "unset" : toCss(current)}` } : {})}
        onClick={() => setOpen(!open)}
      >
        <span
          className="chip"
          style={{ background: current === null ? "transparent" : toCss(current) }}
        />
        <span className={current === null ? "muted" : undefined}>
          {current === null ? "(unset)" : toCss(current)}
        </span>
      </button>

      {open && (
        <div
          className="color-grid-pop"
          ref={pop}
          style={{
            top: at?.top ?? 0,
            left: at?.left ?? 0,
            // Measured on the first layout pass, placed on the same one.
            visibility: at === null ? "hidden" : "visible",
          }}
        >
          <div
            className="color-grid"
            ref={gridRef}
            role="group"
            aria-label={`${label ?? "Colour"} palette. Arrow keys move, Enter chooses, Escape closes.`}
            style={{ gridTemplateColumns: `repeat(${PALETTE_COLUMNS}, 1fr)` }}
            onKeyDown={(e) => {
              const delta =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? PALETTE_COLUMNS : e.key === "ArrowUp" ? -PALETTE_COLUMNS : 0;
              const next = e.key === "Home" ? 0 : e.key === "End" ? swatches.length - 1 : cursor + delta;
              if (delta === 0 && e.key !== "Home" && e.key !== "End") return;
              e.preventDefault();
              const bounded = Math.min(swatches.length - 1, Math.max(0, next));
              setCursor(bounded);
              gridRef.current?.querySelectorAll<HTMLElement>("button")[bounded]?.focus({ preventScroll: true });
            }}
          >
            {swatches.map((rgb, index) => {
              const hex = toCss(rgb);
              return (
                // Keyed by cell, not by colour: rounding can land two
                // neighbouring hues on the same byte triple at the dark end.
                // One tab stop for the whole grid (the cell under the cursor);
                // the arrows do the rest.
                <button
                  key={index}
                  type="button"
                  tabIndex={index === cursor ? 0 : -1}
                  title={hex}
                  aria-label={hex}
                  aria-pressed={sameColor(rgb, current)}
                  className={sameColor(rgb, current) ? "picked" : undefined}
                  style={{ background: hex }}
                  onClick={() => {
                    onChange(toScale(rgb, scale));
                    setOpen(false);
                    trigger.current?.focus({ preventScroll: true });
                  }}
                />
              );
            })}
          </div>
          <div className="color-grid-foot">
            <span className="muted">{current === null ? "(unset)" : toCss(current)}</span>
            {nullable && (
              <button
                type="button"
                className="small"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  trigger.current?.focus({ preventScroll: true });
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
