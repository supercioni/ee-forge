import { SPAWNABLE_CLASSES, type SpawnableClass } from "@forge/contracts";
import type { Brush } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";
import { objectTypeLabel } from "../ui/glossary.js";
import { NumberInput } from "../ui/NumberInput.js";

/**
 * What can be added to the scene, and the scatter brush.
 *
 * The palette is exactly the set of classes a scenario can construct —
 * the same list the emitters accept. Missiles and beam effects are absent
 * because EE spawns those itself during combat; offering them would be
 * offering something that cannot be authored.
 *
 * Both are *contextual* (GUI-3): the scene panel shows them only while the author is adding something, so the
 * list of what is in the scene is the first thing on screen rather than a screenful of tools above it.
 */

const SCATTERABLE: readonly SpawnableClass[] = [
  "Asteroid",
  "VisualAsteroid",
  "Mine",
  "Nebula",
];

/**
 * The scatterable types that carry a size. Mines and nebulae have no
 * `size` in the project schema, so offering the control for them would
 * promise a setting the emitter drops on the floor.
 */
const SIZED: readonly SpawnableClass[] = ["Asteroid", "VisualAsteroid"];

/** The grid of things to place. `onChosen` lets the scene panel fold it away once a tool is armed. */
export function AddPalette({ onChosen }: { onChosen?: () => void }): JSX.Element {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const choose = (next: Parameters<typeof setTool>[0]): void => {
    setTool(next);
    onChosen?.();
  };
  return (
    <div className="add-palette">
      <div className="palette-grid" role="group" aria-label="Add to the scene">
        {SPAWNABLE_CLASSES.map((type) => (
          <button
            key={type}
            type="button"
            className={tool.kind === "place" && tool.type === type ? "active" : ""}
            title={`Place a ${objectTypeLabel(type).toLowerCase()} (${type})`}
            onClick={() => choose({ kind: "place", type })}
          >
            {objectTypeLabel(type)}
          </button>
        ))}
        <button
          type="button"
          className={tool.kind === "marker" ? "active" : ""}
          title="A named place. Never spawned in EE — the narrative refers to it, and moving it moves everything that does."
          onClick={() => choose({ kind: "marker" })}
        >
          ⌖ Marker
        </button>
      </div>
      <p className="hint">
        A <strong>marker</strong> is not an EE object: nothing spawns, nothing is visible in game. It is a place the
        narrative can name — point a trigger or an order at it, then move the marker and every record that names it
        follows.
      </p>
    </div>
  );
}

export function ScatterBrush(): JSX.Element {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  // The brush lives in the store, not here: with it armed, the preview on
  // the canvas has to follow every change to these controls.
  const brush = useEditor((s) => s.brush);
  const brushType = useEditor((s) => s.brushType);
  const setBrush = useEditor((s) => s.setBrush);
  const setBrushType = useEditor((s) => s.setBrushType);

  const armed = tool.kind === "scatter";

  return (
    <div className="scatter-brush">
      <p className="hint">
        Arm it, then click the map to set the centre — the outline follows the cursor. Seeded at authoring time: the
        same seed always produces the same scatter, and the generated Lua carries literal coordinates.
      </p>
      <div className="field-row">
        <label>
          Shape
          <select
            value={brush.kind}
            onChange={(e) => setBrush({ kind: e.target.value as Brush["kind"] })}
          >
            <option value="belt">Belt</option>
            <option value="cluster">Cluster</option>
            <option value="field">Field</option>
          </select>
        </label>
        <label>
          Type
          <select
            value={brushType}
            onChange={(e) => setBrushType(e.target.value as SpawnableClass)}
          >
            {SCATTERABLE.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-row">
        <label>
          Count
          <NumberInput
            min={1}
            max={500}
            value={brush.count}
            onChange={(next) => next !== null && setBrush({ count: next })}
          />
        </label>
        <label>
          Radius (GU)
          <NumberInput
            min={500}
            step={500}
            value={brush.radius}
            onChange={(next) => next !== null && setBrush({ radius: next })}
          />
        </label>
      </div>
      {SIZED.includes(brushType) && (
        <>
          <div className="field-row">
            <label>
              Size min
              <NumberInput
                min={1}
                value={brush.sizeRange[0]}
                onChange={(next) =>
                  next !== null && setBrush({ sizeRange: [next, brush.sizeRange[1]] })
                }
              />
            </label>
            <label>
              Size max
              <NumberInput
                min={1}
                value={brush.sizeRange[1]}
                onChange={(next) =>
                  next !== null && setBrush({ sizeRange: [brush.sizeRange[0], next] })
                }
              />
            </label>
          </div>
          <p className="hint">
            Each rock draws its own size from this band, using the same seeded
            RNG that places it. EE puts no bounds on <code>setSize</code>; 110–130
            is the band its own asteroid fields sit in.
          </p>
        </>
      )}
      <label>
        Seed
        <input autoComplete="off" spellCheck={false} value={brush.seed} onChange={(e) => setBrush({ seed: e.target.value })} />
      </label>
      <button
        type="button"
        className={armed ? "active" : "primary"}
        onClick={() => setTool(armed ? { kind: "select" } : { kind: "scatter" })}
      >
        {armed ? "Click the map… (Esc to cancel)" : "Scatter — pick centre on map"}
      </button>
    </div>
  );
}
