import { useEffect, useMemo, useState } from "react";
import type { EEMapGroup, EEMarker } from "@forge/contracts";
import {
  SHARED_LABEL,
  countsOfSector,
  describeCounts,
  duplicateNames,
  filterScene,
  groupSpawners,
  groupsInView,
  hiddenSelected,
  inSector,
  isFiltering,
  sceneEntries,
  type SceneEntry,
} from "@forge/core/editor";
import { findReferences } from "@forge/core/editor";
import { useEditor, useEffectivePrefs } from "../store/editor.js";
import { Modal } from "../ui/Modal.js";
import { GROUP_WHEN, LOGIC_WORDS, objectTypeLabel } from "../ui/glossary.js";
import { EyeIcon, EyeOffIcon, FlagIcon, IsolateIcon, LockIcon, PencilIcon, UnlockIcon } from "../ui/icons.js";

/**
 * The scene as a tree: every group, with every object in it, always on screen.
 *
 * `on_start` groups are spawned by `map.spawn()` from the scenario's `init()`; `on_call` groups wait for a
 * `spawn_group` action. That split is what lets an enemy wave live in the map while the narrative decides when it
 * arrives — so it is shown, not buried in a field: a solid edge for what is there from the start, a dashed amber one
 * (and a dashed ring on the map) for what a rule brings in, with the rule named underneath.
 *
 * The search only changes what is *listed*. The selection is the store's, by id, and a filter never touches it: when
 * the filter hides something that is selected, the panel says so instead of quietly dropping it from view.
 */
