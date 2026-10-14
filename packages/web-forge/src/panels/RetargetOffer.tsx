import { instancesOfTemplate } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";

const SHOWN = 6;

/**
 * "You copied a hull — the ships flying the old one still are."
 *
 * Copying a stock template makes a **new** template with a new name, so
 * every map object keeps its original `setTemplate(…)` string. The build
 * succeeds, the scenario runs, and the change the author thought they made
 * is simply not in the game. That failure is silent, which is why this is a
 * banner rather than a line in the status bar.
 *
 * It says that nothing has moved, **names the objects** a move would change
 * (each a button to the map, with a way back), and asks. Moving is one
 * explicit click; leaving them is another. The offer lives in the store, not
 * in a panel's state, so switching to the map and back does not lose it.
 */
export function RetargetOffer(): JSX.Element | null {
  const pending = useEditor((s) => s.pendingRetarget);
  const project = useEditor((s) => s.project);
  const applyRetarget = useEditor((s) => s.applyRetarget);
  const dismissRetarget = useEditor((s) => s.dismissRetarget);
  const openInstance = useEditor((s) => s.openInstance);

  if (pending === null || project === null) return null;

  const instances = instancesOfTemplate(project, pending.from);
  if (instances.length === 0) return null;

  return (
    <div className="banner warn retarget-offer" role="region" aria-label="Move map objects to the copy?">
      <p>
        <strong>Nothing has been moved.</strong> {instances.length} map object(s) still spawn <strong>{pending.from}</strong>, not your
        copy <strong>{pending.to}</strong>:
      </p>
      <ul className="used-by-list" aria-label="Objects that would move">
        {instances.slice(0, SHOWN).map((i) => (
          <li key={i.id}>
            <button
              type="button"
              className="row-link"
              aria-label={`Open ${i.callsign ?? i.id} on the map`}
              onClick={() => openInstance(i.id, { view: "ship", label: "Fleet" })}
            >
              {i.callsign ?? i.id}
            </button>
            <span className="muted">
              {" "}
              {i.type} · {i.groupLabel}
            </span>
          </li>
        ))}
        {instances.length > SHOWN && <li className="muted">…and {instances.length - SHOWN} more</li>}
      </ul>
      <p>
        <button type="button" className="small" onClick={applyRetarget}>
          Move these {instances.length} to &ldquo;{pending.to}&rdquo;
        </button>{" "}
        <button type="button" className="small" onClick={dismissRetarget}>
          Leave them on &ldquo;{pending.from}&rdquo;
        </button>
      </p>
    </div>
  );
}
