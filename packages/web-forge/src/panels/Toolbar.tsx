import { useMemo, useState } from "react";
import { diagnose, vanillaReadiness } from "@forge/core/editor";
import { getDesktop } from "../api/desktop.js";
import { useDesktop } from "../store/desktop.js";
import { useEditor } from "../store/editor.js";
import { VIEW_HINTS, VIEW_LABELS, type ViewId } from "../ui/glossary.js";
import { InstallSelect } from "./DesktopPanels.js";
import { InstallDialog } from "./InstallDialog.js";

/**
 * The header, in two bands that answer two questions.
 *
 *  - **Project bar** — "what am I working on?": which scenario, new/import, save, and the two steps that finish
 *    it: Verify (generate and check, copy nothing) and Export (write files for a chosen engine).
 *  - **View bar** — "where am I working?": Map · Mission · Fleet · Dialogues · DMX, and on the right the
 *    EmptyEpsilon install the scenario can be put into, kept apart from Export on purpose.
 *
 * The DMX rig is a different document (ADR-0040), so in that view the project bar becomes the rig's own bar,
 * with its own save state, instead of offering to save, verify or export a scenario that is not what is on screen.
 * Messages live in the status bar (`StatusBar`), not up here.
 */
export function Toolbar(): JSX.Element {
  const projects = useEditor((s) => s.projects);
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const openProject = useEditor((s) => s.openProject);
  const save = useEditor((s) => s.save);
  const build = useEditor((s) => s.build);
  const setProblemsOpen = useEditor((s) => s.setProblemsOpen);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const newProject = useEditor((s) => s.newProject);
  const eeDir = useEditor((s) => s.eeDir);
  const setEeDir = useEditor((s) => s.setEeDir);
  const rescanLibrary = useEditor((s) => s.rescanLibrary);
  const rig = useEditor((s) => s.rig);
  const rigDirty = useEditor((s) => s.rigDirty);
  const saveRig = useEditor((s) => s.saveRig);
  const desktop = getDesktop() !== null;
  const confirmUnsaved = useDesktop((s) => s.confirmUnsaved);
  const openDialog = useDesktop((s) => s.openDialog);
  const importProject = useDesktop((s) => s.importProject);
  // Does this mission lean on EXODUS, and is it ready to be played without it?
  const readiness = project === null ? null : vanillaReadiness(project);
  // The same count the Problems panel shows: what blocks a vanilla export, one entry per problem.
  const library = useEditor((s) => s.library);
  const vanillaBlockers = useMemo(() => (project === null ? 0 : diagnose(project, { library, mode: "vanilla" }).filter((p) => p.severity === "error").length), [project, library]);

  // Naming a scenario is one field, so it is one field in the toolbar
  // rather than a modal: no overlay, no focus trap, Escape cancels.
  const [naming, setNaming] = useState<string | null>(null);
  // Same idea for the install path: rare enough not to earn permanent
  // toolbar width, common enough that it must not be a CLI command.
  const [install, setInstall] = useState(false);
  const [installing, setInstalling] = useState(false);

  const create = (): void => {
    const name = naming ?? "";
    if (name.trim() === "") return;
    setNaming(null);
    void (async () => {
      if (await confirmUnsaved("create a new scenario")) await newProject(name);
    })();
  };

  const onDmx = view === "dmx";
  const views = Object.keys(VIEW_LABELS) as ViewId[];

  return (
    <header className="toolbar">
      <div className="bar project-bar" role="group" aria-label={onDmx ? "DMX rig" : "Project"}>
        <strong className="brand"><svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true"><path fill="currentColor" d="M2 3h24l-8 9h-8L2 3Zm9 11h6v5l5 6H6l5-6v-5Z" /></svg>FORGE</strong>

        {onDmx ? (
          <>
            <span className="doc-chip" data-testid="dmx-document">
              DMX rig{rig !== null && <span className="muted"> · {rig.label}</span>}
            </span>
            <button type="button" disabled={rig === null || !rigDirty} onClick={() => void saveRig()}>
              Save rig
              {rigDirty && (
                <>
                  <span aria-hidden="true"> •</span>
                  <span className="sr-only"> (unsaved changes)</span>
                </>
              )}
            </button>
            <span className="muted bar-note">
              Not part of any scenario{dirty ? " — the scenario has unsaved changes" : ""}
            </span>
          </>
        ) : naming === null ? (
          <>
            <div className="project-selector">
            <select
              aria-label="Project"
              value={project?.id ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                void (async () => {
                  if (await confirmUnsaved("open another project")) await openProject(id);
                })();
              }}
              disabled={projects.length === 0}
            >
              {projects.length === 0 && <option value="">no projects found</option>}
              {projects.map((summary) => (
                <option key={summary.id} value={summary.id}>
                  {summary.name} ({summary.objectCount} objects)
                </option>
              ))}
            </select>
            <span className="project-caption">Scenario editor{dirty ? " · Unsaved changes" : ""}</span>
            </div>
            <button type="button" title="Start a scenario from scratch" onClick={() => setNaming("")}>
              + New
            </button>
            {desktop && (
              <button type="button" title="Copy a project from a folder into your projects folder; the original is not touched" onClick={() => void importProject("folder")}>
                Import…
              </button>
            )}
            <button type="button" onClick={() => void save()} disabled={project === null || !dirty}>
              Save
              {dirty && (
                <>
                  <span aria-hidden="true"> •</span>
                  <span className="sr-only"> (unsaved changes)</span>
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <input
              autoFocus
              className="new-project"
              aria-label="Scenario name"
              autoComplete="off"
              spellCheck={false}
              placeholder="scenario name"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
                if (e.key === "Escape") setNaming(null);
              }}
            />
            <button type="button" className="primary" disabled={naming.trim() === ""} onClick={create}>
              Create
            </button>
            <button type="button" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </>
        )}

        <span className="bar-spacer" />

        {!onDmx && (
          <>
            {readiness !== null && readiness.exodusActions > 0 && (
              <>
                {readiness.ready ? (
                  <span className="readiness ok">plays without EXODUS</span>
                ) : (
                  <button type="button" className="readiness todo linklike" title="Open the Problems panel: each step still to complete, with a link to it" onClick={() => setProblemsOpen(true)}>
                    {`${vanillaBlockers} thing${vanillaBlockers === 1 ? "" : "s"} to complete for vanilla`}
                  </button>
                )}
                <button
                  type="button"
                  title={
                    readiness.ready
                      ? "Generate and check a scenario that needs nothing of EXODUS"
                      : `Not ready for a vanilla export:\n${readiness.problems.join("\n")}`
                  }
                  onClick={() => void build(false, "vanilla")}
                >
                  Verify vanilla
                </button>
              </>
            )}
            <button
              type="button"
              className="quiet"
              title="Generate the scenario files and check them. Nothing is copied into EmptyEpsilon."
              onClick={() => void build()}
              disabled={project === null}
            >
              Verify
            </button>
            {desktop && (
              <button type="button" className="primary" disabled={project === null} title="Write the scenario as files for EE 2024, 2026 or both" onClick={() => openDialog("export")}>
                Export…
              </button>
            )}
          </>
        )}
        {desktop && (
          <button type="button" title="Projects folder, optional EXODUS extension, compatibility" onClick={() => openDialog("settings")}>
            Settings
          </button>
        )}
      </div>

      <nav className="bar view-bar" aria-label="Views">
        <div className="view-switch">
          {views.map((id) => (
            <button
              key={id}
              type="button"
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              title={VIEW_HINTS[id]}
              onClick={() => setView(id)}
            >
              {VIEW_LABELS[id]}
            </button>
          ))}
        </div>

        <span className="bar-spacer" />

        {!onDmx && (
          <div className="ee-group" role="group" aria-label="EmptyEpsilon install">
            {desktop ? (
              <>
                <InstallSelect value={eeDir} onChange={setEeDir} />
                <button
                  type="button"
                  disabled={project === null || eeDir === ""}
                  title="Check what installing would do, then copy the scenario into the chosen EmptyEpsilon install. Opens the install checks first; nothing is written until you confirm."
                  onClick={() => setInstalling(true)}
                >
                  Install scenario
                </button>
              </>
            ) : install ? (
              <>
                <input
                  className="ee-dir"
                  aria-label="Folder that holds EmptyEpsilon"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  placeholder="Folder that holds EmptyEpsilon"
                  value={eeDir}
                  onChange={(e) => setEeDir(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && eeDir !== "") void rescanLibrary();
                    if (e.key === "Escape") setInstall(false);
                  }}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={eeDir === ""}
                  title="Re-index the install, so textures, templates and models added to EmptyEpsilon turn up in the lists."
                  onClick={() => void rescanLibrary()}
                >
                  Rescan
                </button>
                {/* Installing into the game is the only way a custom hull ever reaches it: EE reads ship
                    templates once, at launch, from scripts/shiptemplates/ — a scenario cannot declare one. */}
                <button
                  type="button"
                  disabled={project === null || eeDir === ""}
                  title="Check what installing would do, then copy the scenario into EmptyEpsilon. Opens the install checks first; nothing is written until you confirm."
                  onClick={() => setInstalling(true)}
                >
                  Install scenario
                </button>
                <button type="button" onClick={() => setInstall(false)}>
                  Done
                </button>
              </>
            ) : (
              <button type="button" title="Where EmptyEpsilon is installed, and re-indexing it." onClick={() => setInstall(true)}>
                Install…
              </button>
            )}
          </div>
        )}
      </nav>
      {installing && <InstallDialog onClose={() => setInstalling(false)} />}
    </header>
  );
}

/**
 * Where the editor talks back: progress, errors, and what a verify or install produced.
 *
 * Both regions stay mounted: a live region only announces text that arrives after it exists. It sits at the
 * bottom of the window, as in other editors, so a long result never pushes the work area down.
 */
export function StatusBar(): JSX.Element {
  const status = useEditor((s) => s.status);
  const error = useEditor((s) => s.error);
  const verification = useEditor((s) => s.verification);
  const setProblemsOpen = useEditor((s) => s.setProblemsOpen);
  return (
    <footer className="statusbar">
      <span role="alert" className="error">
        {error ?? ""}
      </span>
      <span role="status">{error === null ? (status ?? "") : ""}</span>
      <span className="build-summary" role="status">
        {verification !== null && (
          <button type="button" className="linklike" onClick={() => setProblemsOpen(true)} title="Open the Problems panel: the full result, what it was about, and whether it is still current">
            Details in Problems
          </button>
        )}
      </span>
    </footer>
  );
}
