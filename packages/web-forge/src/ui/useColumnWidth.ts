import { useCallback, useEffect, useState } from "react";
import { clampColumn, type ColumnSpec } from "./split.js";

/**
 * The width of a resizable column, remembered between sessions.
 *
 * Layout, not document: it is a fact about this screen on this machine, so it lives in the browser/app profile beside the
 * other per-viewer conveniences and never in the project, and every storage access is guarded (private windows throw).
 *
 * What is **stored is what the author chose**. What is *returned* is that width fitted to the window as it is right now:
 * a window narrowed past what the width allows shows the column narrower, and widening the window again gives it back
 * exactly as chosen — the narrow window never overwrites the choice. Only an explicit resize (a drag, a key, a
 * double-click on the handle) writes anything.
 */
export function useColumnWidth(key: string, spec: ColumnSpec): readonly [number, (width: number) => void] {
  const storageKey = `exodus.forge.col.${key}`;
  const [chosen, setChosen] = useState<number>(() => {
    try {
      const stored = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(stored) && stored > 0) return stored;
    } catch {
      // storage unavailable: the default is fine
    }
    return spec.default;
  });
  const [viewport, setViewport] = useState<number>(() => window.innerWidth);
  useEffect(() => {
    const onResize = (): void => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const set = useCallback(
    (next: number): void => {
      setChosen(next);
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // not persisted: still resized for this session
      }
    },
    [storageKey],
  );
  return [clampColumn(chosen, spec, viewport), set] as const;
}
