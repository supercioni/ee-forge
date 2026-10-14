import { useState } from "react";
import type { EEDoorDef, EERoomDef, EETemplateDef, ShipSystemName } from "@forge/contracts";
import { useEditor } from "../store/editor.js";

/**
 * Engineering's deck plan.
 *
 * `addRoomSystem(x, y, w, h, system)` is a grid, and a grid is the one
 * thing a table of four numbers is genuinely bad at: overlaps and gaps are
 * invisible in the table and obvious here. Drag to add a room, click a room
 * to give it a system, click an edge to put a door on it — the same arrays
 * the table below edits, seen from above.
 *
 * The colours are the editor's own. EE's engineering screen has its own
 * palette and copying it would suggest a fidelity this preview does not
 * have; what matters here is that two systems never read as one.
 */

const CELL = 26;
const MARGIN = 2;

const SYSTEM_COLOR: Record<ShipSystemName, string> = {
  reactor: "#ef5350",
  beamweapons: "#ffa726",
  missilesystem: "#ffca28",
  maneuver: "#66bb6a",
  impulse: "#26c6da",
  warp: "#7e57c2",
  jumpdrive: "#5c6bc0",
  frontshield: "#42a5f5",
  rearshield: "#29b6f6",
};

const SHORT: Record<ShipSystemName, string> = {
  reactor: "RCT",
  beamweapons: "BEAM",
  missilesystem: "MSL",
  maneuver: "MNV",
  impulse: "IMP",
  warp: "WRP",
  jumpdrive: "JMP",
  frontshield: "FSH",
  rearshield: "RSH",
};

interface Drag {
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
}

