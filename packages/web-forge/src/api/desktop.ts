import type { ForgeDesktopApi } from "@forge/contracts";

declare global {
  interface Window {
    /** Present only inside the desktop shell: the restricted API its preload exposes. */
    forgeDesktop?: ForgeDesktopApi;
  }
}

/** The desktop shell's API, or null in a browser. Everything desktop-only is gated on this. */
export function getDesktop(): ForgeDesktopApi | null {
  return typeof window !== "undefined" && window.forgeDesktop !== undefined ? window.forgeDesktop : null;
}
