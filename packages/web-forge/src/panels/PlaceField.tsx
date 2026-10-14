import type { EEMarker, EEPointRef } from "@forge/contracts";
import { NumberInput } from "../ui/NumberInput.js";

/**
 * One control for "somewhere on the map" (ADR-0038).
 *
 * Shared by the object inspector and the narrative forms, because a place
 * is a place: the wormhole exit, the defend-location order and the
 * proximity trigger all answer the same question, and answering it two
 * different ways in two panels would be the editor disagreeing with
 * itself.
 *
 * Choosing a marker hides the coordinate boxes rather than disabling them.
 * The marker holds the position; showing a second, editable copy would
 * invite an author to change the one that is not used.
 */
export function PlaceField({
  value,
  markers,
  onChange,
  onPick,
}: {
  value: EEPointRef;
  markers: readonly EEMarker[];
  onChange: (next: EEPointRef) => void;
  /** Offered only where the canvas can answer — the narrative forms. */
  onPick?: () => void;
}): JSX.Element {
  const point = value.ref === "point" ? value.position : null;
  const known = value.ref === "marker" && markers.some((m) => m.id === value.markerId);

  return (
    <div className="place-field">
      <select
        value={value.ref === "marker" ? `marker:${value.markerId}` : "point"}
        onChange={(e) => {
          const chosen = e.target.value;
          if (chosen === "point") {
            // Keep the marker's position when switching to coordinates, so
            // "start from where this is" costs nothing.
            const from = markers.find(
              (m) => value.ref === "marker" && m.id === value.markerId,
            );
            onChange({
              ref: "point",
              position: from?.position ?? point ?? { x: 0, y: 0 },
            });
            return;
          }
          onChange({ ref: "marker", markerId: chosen.slice("marker:".length) });
        }}
      >
        <option value="point">Coordinates</option>
        {markers.map((marker) => (
          <option key={marker.id} value={`marker:${marker.id}`}>
            {marker.label} ({marker.id})
          </option>
        ))}
        {value.ref === "marker" && !known && (
          // A marker that was deleted out from under this record. Kept in
          // the list so the field shows what it is pointing at instead of
          // silently snapping to something else.
          <option value={`marker:${value.markerId}`}>{value.markerId} — missing</option>
        )}
      </select>

      {point !== null && (
        <div className="vec2">
          <NumberInput
            value={point.x}
            step={100}
            onChange={(x) => x !== null && onChange({ ref: "point", position: { ...point, x } })}
          />
          <NumberInput
            value={point.y}
            step={100}
            onChange={(y) => y !== null && onChange({ ref: "point", position: { ...point, y } })}
          />
          {onPick !== undefined && (
            <button aria-label="Choose the place on the map" type="button" className="small" title="Choose it on the map" onClick={onPick}>
              <span aria-hidden="true">⌖</span>
            </button>
          )}
        </div>
      )}

      {value.ref === "marker" && !known && (
        <p className="hint error">
          This marker no longer exists. The build will refuse it until you recreate it or
          switch to coordinates.
        </p>
      )}
    </div>
  );
}
