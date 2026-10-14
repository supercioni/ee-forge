import { useMemo } from "react";
import { describeVia, findReferences, type ReferenceTarget } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";
import { LOGIC_WORDS } from "../ui/glossary.js";

const OWNER_WORD = LOGIC_WORDS;

/**
 * "Used by": what in the project points at this object, group or marker, each one a button that goes there.
 *
 * Derived from the project every time it is shown (`findReferences`): there is no second list to fall out of date,
 * and renaming an id (which rewrites the references) is reflected the moment it happens. Opening one switches to the
 * view that holds it and selects it; the object stays selected, so coming back is one click on Map.
 */
export function UsedBy({ target, id }: { target: ReferenceTarget; id: string }): JSX.Element {
  const project = useEditor((s) => s.project);
  const openReference = useEditor((s) => s.openReference);
  const refs = useMemo(() => (project === null ? [] : findReferences(project, target, id)), [project, target, id]);
  const noun = target === "object" ? "this object" : target === "group" ? "this group" : "this place";

  return (
    <div className="used-by">
      {refs.length === 0 ? (
        <p className="hint">Nothing refers to {noun} yet.</p>
      ) : (
        <ul className="used-by-list" aria-label={`Used by (${refs.length})`}>
          {refs.map((ref, index) => {
            const via = describeVia(ref.via);
            return (
              <li key={`${ref.owner.kind}-${ref.owner.id}-${"nodeId" in ref.owner ? ref.owner.nodeId : ""}-${ref.where}-${index}`}>
                {ref.owner.kind === "exodusStep" ? (
                  <span>
                    {OWNER_WORD[ref.owner.kind]} {ref.owner.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="row-link"
                    title={`Open ${OWNER_WORD[ref.owner.kind].toLowerCase()} “${ref.owner.label}”`}
                    aria-label={`Open ${OWNER_WORD[ref.owner.kind].toLowerCase()} ${ref.owner.label} (${ref.where}${via !== "" ? `, ${via}` : ""})`}
                    onClick={() => openReference(ref.owner)}
                  >
                    <span className="used-kind">{OWNER_WORD[ref.owner.kind]}</span> {ref.owner.label}
                  </button>
                )}
                <span className="muted">
                  {" "}
                  — {ref.where}
                  {via !== "" ? ` · ${via}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
