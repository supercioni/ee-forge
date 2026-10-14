import { useEffect, useState } from "react";

/** Below this window width the side columns give way (the smallest window the app allows is 900 px wide). */
export const NARROW_BELOW_PX = 1100;

/**
 * On a roomy window a side column is exactly the width the author dragged it to. On a narrow one the same pixel
 * width could leave nothing for the work area, so each column is also capped at a share of the window. The
 * author's chosen width is untouched (and remembered); it applies again as soon as the window is wide enough.
 */
export function useColumnCap(): (px: number, shareVw: number) => string {
  const query = `(max-width: ${NARROW_BELOW_PX - 1}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const on = (): void => setNarrow(media.matches);
    on();
    media.addEventListener("change", on);
    return () => media.removeEventListener("change", on);
  }, [query]);
  return (px, shareVw) => (narrow ? `min(${px}px, ${shareVw}vw)` : `${px}px`);
}
