import { useMemo, useState } from "react";
import { isFiltering, sceneEntries, typesInScene } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";
import { objectTypeLabel } from "../ui/glossary.js";
import { GroupTree } from "./GroupTree.js";
import { SectorBar } from "./SectorBar.js";
import { AddPalette, ScatterBrush } from "./Palette.js";

/**
 * The left column of the Map: find things, then add things.
 *
 * What is *in* the scene comes first — a search, then the groups and their objects — because that is what the author
 * reaches for most often. Adding is a tool the author asks for: **+ Add** unfolds the palette, **Scatter…** the brush,
 * each only while it is wanted (and the brush stays open while it is armed). Neither pushes the scene out of view.
 */
export function ScenePanel(): JSX.Element {
  const project = useEditor((s) => s.project);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const filter = useEditor((s) => s.sceneFilter);
  const setSceneFilter = useEditor((s) => s.setSceneFilter);
  const viewPrefs = useEditor((s) => s.viewPrefs);
  const markerSector = useEditor((s) => s.markerSector);
  const setMarkerSector = useEditor((s) => s.setMarkerSector);
  const [addOpen, setAddOpen] = useState(false);
  const [scatterOpen, setScatterOpen] = useState(false);

  const entries = useMemo(() => (project === null ? [] : sceneEntries(project)), [project]);
  const types = useMemo(() => typesInScene(entries), [entries]);
  const filtering = isFiltering(filter);
  const scatterShown = scatterOpen || tool.kind === "scatter";

  const armed =
    tool.kind === "place"
      ? `Placing: ${objectTypeLabel(tool.type)}. Click the map to drop it.`
      : tool.kind === "marker"
        ? "Placing: a marker. Click the map to drop it."
        : tool.kind === "scatter"
          ? "Scatter brush armed. Click the map to set its centre."
          : null;

  return (
    <section className="panel scene-panel" aria-label="Scene">
      <div className="scene-head">
        <h2>Scene</h2>
        <SectorBar />
      </div>

      <div className="scene-search" role="search">
        <input
          type="search"
          aria-label="Search scene"
          placeholder="Search by name, type or id…"
          autoComplete="off"
          spellCheck={false}
          value={filter.query}
          onChange={(e) => setSceneFilter({ query: e.target.value })}
          onKeyDown={(e) => {
            // Escape in the box clears the box; it must not also be the map's Escape (deselect, drop the tool).
            if (e.key === "Escape" && filter.query !== "") {
              e.stopPropagation();
              setSceneFilter({ query: "" });
            }
          }}
        />
        <select
          aria-label="Filter by type"
          value={filter.type}
          onChange={(e) => setSceneFilter({ type: e.target.value })}
        >
          <option value="">All types</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type === "Marker" ? "Marker" : objectTypeLabel(type)}
            </option>
          ))}
        </select>
        {filtering && (
          <button type="button" className="small" onClick={() => setSceneFilter({ query: "", type: "" })}>
            Clear
          </button>
        )}
      </div>

      <div className="scene-tools" role="group" aria-label="Scene tools">
        <button
          type="button"
          aria-expanded={addOpen}
          className={addOpen ? "active" : ""}
          title="Choose what to place on the map"
          onClick={() => setAddOpen(!addOpen)}
        >
          + Add
        </button>
        <button
          type="button"
          aria-expanded={scatterShown}
          className={scatterShown ? "active" : ""}
          disabled={tool.kind === "scatter"}
          title="Scatter a belt, cluster or field of rocks, mines or nebulae"
          onClick={() => setScatterOpen(!scatterOpen)}
        >
          Scatter…
        </button>
      </div>

      {armed !== null && (
        <p className="armed-tool" role="status">
          <span>{armed}</span>
          <button type="button" className="small" onClick={() => setTool({ kind: "select" })}>
            Cancel (Esc)
          </button>
        </p>
      )}
      {tool.kind === "marker" && (
        <label className="marker-sector">
          File the marker under
          <select
            aria-label="Sector for the new marker"
            value={(() => {
              const chosen = markerSector !== undefined && (viewPrefs.sector === null || markerSector === null || markerSector === viewPrefs.sector) ? markerSector : viewPrefs.sector ?? undefined;
              return chosen === undefined ? "" : chosen === null ? "~shared" : chosen;
            })()}
            onChange={(e) => setMarkerSector(e.target.value === "" ? undefined : e.target.value === "~shared" ? null : e.target.value)}
          >
            {viewPrefs.sector === null && markerSector === undefined && (
              <option value="" disabled>
                Choose a sector…
              </option>
            )}
            {(project?.map.sectors ?? [])
              .filter((sector) => viewPrefs.sector === null || sector.id === viewPrefs.sector)
              .map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.label}
                </option>
              ))}
            <option value="~shared">Shared</option>
          </select>
        </label>
      )}
      {addOpen && <AddPalette onChosen={() => setAddOpen(false)} />}
      {scatterShown && <ScatterBrush />}

      <GroupTree />
    </section>
  );
}
