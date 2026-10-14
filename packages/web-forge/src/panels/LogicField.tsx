import type { EEPointRef, EETargetRef, Vec2 } from "@forge/contracts";
import { blankPlace, isUnsetRef, type LogicFieldSpec, type LogicPath } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";
import { NumberInput } from "../ui/NumberInput.js";
import { ExodusStepField } from "./ExodusStepField.js";
import { PlaceField } from "./PlaceField.js";

/**
 * One control of a narrative form, rendered from its descriptor.
 *
 * This component knows widgets, not meaning: which kinds exist and which
 * fields they carry is the toolkit's business (`logic-forms.ts`), and a
 * test there asserts the descriptors cover the whole schema. So a
 * predicate added to the model becomes authorable without touching this
 * file — which is the point of rendering from data.
 *
 * References to the map are pickers, never text boxes. An author choosing
 * "that station over there" should click it; typing `station_04` correctly
 * is not a skill worth demanding, and a typo becomes a build error much
 * later.
 */
export function LogicField({
  spec,
  value,
  path,
  record,
  onChange,
}: {
  spec: LogicFieldSpec;
  value: unknown;
  /** Where this field lives, so the map can answer a pick for it. */
  path: LogicPath;
  /** The whole record the field belongs to, for a field whose choices depend on a sibling (an arrival marker on its sector). */
  record?: Record<string, unknown>;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const project = useEditor((s) => s.project);
  const requestPick = useEditor((s) => s.requestPick);

  const objects = (project?.map.groups ?? []).flatMap((g) => g.objects);
  const groups = project?.map.groups ?? [];
  const zones = objects.filter((o) => o.type === "Zone");
  const markers = project?.map.markers ?? [];
  const dialogues = project?.logic.dialogues ?? [];

  const objectLabel = (id: string): string => {
    const object = objects.find((o) => o.id === id);
    if (object === undefined) return isUnsetRef(id) ? "(pick one)" : `${id} (missing)`;
    return object.callsign === null ? `${object.id} · ${object.type}` : object.callsign;
  };

  switch (spec.widget) {
    case "exodusStep":
      return (
        <ExodusStepField
          value={value}
          onChange={(stepId) => onChange(stepId)}
        />
      );

    case "text":
      return (
        <input aria-label={spec.label}
          value={typeof value === "string" ? value : ""}
          placeholder={spec.nullable === true ? "(unset)" : ""}
          onChange={(e) =>
            onChange(e.target.value === "" && spec.nullable === true ? null : e.target.value)
          }
        />
      );

    case "textarea":
      return (
        <textarea aria-label={spec.label}
          rows={2}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "number":
    case "seconds":
      return (
        <NumberInput label={spec.label}
          value={typeof value === "number" ? value : null}
          nullable={spec.nullable === true}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={onChange}
        />
      );

    case "boolean":
      return (
        <input aria-label={spec.label} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      );

    case "select":
      return (
        <select aria-label={spec.label} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
          {(spec.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );

    case "groupRef":
      return (
        <select aria-label={spec.label} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
          {typeof value === "string" && isUnsetRef(value) && <option value={value}>(pick one)</option>}
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.label} {group.when === "on_call" ? "· on call" : ""}
            </option>
          ))}
        </select>
      );

    case "sectorRef": {
      const id = typeof value === "string" ? value : "";
      const sectors = project?.map.sectors ?? [];
      return (
        <select aria-label={spec.label} value={id} onChange={(e) => onChange(e.target.value)}>
          {isUnsetRef(id) && <option value={id}>(pick one)</option>}
          {!isUnsetRef(id) && !sectors.some((s) => s.id === id) && <option value={id}>{id} (missing)</option>}
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.label}
              {project?.map.startSector === sector.id ? " · start" : ""}
            </option>
          ))}
        </select>
      );
    }

    case "arrivalMarker": {
      const id = typeof value === "string" ? value : "";
      const destination = typeof record?.["sectorId"] === "string" ? (record["sectorId"] as string) : "";
      const inDestination = markers.filter((m) => m.sector === destination);
      return (
        <div className="ref-field">
          <select aria-label={spec.label} value={id} onChange={(e) => onChange(e.target.value)}>
            {isUnsetRef(id) && <option value={id}>(pick one)</option>}
            {!isUnsetRef(id) && !inDestination.some((m) => m.id === id) && (
              <option value={id}>
                {id} {markers.some((m) => m.id === id) ? "— not in the destination sector" : "— missing"}
              </option>
            )}
            {inDestination.map((marker) => (
              <option key={marker.id} value={marker.id}>
                {marker.label} ({marker.id})
              </option>
            ))}
          </select>
          {inDestination.length === 0 && (
            <p className="hint error">
              {isUnsetRef(destination) ? "Choose the destination sector first." : "That sector has no marker yet: open it on the Map and place one (⌖ Marker) — the ship arrives there."}
            </p>
          )}
        </div>
      );
    }

    case "objectRef":
    case "zoneRef": {
      const candidates = spec.widget === "zoneRef" ? zones : objects;
      const id = typeof value === "string" ? value : "";
      return (
        <div className="ref-field">
          <select aria-label={spec.label} value={id} onChange={(e) => onChange(e.target.value)}>
            {isUnsetRef(id) && <option value={id}>(pick one)</option>}
            {!isUnsetRef(id) && candidates.every((o) => o.id !== id) && (
              <option value={id}>{objectLabel(id)}</option>
            )}
            {candidates.map((object) => (
              <option key={object.id} value={object.id}>
                {objectLabel(object.id)}
              </option>
            ))}
          </select>
          <button aria-label={`Choose “${spec.label}” on the map`}
            type="button"
            className="small"
            title="Choose it on the map"
            onClick={() =>
              requestPick({
                want: spec.widget === "zoneRef" ? "zone" : "object",
                path,
                key: spec.key,
                prompt: `Click ${spec.widget === "zoneRef" ? "a zone" : "an object"} for “${spec.label}”`,
              })
            }
          >
            <span aria-hidden="true">⌖</span>
          </button>
        </div>
      );
    }

    case "dialogueRef": {
      const id = typeof value === "string" ? value : "";
      return (
        <select aria-label={spec.label}
          value={id}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">(none — restore EE's own comms)</option>
          {dialogues.map((dialogue) => (
            <option key={dialogue.id} value={dialogue.id}>
              {dialogue.label}
            </option>
          ))}
          {id !== "" && !dialogues.some((d) => d.id === id) && (
            <option value={id}>{id} — missing</option>
          )}
        </select>
      );
    }
    case "point": {
      // `order_fly_formation.offset` is a displacement from a leader, not a
      // place, so it stays raw coordinates — a marker there would read as a
      // destination and quietly mean something else (ADR-0038).
      if (spec.key === "offset") {
        const offset = (value ?? { x: 0, y: 0 }) as Vec2;
        return (
          <div className="vec2">
            <NumberInput label={spec.label}
              value={offset.x}
              step={100}
              onChange={(x) => x !== null && onChange({ ...offset, x })}
            />
            <NumberInput label={spec.label}
              value={offset.y}
              step={100}
              onChange={(y) => y !== null && onChange({ ...offset, y })}
            />
          </div>
        );
      }
      return (
        <PlaceField
          value={(value ?? blankPlace()) as EEPointRef}
          markers={markers}
          onChange={onChange}
          onPick={() =>
            requestPick({
              want: "point",
              path,
              key: spec.key,
              prompt: `Click a point for “${spec.label}”`,
            })
          }
        />
      );
    }

    case "target": {
      const target = (value ?? { ref: "player" }) as EETargetRef;
      return (
        <div className="ref-field">
          <select aria-label={spec.label}
            value={target.ref}
            onChange={(e) => {
              const ref = e.target.value as EETargetRef["ref"];
              onChange(
                ref === "player"
                  ? { ref: "player" }
                  : ref === "object"
                    ? { ref: "object", objectId: objects[0]?.id ?? "unset" }
                    : { ref: "group", groupId: groups[0]?.id ?? "unset" },
              );
            }}
          >
            <option value="player">Player ship</option>
            <option value="object">Object</option>
            <option value="group">Group</option>
          </select>

          {target.ref === "object" && (
            <>
              <select aria-label={spec.label}
                value={target.objectId}
                onChange={(e) => onChange({ ref: "object", objectId: e.target.value })}
              >
                {isUnsetRef(target.objectId) && <option value={target.objectId}>(pick one)</option>}
                {objects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {objectLabel(object.id)}
                  </option>
                ))}
              </select>
              <button aria-label={`Choose “${spec.label}” on the map`}
                type="button"
                className="small"
                title="Choose it on the map"
                onClick={() =>
                  requestPick({
                    want: "object",
                    path,
                    key: spec.key,
                    prompt: `Click the target for “${spec.label}”`,
                  })
                }
              >
                <span aria-hidden="true">⌖</span>
              </button>
            </>
          )}

          {target.ref === "group" && (
            <select aria-label={spec.label}
              value={target.groupId}
              onChange={(e) => onChange({ ref: "group", groupId: e.target.value })}
            >
              {isUnsetRef(target.groupId) && <option value={target.groupId}>(pick one)</option>}
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    }

    case "variableValue": {
      // One box for a value that may be a string, a number or a flag: the
      // schema allows all three, so the control offers the type as well.
      const kind = typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "text";
      return (
        <div className="ref-field">
          <select
            aria-label={`${spec.label}: type`}
            value={kind}
            onChange={(e) =>
              onChange(
                e.target.value === "number" ? 0 : e.target.value === "boolean" ? true : "",
              )
            }
          >
            <option value="number">number</option>
            <option value="text">text</option>
            <option value="boolean">flag</option>
          </select>
          {kind === "number" ? (
            <NumberInput label={spec.label}
              value={typeof value === "number" ? value : 0}
              onChange={(next) => next !== null && onChange(next)}
            />
          ) : kind === "boolean" ? (
            <input aria-label={spec.label}
              type="checkbox"
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
            />
          ) : (
            <input aria-label={spec.label}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      );
    }

    case "variableName": {
      // Free text with the project's own names offered: variables are
      // declared on objects, so the ones that exist are worth suggesting —
      // but a rule may legitimately name one before it is declared.
      const declared = [
        ...new Set(objects.flatMap((object) => object.variables.map((v) => v.name))),
      ].sort();
      return (
        <>
          <input aria-label={spec.label}
            list="forge-object-variables"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          />
          <datalist id="forge-object-variables">
            {declared.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      );
    }

    case "json":
      return (
        <JsonField
          value={value}
          onChange={onChange}
        />
      );
  }
}

/**
 * A free-form JSON payload, kept as text while it is being typed.
 *
 * Same rule as the numeric fields: half-written input is a normal state,
 * and coercing it on every keystroke would make the field unusable. The
 * document only ever receives objects that parse.
 */
function JsonField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const text = JSON.stringify(value ?? {}, null, 1);
  return (
    <textarea
      aria-label="Payload (JSON)"
      rows={3}
      defaultValue={text}
      spellCheck={false}
      onChange={(e) => {
        try {
          const parsed: unknown = JSON.parse(e.target.value);
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            onChange(parsed);
            e.target.setCustomValidity("");
          } else {
            e.target.setCustomValidity("payload must be an object");
          }
        } catch {
          e.target.setCustomValidity("not valid JSON yet");
        }
      }}
    />
  );
}