export function GroupTree(): JSX.Element {
  const project = useEditor((s) => s.project);
  const activeGroupId = useEditor((s) => s.activeGroupId);
  const selection = useEditor((s) => s.selection);
  const markerSelection = useEditor((s) => s.markerSelection);
  const filter = useEditor((s) => s.sceneFilter);
  const collapsedGroups = useEditor((s) => s.collapsedGroups);
  const setActiveGroup = useEditor((s) => s.setActiveGroup);
  const updateGroup = useEditor((s) => s.updateGroup);
  const deleteGroup = useEditor((s) => s.deleteGroup);
  const addGroup = useEditor((s) => s.addGroup);
  const select = useEditor((s) => s.select);
  const selectMarkers = useEditor((s) => s.selectMarkers);
  const focusObject = useEditor((s) => s.focusObject);
  const setSceneFilter = useEditor((s) => s.setSceneFilter);
  const toggleGroupCollapsed = useEditor((s) => s.toggleGroupCollapsed);
  const openReference = useEditor((s) => s.openReference);
  const viewPrefs = useEditor((s) => s.viewPrefs);
  const toggleGroupHidden = useEditor((s) => s.toggleGroupHidden);
  const toggleGroupLocked = useEditor((s) => s.toggleGroupLocked);
  const isolateGroup = useEditor((s) => s.isolateGroup);
  const exitIsolation = useEditor((s) => s.exitIsolation);
  const showAllGroups = useEditor((s) => s.showAllGroups);
  const moveGroupToSector = useEditor((s) => s.moveGroupToSector);
  const renameSector = useEditor((s) => s.renameSector);
  const setStartSector = useEditor((s) => s.setStartSector);
  // The list shows the same part of the map the canvas does (every sector while something is being picked).
  const scope = useEffectivePrefs().sector;

  const [newLabel, setNewLabel] = useState("");
  const [newSector, setNewSector] = useState<string | null | undefined>(undefined);
  // A group with objects in it is deleted only after the author says so; this holds the one being asked about.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingSectorDelete, setPendingSectorDelete] = useState<string | null>(null);
  const [foldedSections, setFoldedSections] = useState<readonly string[]>([]);
  const [renaming, setRenaming] = useState<{ id: string; draft: string; error: string | null } | null>(null);

  const entries = useMemo(() => (project === null ? [] : sceneEntries(project)), [project]);
  const visible = useMemo(() => filterScene(entries, filter, objectTypeLabel), [entries, filter]);
  const duplicates = useMemo(() => duplicateNames(entries), [entries]);
  const filtering = isFiltering(filter);
  const shownIds = useMemo(() => new Set(visible.map((e) => `${e.kind}:${e.id}`)), [visible]);

  // A selection made on the map (or by "Used by") is brought into view, and its group opened if it was folded.
  const firstSelected = selection[0];
  useEffect(() => {
    if (firstSelected === undefined || project === null) return;
    const group = project.map.groups.find((g) => g.objects.some((o) => o.id === firstSelected));
    if (group !== undefined) {
      toggleGroupCollapsed(group.id, false);
      const key = group.sector ?? SHARED_KEY;
      setFoldedSections((now) => (now.includes(key) ? now.filter((k) => k !== key) : now));
    }
    const row = document.querySelector(`[data-object-row="${CSS.escape(firstSelected)}"]`);
    row?.scrollIntoView({ block: "nearest" });
    // Only when the selection itself changes: folding a group by hand must stay folded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstSelected]);

  if (project === null) return <section className="panel" />;

  const inView = groupsInView(project, { ...viewPrefs, sector: scope });
  const knownSectors = new Set(project.map.sectors.map((s) => s.id));
  const hiddenObjects = hiddenSelected(selection, visible, "object").length;
  const hiddenMarkers = hiddenSelected(markerSelection, visible, "marker").length;
  const hidden = hiddenObjects + hiddenMarkers;
  const objectCount = inView.reduce((n, g) => n + g.objects.length, 0);
  const shownObjects = visible.filter((e) => e.kind === "object" && inSector(e.sectorId, scope)).length;
  const shownMarkerCount = visible.filter((e) => e.kind === "marker" && inSector(e.sectorId, scope)).length;
  const byId = new Map(entries.filter((e) => e.kind === "object").map((e) => [e.id, e] as const));
  const elsewhere = project.map.groups.length - inView.length;
  const canShowAll = inView.some((g) => viewPrefs.hidden.includes(g.id)) || viewPrefs.isolated !== null;

  const rowLabel = (entry: SceneEntry): string =>
    `${objectTypeLabel(entry.type)} ${entry.name}${duplicates.has(entry.name) ? `, id ${entry.id}, in ${entry.groupLabel ?? "no group"}` : ""}`;

  // --- the sections: Shared, then the sectors in view (all of them under "All sectors"), then anything filed under a sector that is not there
  type Section = { key: string; title: string; sector: string | null | "unknown"; groups: EEMapGroup[]; markers: EEMarker[] };
  const keep = (g: EEMapGroup): boolean => !filtering || g.objects.some((o) => shownIds.has(`object:${o.id}`));
  const keepMarker = (m: EEMarker): boolean => !filtering || shownIds.has(`marker:${m.id}`);
  const make = (key: string, title: string, sector: string | null | "unknown", match: (sector: string | null) => boolean): Section => ({
    key,
    title,
    sector,
    groups: project.map.groups.filter((g) => match(g.sector) && keep(g)),
    markers: project.map.markers.filter((m) => match(m.sector) && keepMarker(m)),
  });
  const sections: Section[] = [make(SHARED_KEY, SHARED_LABEL, null, (sec) => sec === null)];
  for (const sector of project.map.sectors) {
    if (scope === null || scope === sector.id) sections.push(make(sector.id, sector.label, sector.id, (sec) => sec === sector.id));
  }
  if (scope === null) {
    const unknown = make("unknown", "Unknown sector", "unknown", (sec) => sec !== null && !knownSectors.has(sec));
    if (unknown.groups.length > 0 || unknown.markers.length > 0) sections.push(unknown);
  }
  // An empty Shared area takes no room: a group's Sector menu is where it is reached, and it appears here as soon as it holds something.
  const shownSections = sections.filter((section) =>
    section.key === SHARED_KEY ? section.groups.length > 0 || section.markers.length > 0 : !filtering || section.groups.length > 0 || section.markers.length > 0,
  );

  // --- where a new group goes
  const openSector = scope !== null ? project.map.sectors.find((s) => s.id === scope) : undefined;
  const destination: string | null | undefined =
    scope === null ? newSector : newSector !== undefined && (newSector === null || newSector === scope) ? newSector : scope;

  const renderGroup = (group: EEMapGroup): JSX.Element => {
    const folded = !filtering && collapsedGroups.includes(group.id);
    const objects = group.objects.filter((o) => !filtering || shownIds.has(`object:${o.id}`));
    const byRule = group.when === "on_call";
    const spawners = byRule ? groupSpawners(project, group.id) : [];
    const when = GROUP_WHEN.find((w) => w.value === group.when);
    const isolated = viewPrefs.isolated === group.id;
    const isolating = viewPrefs.isolated !== null;
    const hiddenOnMap = isolating ? !isolated : viewPrefs.hidden.includes(group.id);
    const locked = viewPrefs.locked.includes(group.id);
    const dangling = group.sector !== null && !knownSectors.has(group.sector);
    return (
      <li
        key={group.id}
        className={`${group.id === activeGroupId ? "active" : ""} ${byRule ? "by-rule" : "at-start"}${hiddenOnMap ? " off-map" : ""}${locked ? " locked" : ""}${isolated ? " isolated" : ""}`}
        aria-current={group.id === activeGroupId ? "true" : undefined}
        data-group-id={group.id}
      >
        <div
          className="group-head"
          onClick={() => setActiveGroup(group.id)}
          // Reaching a control of the group header with the keyboard makes it the active group, as a click
          // does; the objects below are separate buttons and do not.
          onFocusCapture={() => group.id !== activeGroupId && setActiveGroup(group.id)}
        >
          <button
            type="button"
            className="small disclosure"
            aria-expanded={!folded}
            aria-label={`${folded ? "Show" : "Hide"} objects of ${group.label}`}
            disabled={filtering}
            onClick={(e) => {
              e.stopPropagation();
              toggleGroupCollapsed(group.id);
            }}
          >
            <span aria-hidden="true">{folded ? "▸" : "▾"}</span>
          </button>
          <input
            className="group-label"
            aria-label={`Group name: ${group.label}`}
            title={group.label}
            readOnly={locked}
            value={group.label}
            onChange={(e) => updateGroup(group.id, { label: e.target.value })}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="view-controls" role="group" aria-label={`Map view of group ${group.label}`}>
            <button
              type="button"
              className="small icon-button"
              title={isolating ? "Exit isolation to change visibility" : hiddenOnMap ? "Show group on the map" : "Hide group on the map"}
              aria-label={hiddenOnMap ? `Show group ${group.label}` : `Hide group ${group.label}`}
              disabled={isolating}
              onClick={(e) => {
                e.stopPropagation();
                toggleGroupHidden(group.id);
              }}
            >
              {hiddenOnMap ? <EyeOffIcon /> : <EyeIcon />}
            </button>
            <button
              type="button"
              className={`small icon-button${isolated ? " active" : ""}`}
              aria-pressed={isolated}
              title={isolated ? "Exit isolation: bring back the previous visibility" : "Isolate: show only this group on the map"}
              aria-label={isolated ? `Exit isolation of group ${group.label}` : `Isolate group ${group.label}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isolated) exitIsolation();
                else isolateGroup(group.id);
              }}
            >
              <IsolateIcon />
            </button>
            <button
              type="button"
              className={`small icon-button${locked ? " active" : ""}`}
              aria-pressed={locked}
              title={locked ? "Unlock group: allow changes again" : "Lock group: keep it visible but protect it from changes"}
              aria-label={locked ? `Unlock group ${group.label}` : `Lock group ${group.label}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleGroupLocked(group.id);
              }}
            >
              {locked ? <LockIcon /> : <UnlockIcon />}
            </button>
          </span>
        </div>
        <div className="group-meta" onFocusCapture={() => group.id !== activeGroupId && setActiveGroup(group.id)}>
          <select
            value={group.when}
            title={when?.detail}
            aria-label={`When group ${group.label} appears`}
            disabled={locked}
            onChange={(e) => updateGroup(group.id, { when: e.target.value as "on_start" | "on_call" })}
            onClick={(e) => e.stopPropagation()}
          >
            {GROUP_WHEN.map((w) => (
              <option key={w.value} value={w.value} title={w.detail}>
                {w.label}
              </option>
            ))}
          </select>
          <span className="count" aria-label={`${group.objects.length} objects`}>
            {group.objects.length}
          </span>
          <button
            type="button"
            className="danger small"
            title={locked ? "Unlock the group to delete it" : "Delete group"}
            aria-label={`Delete group ${group.label}`}
            disabled={locked}
            onClick={(e) => {
              e.stopPropagation();
              // An empty group is nothing to lose; one with objects asks first.
              if (group.objects.length === 0) deleteGroup(group.id);
              else setPendingDelete(group.id);
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="group-sector" onFocusCapture={() => group.id !== activeGroupId && setActiveGroup(group.id)}>
          <select
            value={group.sector === null ? SHARED_KEY : group.sector}
            aria-label={`Sector of group ${group.label}`}
            title="Which sector this group is filed under. Moving it changes only where you find it in the editor — not when it appears, its objects, or its rules."
            onChange={(e) => moveGroupToSector(group.id, e.target.value === SHARED_KEY ? null : e.target.value)}
            onClick={(e) => e.stopPropagation()}
          >
            <option value={SHARED_KEY}>{SHARED_LABEL}</option>
            {project.map.sectors.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.label}
              </option>
            ))}
            {dangling && (
              <option value={group.sector ?? ""} disabled>
                {group.sector} (not in this project)
              </option>
            )}
          </select>
        </div>
        {byRule && (
          <p className="spawned-by">
            {spawners.length === 0 ? (
              <span className="warn-line">
                Nothing spawns this group yet — no rule, timed event, GM control, dialogue reply or EXODUS fallback does.
              </span>
            ) : (
              <>
                Spawned by{" "}
                {spawners.map((ref, i) => (
                  <span key={`${ref.owner.kind}-${ref.owner.id}-${"nodeId" in ref.owner ? ref.owner.nodeId : ""}-${i}`}>
                    {i > 0 && ", "}
                    <button type="button" className="row-link" title={`Open ${LOGIC_WORDS[ref.owner.kind].toLowerCase()}`} onClick={() => openReference(ref.owner)}>
                      {LOGIC_WORDS[ref.owner.kind]}: {ref.owner.label}
                    </button>
                  </span>
                ))}
              </>
            )}
          </p>
        )}
        {!folded && objects.length > 0 && (
          <ul className="object-list" aria-label={`Objects in ${group.label}`}>
            {objects.map((object) => {
              const entry = byId.get(object.id);
              if (entry === undefined) return null;
              const isSelected = selection.includes(object.id);
              const dup = duplicates.has(entry.name);
              return (
                <li key={object.id} className={isSelected ? "selected" : ""}>
                  {/* A real button: Tab reaches it, Enter and Space select it, a screen reader says "pressed".
                      Ctrl/⌘ adds or removes it from the selection instead of replacing it. */}
                  <button
                    type="button"
                    className="row-button scene-row"
                    data-object-row={object.id}
                    aria-pressed={isSelected}
                    aria-label={rowLabel(entry)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.ctrlKey || e.metaKey) {
                        select(isSelected ? selection.filter((id) => id !== object.id) : [...selection, object.id]);
                        setActiveGroup(group.id);
                      } else {
                        focusObject(object.id);
                      }
                    }}
                  >
                    <span className="object-type" title={object.type}>
                      {objectTypeLabel(object.type)}
                    </span>
                    <span className="object-callsign">{entry.name}</span>
                    {(entry.name !== object.id || dup) && (
                      <span className="object-id" translate="no">
                        {object.id}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {!folded && objects.length === 0 && !filtering && <p className="hint">Empty group. Add something and click the map.</p>}
      </li>
    );
  };

  const renderMarkers = (section: Section): JSX.Element | null => {
    if (section.markers.length === 0) return null;
    return (
      <>
        <h4 className="scene-subhead">Markers</h4>
        <ul className="object-list marker-list" aria-label={`Markers in ${section.title}`}>
          {section.markers.map((marker) => {
            const isSelected = markerSelection.includes(marker.id);
            return (
              <li key={marker.id} className={isSelected ? "selected" : ""}>
                <button
                  type="button"
                  className="row-button scene-row"
                  data-marker-row={marker.id}
                  aria-pressed={isSelected}
                  aria-label={`Marker ${marker.label || marker.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    select([]);
                    selectMarkers(
                      (e.ctrlKey || e.metaKey) && !isSelected ? [...markerSelection, marker.id] : isSelected && (e.ctrlKey || e.metaKey) ? markerSelection.filter((id) => id !== marker.id) : [marker.id],
                    );
                  }}
                >
                  <span className="object-type">Marker</span>
                  <span className="object-callsign">{marker.label || marker.id}</span>
                  {marker.label !== "" && marker.label !== marker.id && (
                    <span className="object-id" translate="no">
                      {marker.id}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  };

  const commitRename = (): void => {
    if (renaming === null) return;
    const current = project.map.sectors.find((s) => s.id === renaming.id);
    if (current === undefined || renaming.draft.trim() === current.label) {
      setRenaming(null);
      return;
    }
    const problem = renameSector(renaming.id, renaming.draft);
    if (problem === null) setRenaming(null);
    else setRenaming({ ...renaming, error: problem });
  };

  return (
    <div className="scene-tree">
      <div className="scene-count-row">
        <p className="hint scene-count" role="status">
          {filtering
            ? `${shownObjects + shownMarkerCount} match${shownObjects + shownMarkerCount === 1 ? "" : "es"} of ${objectCount + project.map.markers.filter((m) => inSector(m.sector, scope)).length}`
            : `${objectCount} object${objectCount === 1 ? "" : "s"} in ${inView.length} group${inView.length === 1 ? "" : "s"}${elsewhere > 0 ? ` · ${elsewhere} in other sectors` : ""}`}
        </p>
        <button
          type="button"
          className="small"
          disabled={!canShowAll}
          title="Show every group of this view on the map again (does not change the project)"
          onClick={showAllGroups}
        >
          Show all
        </button>
      </div>
      {hidden > 0 && (
        <p className="hint warn-line" role="status">
          {hidden} selected {hidden === 1 ? "item is" : "items are"} hidden by the filter (still selected).{" "}
          <button type="button" className="small" onClick={() => setSceneFilter({ query: "", type: "" })}>
            Clear filter
          </button>
        </p>
      )}
      {filtering && shownSections.length === 0 && (
        <p className="hint">Nothing in the scene matches. Names, ids, types, group and sector names are searched.</p>
      )}

      {shownSections.map((section) => {
        const folded = !filtering && foldedSections.includes(section.key);
        const sector = section.sector !== null && section.sector !== "unknown" ? project.map.sectors.find((s) => s.id === section.sector) : undefined;
        const total = section.groups.reduce((n, g) => n + g.objects.length, 0);
        const isRenaming = sector !== undefined && renaming?.id === sector.id;
        return (
          <section key={section.key} className={`sector-section${section.sector === null ? " shared" : ""}`} aria-label={`${section.title}${section.sector === null ? " (shared by every sector)" : ""}`} data-sector={section.key}>
            <div className="sector-head">
              <button
                type="button"
                className="small disclosure"
                aria-expanded={!folded}
                aria-label={`${folded ? "Show" : "Hide"} contents of ${section.title}`}
                disabled={filtering}
                onClick={() => setFoldedSections(folded ? foldedSections.filter((k) => k !== section.key) : [...foldedSections, section.key])}
              >
                <span aria-hidden="true">{folded ? "▸" : "▾"}</span>
              </button>
              {isRenaming ? (
                <input
                  className="sector-name"
                  aria-label={`New name for sector ${sector.label}`}
                  value={renaming.draft}
                  autoFocus
                  onChange={(e) => setRenaming({ ...renaming, draft: e.target.value, error: null })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                />
              ) : (
                <h3 className="sector-title">{section.title}</h3>
              )}
              <span className="sector-count" title={`${section.groups.length} groups, ${total} objects, ${section.markers.length} markers`}>
                <span aria-hidden="true">{section.groups.length}</span>
                <span className="sr-only">{`${section.groups.length} group${section.groups.length === 1 ? "" : "s"}`}</span>
              </span>
              {sector !== undefined && !isRenaming && (
                <>
                  <button
                    type="button"
                    className={`small icon-button${project.map.startSector === sector.id ? " active" : ""}`}
                    aria-pressed={project.map.startSector === sector.id}
                    aria-label={project.map.startSector === sector.id ? `Clear the starting sector (now ${sector.label})` : `Start the game in ${sector.label}`}
                    title={project.map.startSector === sector.id ? "The game starts here. Click to clear the choice (every At mission start group is created, as before)." : "Start the game in this sector: only its At mission start groups and the Shared ones are created at the start. Needed for Change sector."}
                    onClick={() => setStartSector(project.map.startSector === sector.id ? null : sector.id)}
                  >
                    <FlagIcon />
                  </button>
                  <button type="button" className="small icon-button" aria-label={`Rename sector ${sector.label}`} title="Rename this sector" onClick={() => setRenaming({ id: sector.id, draft: sector.label, error: null })}>
                    <PencilIcon />
                  </button>
                  <button type="button" className="danger small icon-button" aria-label={`Delete sector ${sector.label}`} title="Delete this sector (its groups move somewhere you choose; nothing is deleted with it)" onClick={() => setPendingSectorDelete(sector.id)}>
                    <span aria-hidden="true">×</span>
                  </button>
                </>
              )}
            </div>
            {isRenaming && renaming.error !== null && <p className="hint error" role="alert">{renaming.error}</p>}
            {!folded && (
              <>
                {section.groups.length === 0 && section.markers.length === 0 && !filtering && (
                  <p className="hint">
                    {section.sector === null
                      ? "Nothing shared yet. Use a group's Sector menu to move it here — the player ship usually lives here."
                      : "No groups yet. Add one below, or move one here with its Sector menu."}
                  </p>
                )}
                {section.groups.length > 0 && (
                  <ul className="group-list" aria-label={`Groups in ${section.title}`}>
                    {section.groups.map(renderGroup)}
                  </ul>
                )}
                {renderMarkers(section)}
              </>
            )}
          </section>
        );
      })}

      {pendingDelete !== null && (
        <DeleteGroupDialog
          groupId={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteGroup(pendingDelete);
            setPendingDelete(null);
            // The delete button that opened the question is gone: put the keyboard somewhere that still exists.
            requestAnimationFrame(() => document.querySelector<HTMLElement>('input[aria-label="Search scene"]')?.focus());
          }}
        />
      )}
      {pendingSectorDelete !== null && (
        <DeleteSectorDialog
          sectorId={pendingSectorDelete}
          onClose={() => {
            setPendingSectorDelete(null);
            requestAnimationFrame(() => document.querySelector<HTMLElement>('select[aria-label="Active sector"]')?.focus());
          }}
        />
      )}

      {!filtering && (
        <div className="new-group" role="group" aria-label="New group">
          <input
            aria-label="New group label"
            placeholder="New group label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <select
            aria-label="Sector for the new group"
            value={destination === undefined ? "" : destination === null ? SHARED_KEY : destination}
            onChange={(e) => setNewSector(e.target.value === "" ? undefined : e.target.value === SHARED_KEY ? null : e.target.value)}
          >
            {scope === null && (
              <option value="" disabled>
                Choose a sector…
              </option>
            )}
            {(scope === null ? project.map.sectors : openSector !== undefined ? [openSector] : []).map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.label}
              </option>
            ))}
            <option value={SHARED_KEY}>{SHARED_LABEL}</option>
          </select>
          <button
            type="button"
            disabled={newLabel.trim() === "" || destination === undefined}
            title={destination === undefined ? "Choose which sector (or Shared) the new group goes in" : undefined}
            onClick={() => {
              if (destination === undefined) return;
              addGroup(newLabel.trim(), "on_start", destination);
              setNewLabel("");
            }}
          >
            Add group
          </button>
        </div>
      )}
    </div>
  );
}

const SHARED_KEY = "~shared";

/**
 * Deleting a sector never deletes what is in it. An empty one is just removed; one that holds groups or markers asks
 * where they go (another sector, or Shared), says exactly what moves, and changes nothing until that is chosen.
 */
function DeleteSectorDialog({ sectorId, onClose }: { sectorId: string; onClose: () => void }): JSX.Element | null {
  const project = useEditor((s) => s.project);
  const deleteSector = useEditor((s) => s.deleteSector);
  const [destination, setDestination] = useState<string | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const sector = project?.map.sectors.find((s) => s.id === sectorId);
  if (project === null || project === undefined || sector === undefined) return null;
  const counts = countsOfSector(project, sectorId);
  const empty = counts.groups === 0 && counts.markers === 0;
  const others = project.map.sectors.filter((s) => s.id !== sectorId);
  return (
    <Modal title="Delete sector?" alert onClose={onClose} closeLabel="Close">
      {empty ? (
        <p>
          Delete the empty sector <strong>“{sector.label}”</strong>?
        </p>
      ) : (
        <>
          <p>
            <strong>“{sector.label}”</strong> holds {describeCounts(counts)} ({counts.objects} object{counts.objects === 1 ? "" : "s"}).
            Deleting a sector never deletes them: choose where they go. Their ids, positions, rules and spawn timing stay as they are.
          </p>
          <label>
            Move them to
            <select
              aria-label="Where its contents go"
              value={destination === undefined ? "" : destination === null ? SHARED_KEY : destination}
              onChange={(e) => {
                setProblem(null);
                setDestination(e.target.value === "" ? undefined : e.target.value === SHARED_KEY ? null : e.target.value);
              }}
            >
              <option value="" disabled>
                Choose a place…
              </option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              <option value={SHARED_KEY}>{SHARED_LABEL}</option>
            </select>
          </label>
        </>
      )}
      {problem !== null && <p className="hint error" role="alert">{problem}</p>}
      <div className="field-row">
        <button type="button" className="primary" data-autofocus onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="danger"
          disabled={!empty && destination === undefined}
          onClick={() => {
            const reason = deleteSector(sectorId, destination);
            if (reason === null) onClose();
            else setProblem(reason);
          }}
        >
          {empty ? "Delete sector" : "Move contents and delete sector"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The question before a group with objects in it is deleted: which group, how many objects go with it, and what still
 * points at it. Cancel (the default, and Escape) changes nothing — not the document, not the selection.
 */
function DeleteGroupDialog({ groupId, onCancel, onConfirm }: { groupId: string; onCancel: () => void; onConfirm: () => void }): JSX.Element | null {
  const project = useEditor((s) => s.project);
  const group = project?.map.groups.find((g) => g.id === groupId);
  if (project === undefined || project === null || group === undefined) return null;
  const refs = findReferences(project, "group", groupId);
  const n = group.objects.length;
  return (
    <Modal title="Delete group?" alert onClose={onCancel} closeLabel="Close">
      <p>
        Delete the group <strong>“{group.label}”</strong> and its <strong>{n} object{n === 1 ? "" : "s"}</strong>? This cannot be undone.
      </p>
      {refs.length > 0 && (
        <p className="hint warn-line">
          {refs.length} thing{refs.length === 1 ? "" : "s"} in the mission refer{refs.length === 1 ? "s" : ""} to this group (for example {LOGIC_WORDS[refs[0]!.owner.kind].toLowerCase()} “{refs[0]!.owner.label}”) and will point at nothing.
        </p>
      )}
      <div className="field-row">
        <button type="button" className="primary" data-autofocus onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="danger" onClick={onConfirm}>
          Delete group and {n} object{n === 1 ? "" : "s"}
        </button>
      </div>
    </Modal>
  );
}
