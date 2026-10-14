import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The one class component in the editor.
 *
 * React has no hook for this: catching a render-time throw requires
 * `componentDidCatch`, and without one a throw anywhere below unmounts the
 * whole root — which is exactly what a missing `.glb` did, turning "click
 * a ship" into "the editor went blank".
 *
 * Deliberately narrow. It wraps the 3D preview, not the application: a
 * boundary around everything would turn real bugs into a quiet panel and
 * teach us nothing. This one guards a subtree whose failure mode is
 * *content* — an asset the manifest promised and the repo does not have —
 * where degrading to a message is the correct behaviour rather than a
 * cover-up.
 */
export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    /** Rendered instead of the children once one of them throws. */
    fallback: (error: unknown) => ReactNode;
    /**
     * Changing this remounts the subtree.
     *
     * Without it, one broken hull would poison the panel for every hull
     * selected afterwards: a boundary that has caught stays caught.
     */
    resetKey?: string;
    /** Told once per catch, so a parent can report what failed next to what it was showing. */
    onError?: (error: unknown) => void;
  },
  { error: unknown }
> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  override componentDidUpdate(prev: { resetKey?: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept: the message shown to the author is deliberately short, and the
    // stack is the only way to tell a missing file from a real bug.
    console.error("preview failed", error, info.componentStack);
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    return this.state.error === null ? this.props.children : this.props.fallback(this.state.error);
  }
}
