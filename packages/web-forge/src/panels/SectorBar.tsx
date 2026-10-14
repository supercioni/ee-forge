import { useState } from "react";
import { countsOfSector } from "@forge/core/editor";
import { useEditor, useEffectivePrefs } from "../store/editor.js";

/**
 * Which sector the Map is open on — the first control of the scene column.
 *
 * "All sectors" draws everything (the groups of every sector and the Shared ones); a sector draws its own groups and
 * markers plus the Shared ones. It is a way of looking, remembered per project: choosing one never changes the
 * document, and nothing about it exists in the game. New sectors are named here; each sector is renamed or deleted
 * from its own heading in the list below.
 */
export function SectorBar(): JSX.Element | null {
  const project = useEditor((s) => s.project);
  const setOpenSector = useEditor((s) => s.setOpenSector);
  const addSector = useEditor((s) => s.addSector);
  const scope = useEffectivePrefs().sector;
  const picking = useEditor((s) => s.pick) !== null;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  if (project === null) return null;

  const create = (): void => {
    const reason = addSector(name);
    if (reason === null) {
      setAdding(false);
      setName("");
      setProblem(null);
    } else {
      setProblem(reason);
    }
  };

  return (
    <div className="sector-bar" role="group" aria-label="Sector">
      <div className="sector-bar-row">
        <label className="sector-select">
          <span className="sr-only">Sector</span>
          <select
            aria-label="Active sector"
            value={scope ?? ""}
            disabled={picking}
            title={picking ? "Every sector is shown while you pick something on the map" : "The part of the map you are working on"}
            onChange={(e) => setOpenSector(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">All sectors</option>
            {project.map.sectors.map((sector) => {
              const counts = countsOfSector(project, sector.id);
              return (
                <option key={sector.id} value={sector.id}>
                  {sector.label} ({counts.groups})
                </option>
              );
            })}
          </select>
        </label>
        <button type="button" className="small icon-button" aria-expanded={adding} aria-label="Add sector" onClick={() => setAdding(!adding)} title="Add a sector, such as another star system">
          <span aria-hidden="true">+</span>
        </button>
      </div>
      {adding && (
        <div className="sector-new">
          <input
            aria-label="New sector name"
            placeholder="Name, e.g. Kepler system"
            value={name}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") {
                e.stopPropagation();
                setAdding(false);
              }
            }}
          />
          <button type="button" disabled={name.trim() === ""} onClick={create}>
            Create sector
          </button>
          {problem !== null && (
            <p className="hint error" role="alert">
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
