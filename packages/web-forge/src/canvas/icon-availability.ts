import { useSyncExternalStore } from "react";

/**
 * Whether a radar sprite can actually be loaded.
 *
 * The sprites come from the registered EmptyEpsilon install (they are not bundled with the desktop app), so
 * before an install is scanned — or for a trace the install does not have — the file is absent. An SVG mask
 * whose image fails to load hides what it masks, which would make every ship on the map vanish. The marker
 * therefore asks first, and draws its plain shape (the same one used for types with no sprite) when the
 * sprite is not there.
 */
const known = new Map<string, boolean>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

function probe(url: string): void {
  if (known.has(url) || pending.has(url) || typeof Image === "undefined") return;
  pending.add(url);
  const image = new Image();
  const done = (ok: boolean): void => {
    pending.delete(url);
    known.set(url, ok);
    for (const listener of listeners) listener();
  };
  image.onload = () => done(true);
  image.onerror = () => done(false);
  image.src = url;
}

/** Forget what was learned: a rescan may have added the sprites. */
export function resetIconAvailability(): void {
  known.clear();
  for (const listener of listeners) listener();
}

/**
 * True while the sprite is loading or present, false once it is known to be missing. Optimistic while pending, so an
 * install with sprites flashes nothing; the plain shape appears only on a confirmed miss.
 */
export function useIconUsable(url: string | null): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      if (url === null) return false;
      probe(url);
      return known.get(url) !== false;
    },
    () => true,
  );
}