export function DeckPlan({
  template,
  readOnly = false,
}: {
  template: EETemplateDef;
  /**
   * A hull read out of the install rather than authored here.
   *
   * `updateTemplate` would ignore the write anyway — the id belongs to no
   * project template — but an invitation to "drag on empty cells" that
   * does nothing is worse than no invitation.
   */
  readOnly?: boolean;
}): JSX.Element {
  const updateTemplate = useEditor((s) => s.updateTemplate);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const rooms = template.rooms;
  const doors = template.doors;

  // The board always shows a ring of empty cells around what exists, so
  // there is somewhere to drag a new room whatever the plan looks like.
  const maxX = Math.max(3, ...rooms.map((r) => r.x + r.width), ...doors.map((d) => d.x + 1));
  const maxY = Math.max(3, ...rooms.map((r) => r.y + r.height), ...doors.map((d) => d.y + 1));
  const minX = Math.min(0, ...rooms.map((r) => r.x), ...doors.map((d) => d.x));
  const minY = Math.min(0, ...rooms.map((r) => r.y), ...doors.map((d) => d.y));
  const cols = maxX - minX + MARGIN;
  const rowsCount = maxY - minY + MARGIN;

  const px = (x: number): number => (x - minX) * CELL;
  const py = (y: number): number => (y - minY) * CELL;

  // Every edit funnels through these two, so gating them here is what
  // makes a stock hull inert — one place rather than a guard on each of
  // the drag, the door click and the room select.
  const setRooms = (next: readonly EERoomDef[]): void => {
    if (readOnly) return;
    updateTemplate(template.id, { rooms: [...next] });
  };
  const setDoors = (next: readonly EEDoorDef[]): void => {
    if (readOnly) return;
    updateTemplate(template.id, { doors: [...next] });
  };

  const roomIndexAt = (x: number, y: number): number =>
    rooms.findIndex(
      (r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height,
    );

  const finishDrag = (): void => {
    if (drag === null) return;
    const x = Math.min(drag.from.x, drag.to.x);
    const y = Math.min(drag.from.y, drag.to.y);
    const width = Math.abs(drag.to.x - drag.from.x) + 1;
    const height = Math.abs(drag.to.y - drag.from.y) + 1;
    setDrag(null);
    setRooms([...rooms, { x, y, width, height, system: null }]);
    setSelected(rooms.length);
  };

  const toggleDoor = (x: number, y: number, horizontal: boolean): void => {
    const at = doors.findIndex((d) => d.x === x && d.y === y && d.horizontal === horizontal);
    setDoors(at === -1 ? [...doors, { x, y, horizontal }] : doors.filter((_, i) => i !== at));
  };

  const coords: { x: number; y: number }[] = [];
  for (let row = 0; row < rowsCount; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      coords.push({ x: minX + col, y: minY + row });
    }
  }

  const preview =
    drag === null
      ? null
      : {
          x: Math.min(drag.from.x, drag.to.x),
          y: Math.min(drag.from.y, drag.to.y),
          width: Math.abs(drag.to.x - drag.from.x) + 1,
          height: Math.abs(drag.to.y - drag.from.y) + 1,
        };

  const selectedRoom = selected === null ? null : rooms[selected] ?? null;

  return (
    <div className="diagram">
      <h3>Deck plan</h3>
      <svg
        viewBox={`0 0 ${cols * CELL} ${rowsCount * CELL}`}
        className="deck"
        onMouseLeave={() => setDrag(null)}
      >
        {coords.map(({ x, y }) => (
          <rect
            key={`c-${x}-${y}`}
            x={px(x)}
            y={py(y)}
            width={CELL}
            height={CELL}
            className="deck-cell"
            onMouseDown={() => {
              const at = roomIndexAt(x, y);
              if (at !== -1) {
                setSelected(at);
                return;
              }
              setDrag({ from: { x, y }, to: { x, y } });
            }}
            onMouseEnter={() => drag !== null && setDrag({ ...drag, to: { x, y } })}
            onMouseUp={finishDrag}
          />
        ))}
        {rooms.map((room, i) => (
          <g key={`r-${i}`}>
            <rect
              x={px(room.x)}
              y={py(room.y)}
              width={room.width * CELL}
              height={room.height * CELL}
              className={`deck-room${i === selected ? " selected" : ""}`}
              fill={room.system === null ? "#2b3240" : SYSTEM_COLOR[room.system]}
              onMouseDown={() => !readOnly && setSelected(i)}
            />
            <text
              x={px(room.x) + (room.width * CELL) / 2}
              y={py(room.y) + (room.height * CELL) / 2 + 4}
              className="deck-label"
              textAnchor="middle"
            >
              {room.system === null ? "" : SHORT[room.system]}
            </text>
          </g>
        ))}
        {preview !== null && (
          <rect
            x={px(preview.x)}
            y={py(preview.y)}
            width={preview.width * CELL}
            height={preview.height * CELL}
            className="deck-preview"
          />
        )}
        {/* Door hotspots: a strip along each cell's top and left edge. */}
        {coords.map(({ x, y }) => {
          return (
            <g key={`e-${x}-${y}`}>
              <rect
                x={px(x) + 4}
                y={py(y) - 3}
                width={CELL - 8}
                height={6}
                className="deck-edge"
                onClick={() => toggleDoor(x, y, true)}
              />
              <rect
                x={px(x) - 3}
                y={py(y) + 4}
                width={6}
                height={CELL - 8}
                className="deck-edge"
                onClick={() => toggleDoor(x, y, false)}
              />
            </g>
          );
        })}
        {doors.map((door, i) =>
          door.horizontal ? (
            <line
              key={`d-${i}`}
              x1={px(door.x) + 3}
              y1={py(door.y)}
              x2={px(door.x) + CELL - 3}
              y2={py(door.y)}
              className="deck-door"
            />
          ) : (
            <line
              key={`d-${i}`}
              x1={px(door.x)}
              y1={py(door.y) + 3}
              x2={px(door.x)}
              y2={py(door.y) + CELL - 3}
              className="deck-door"
            />
          ),
        )}
      </svg>
      {readOnly ? (
        <p className="hint">
          {rooms.length} room(s), {doors.length} door(s) — the plan Engineering gets.
        </p>
      ) : selectedRoom === null ? (
        <p className="hint">Drag on empty cells to add a room. Click an edge to toggle a door. The Rooms and Doors fields below do the same with numbers.</p>
      ) : (
        <div className="deck-controls">
          <select
            value={selectedRoom.system ?? ""}
            onChange={(e) =>
              setRooms(
                rooms.map((r, i) =>
                  i === selected
                    ? {
                        ...r,
                        system:
                          e.target.value === "" ? null : (e.target.value as ShipSystemName),
                      }
                    : r,
                ),
              )
            }
          >
            <option value="">(corridor)</option>
            {(Object.keys(SYSTEM_COLOR) as ShipSystemName[]).map((system) => (
              <option key={system} value={system}>
                {system}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="small danger"
            onClick={() => {
              setRooms(rooms.filter((_, i) => i !== selected));
              setSelected(null);
            }}
          >
            Delete room
          </button>
        </div>
      )}
    </div>
  );
}
