import type { EEAction, EEPredicate } from "@forge/contracts";
import {
  ACTION_SPECS,
  PREDICATE_SPECS,
  emptyAction,
  emptyPredicate,
  isExodusAction,
  type ActionKind,
  type LogicKindSpec,
  type LogicPath,
  type PredicateKind,
} from "@forge/core/editor";
import { useEditor } from "../store/editor.js";
import { LogicField } from "./LogicField.js";

/**
 * The editor for one predicate or one action.
 *
 * A kind picker plus the fields that kind declares — nothing more. Both
 * record types are edited the same way because they are the same shape of
 * thing: a tag and its own fields.
 *
 * Changing the kind **replaces** the record rather than merging into it.
 * Merging would leave the previous kind's keys behind, and the union would
 * refuse the result at save time, long after the mistake.
 */
export function LogicRecordEditor({
  record,
  path,
  onChange,
  vanillaOnly = false,
  label,
}: {
  record: EEPredicate | EEAction;
  path: LogicPath;
  onChange: (record: EEPredicate | EEAction) => void;
  /** Hide the EXODUS kinds: this record lives inside an EXODUS step's alternative. */
  vanillaOnly?: boolean;
  /** What this record is for ("When", "Guard 2"), as the kind picker's accessible name. */
  label?: string;
}): JSX.Element {
  const project = useEditor((s) => s.project);
  const isAction = ACTION_SPECS.some((s) => s.kind === record.kind);
  const specs: readonly LogicKindSpec<string>[] = isAction ? ACTION_SPECS : PREDICATE_SPECS;
  const spec = specs.find((s) => s.kind === record.kind);
  const exodusReady = project?.requires.includes("exodus") === true;

  const defaults = {
    objectId: project?.map.groups.flatMap((g) => g.objects)[0]?.id,
    groupId: project?.map.groups[0]?.id,
    zoneId: project?.map.groups.flatMap((g) => g.objects).find((o) => o.type === "Zone")?.id,
  };

  const grouped = new Map<string, LogicKindSpec<string>[]>();
  for (const candidate of specs) {
    if (vanillaOnly && isAction && isExodusAction(candidate.kind as ActionKind)) continue;
    grouped.set(candidate.group, [...(grouped.get(candidate.group) ?? []), candidate]);
  }

  const values = record as unknown as Record<string, unknown>;

  return (
    <div className="logic-record">
      <select
        aria-label={label ?? (isAction ? "Action type" : "Condition type")}
        value={record.kind}
        onChange={(e) => {
          const kind = e.target.value;
          onChange(
            isAction
              ? emptyAction(kind as ActionKind, defaults)
              : emptyPredicate(kind as PredicateKind, defaults),
          );
        }}
      >
        {[...grouped.entries()].map(([group, entries]) => (
          <optgroup key={group} label={group}>
            {entries.map((entry) => (
              <option
                key={entry.kind}
                value={entry.kind}
                // The build refuses these without the tier; saying so here
                // is cheaper than saying it at build time.
                disabled={isAction && isExodusAction(entry.kind as ActionKind) && !exodusReady}
              >
                {entry.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {spec?.hint !== undefined && <p className="hint">{spec.hint}</p>}

      {(spec?.fields ?? []).map((field) => (
        <label key={field.key} className="logic-field">
          <span>{field.label}</span>
          <LogicField
            spec={field}
            value={values[field.key]}
            path={path}
            record={values}
            onChange={(value) => {
              const next = { ...record, [field.key]: value } as Record<string, unknown>;
              // Another destination: the arrival marker has to be one of ITS markers, so it is cleared rather than left pointing elsewhere.
              if (record.kind === "change_sector" && field.key === "sectorId") {
                const first = project?.map.markers.find((m) => m.sector === value);
                next["arrivalMarkerId"] = first?.id ?? "unset";
              }
              onChange(next as unknown as EEPredicate | EEAction);
            }}
          />
        </label>
      ))}
    </div>
  );
}
