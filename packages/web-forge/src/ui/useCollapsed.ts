import { useCallback, useState } from "react";

/**
 * Whether a side panel is folded away, remembered between sessions.
 *
 * Kept apart from the panel's width on purpose: folding a panel must never touch the width the author chose, so
 * opening it again brings back exactly that column. Same rules as the width: a fact about this screen, not about the
 * project, and every storage access guarded.
 */
export function useCollapsed(key: string): readonly [boolean, (collapsed: boolean) => void] {
  const storageKey = `exodus.forge.collapsed.${key}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback(
    (next: boolean): void => {
      setCollapsed(next);
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // not persisted: still folded for this session
      }
    },
    [storageKey],
  );
  return [collapsed, set] as const;
}
