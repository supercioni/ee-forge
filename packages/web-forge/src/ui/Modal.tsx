import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FOCUSABLE_SELECTOR, wrapTarget } from "./focus.js";

/**
 * The one dialog every Forge window uses (Export, Settings, Installations, Unsaved changes).
 *
 * What it guarantees, so no dialog has to remember it:
 *  - **Focus goes in.** On open it lands on the control marked `data-autofocus` (the safe default of that
 *    dialog), else the first control, else the dialog itself.
 *  - **Focus stays in.** Tab and Shift+Tab wrap inside the dialog, and everything outside it is made `inert`
 *    — not reachable by keyboard, not clickable, hidden from a screen reader — until it closes.
 *  - **Escape is Cancel.** It calls `onClose`, which each dialog defines as its own "no" (the unsaved-changes
 *    dialog answers "cancel", not "discard"). Only the topmost dialog answers.
 *  - **Focus comes back.** On close it returns to the control that opened the dialog.
 *
 * It is rendered in a portal beside `#root` so that making the editor inert does not also silence the dialog.
 */

/** Open dialogs, innermost last: Escape belongs to the one on top. */
const stack: symbol[] = [];

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  alert = false,
  closeLabel = "Close",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** A question that must be answered (role `alertdialog`), with its body read out as the description. */
  alert?: boolean;
  /** What the ✕ is called. It always does what Escape does; keep it distinct from a visible "Cancel" button. */
  closeLabel?: string;
}): JSX.Element {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.setAttribute("data-modal-host", "");
    return el;
  });

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.appendChild(host);

    // Everything else in the page, dialogs below this one included, stops being interactive.
    const silenced: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === host || !(child instanceof HTMLElement) || child.hasAttribute("inert")) continue;
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      child.setAttribute("inert", "");
      silenced.push(child);
    }

    const me = Symbol("modal");
    stack.push(me);

    const dialog = dialogRef.current;
    const first =
      dialog?.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ??
      Array.from(dialog?.querySelectorAll<HTMLElement>(".modal-body *") ?? []).find((el) => el.matches(FOCUSABLE_SELECTOR) && visible(el)) ??
      dialog?.querySelector<HTMLElement>("header button") ??
      dialog;
    first?.focus({ preventScroll: true });

    // Capture phase: a dialog's Escape must not also reach the editor's own Escape (cancel a tool, close a menu).
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== "Escape" || stack[stack.length - 1] !== me) return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      const at = stack.indexOf(me);
      if (at >= 0) stack.splice(at, 1);
      for (const el of silenced) el.removeAttribute("inert");
      host.remove();
      if (opener !== null && opener.isConnected && !opener.closest("[inert]")) opener.focus({ preventScroll: true });
    };
  }, [host]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(visible);
    if (stops.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const current = document.activeElement instanceof HTMLElement ? stops.indexOf(document.activeElement) : -1;
    const target = wrapTarget(stops.length, current, e.shiftKey);
    if (target === null) return;
    e.preventDefault();
    stops[target]?.focus();
  };

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={wide ? "modal wide" : "modal"}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={title}
        {...(alert ? { "aria-describedby": `${id}-body` } : {})}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" className="small" aria-label={closeLabel} onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="modal-body" id={`${id}-body`}>
          {children}
        </div>
      </div>
    </div>,
    host,
  );
}
