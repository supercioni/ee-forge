import { useMemo, useState } from "react";
import type { ForgeInstallPreview } from "@forge/contracts";
import { diagnose, problemsFor, sortProblems } from "@forge/core/editor";
import { previewInstallOnBridge } from "../api/client.js";
import { getDesktop } from "../api/desktop.js";
import { useDesktop } from "../store/desktop.js";
import { useEditor } from "../store/editor.js";
import { Modal } from "../ui/Modal.js";
import { describeOutcome, documentLine, freshnessOf } from "../ui/verification.js";
import { InstallSelect } from "./DesktopPanels.js";

const ACTION_TEXT: Record<ForgeInstallPreview["files"][number]["action"], string> = {
  create: "New file",
  replace: "Replaces the version EE FORGE installed (backed up first)",
  unchanged: "Already identical — left alone",
  collision: "EXISTS and EE FORGE did not install it (or it was edited since)",
  locked: "HELD OPEN by another program",
};

/**
 * Install the scenario into an EmptyEpsilon installation — a step of its own, never a side effect of exporting.
 *
 * It asks the service for the **preflight first** (nothing is written): which installation and engine, which files
 * are new, which replace one EE FORGE installed, which are someone else's and so need an explicit yes, which a running
 * EmptyEpsilon holds open, whether the `require` line for ship templates is there, and what only exists after EE is
 * restarted. Only then is there a button. Afterwards the result keeps its parts separate — files installed, files
 * already up to date, the error if there was one, the restart — and says "installed" only for a complete install:
 * a refusal, a rollback or a half-undone install is reported as exactly that.
 */
export function InstallDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const project = useEditor((s) => s.project);
  const eeDir = useEditor((s) => s.eeDir);
  const library = useEditor((s) => s.library);
  const libraryInstall = useEditor((s) => s.libraryInstall);
  const dirty = useEditor((s) => s.dirty);
  const revision = useEditor((s) => s.revision);
  const savedRevision = useEditor((s) => s.savedRevision);
  const save = useEditor((s) => s.save);
  const build = useEditor((s) => s.build);
  const openProblem = useEditor((s) => s.openProblem);
  const verification = useEditor((s) => s.verification);
  const installations = useDesktop((s) => s.installations);
  const desktop = getDesktop() !== null;
  const [preview, setPreview] = useState<{ readonly value: ForgeInstallPreview; readonly revision: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<string | null>(null);

  const chosen = installations.find((i) => i.id === eeDir) ?? null;
  const problems = useMemo(
    () => {
      if (project === null) return [];
      const mode = preview?.value.mode ?? "vanilla";
      return sortProblems(problemsFor(diagnose(project, { library, mode }), mode));
    },
    [project, library, preview],
  );
  if (project === null) return <Modal title="Install scenario" onClose={onClose}><p className="hint">Open a project first.</p></Modal>;

  const errors = problems.filter((p) => p.severity === "error");
  const stale = preview !== null && preview.revision !== revision;
  const result = started !== null && verification !== null && verification.kind === "install" && verification.at >= started ? verification : null;

  const check = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    setStarted(null); // a new check starts a new install: the earlier result is not this one's
    try {
      if (dirty) await save();
      if (useEditor.getState().dirty) {
        setFailure("The project could not be saved, so the install was not checked.");
        return;
      }
      const value = await previewInstallOnBridge(project.id, eeDir, null, libraryInstall?.id ?? null);
      setPreview({ value, revision: useEditor.getState().revision });
      setOverwrite(false);
    } catch (error) {
      setPreview(null);
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const p = preview?.value ?? null;
  const canInstall = p !== null && !stale && p.blocked === null && errors.length === 0 && p.locked.length === 0 && (p.collisions.length === 0 || overwrite) && !busy && result === null;

  const install = async (): Promise<void> => {
    setBusy(true);
    setStarted(new Date().toISOString());
    try {
      await build(true, undefined, overwrite);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Install scenario" onClose={onClose} wide>
      <p className="hint">
        Copies the generated scenario into an EmptyEpsilon installation. This is separate from Export: it writes into a game folder, so it checks first, asks before replacing anything EE FORGE did not put there, backs up what it replaces, and puts everything back if it fails.
      </p>
      <p className="hint" data-testid="install-version">
        {documentLine({ revision, savedRevision, dirty })}
      </p>

      {/* The outcome comes first, where it cannot be missed below a long preview. */}
      {result !== null && <InstallResult record={result} onClose={onClose} />}

      <h3 className="scene-subhead">Installation</h3>
      <div className="field-row">
        {desktop ? <InstallSelect value={eeDir} onChange={(id) => useEditor.getState().setEeDir(id)} /> : <code>{eeDir || "no folder chosen"}</code>}
      </div>
      {eeDir === "" ? (
        <p className="hint">Choose an installation first.</p>
      ) : (
        <dl className="facts" data-testid="install-facts">
          <dt>Installation</dt>
          <dd>{chosen === null ? eeDir : `${chosen.label} — ${chosen.target}${chosen.verified ? "" : " (declared, not verified)"}`}</dd>
          {chosen !== null && (
            <>
              <dt>Folder</dt>
              <dd>
                <code>{chosen.path}</code>
              </dd>
            </>
          )}
          <dt>Scenario for</dt>
          <dd>
            {project.eeVersion}
            {chosen !== null && chosen.target !== project.eeVersion && <strong className="error"> — this installation is {chosen.target}: it will be refused</strong>}
          </dd>
          <dt>References checked against</dt>
          <dd>{library === null ? "No scan — names from the game are not checked." : `${libraryInstall?.label ?? library.installPath} (${library.eeVersion}), scanned ${library.scannedAt.slice(0, 10)}`}</dd>
        </dl>
      )}

      <div className="field-row">
        <button type="button" className="primary" disabled={busy || eeDir === ""} onClick={() => void check()}>
          {dirty ? "Save, then check the install" : p === null ? "Check the install" : "Check again"}
        </button>
        {dirty && <span className="muted">The install uses the saved document, so your changes are saved first.</span>}
      </div>
      {failure !== null && (
        <p className="error" role="alert" data-testid="install-failure">
          {failure}
        </p>
      )}

      {errors.length > 0 && (
        <div className="banner warn" role="alert" data-testid="install-problems">
          <strong>The document has {errors.length} blocking problem{errors.length === 1 ? "" : "s"}, so nothing can be generated:</strong>
          <ul>
            {errors.map((e) => (
              <li key={e.id}>
                {e.subject} — {e.title}{" "}
                {e.where !== null && (
                  <button
                    type="button"
                    className="small"
                    aria-label={`Go to ${e.subject}`}
                    onClick={() => {
                      onClose();
                      openProblem(e.where!);
                    }}
                  >
                    Go to it
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p !== null && result === null && (
        <section data-testid="install-preview" aria-label="What the install would do">
          <h3 className="scene-subhead">What it would do</h3>
          {stale && (
            <p className="freshness outdated" role="alert">
              The document changed after this check (revision {preview!.revision} → {revision}). Check again before installing.
            </p>
          )}
          {p.blocked !== null ? (
            <p className="error" role="alert" data-testid="install-blocked">
              Cannot install: {p.blocked}
            </p>
          ) : (
            <>
              <table className="export-summary" aria-label="Files">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {p.files.map((f) => (
                    <tr key={f.path} data-action={f.action} className={f.action === "collision" || f.action === "locked" ? "blocked" : ""}>
                      <td>
                        <code>{f.name}</code>
                        <small>{f.kind === "shiptemplates" ? " ship templates — loads only at launch" : ""}</small>
                      </td>
                      <td>{ACTION_TEXT[f.action]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint" data-testid="require-state">
                {p.requireState === "not-needed" && "No ship templates or models: nothing needs a require line, and EmptyEpsilon need not be restarted."}
                {p.requireState === "present" && `The line ${p.requireLine} is already in shipTemplates.lua.`}
                {p.requireState === "will-add" && `EE FORGE will add ${p.requireLine} to shipTemplates.lua — the one EmptyEpsilon file it edits (backed up first).`}
                {p.requireState === "by-hand" && `You must add ${p.requireLine} to shipTemplates.lua yourself; until then the templates will not load, and the install will be reported as incomplete.`}
                {p.requireState === "no-index" && `shipTemplates.lua was not found; add ${p.requireLine} wherever templates load. The install will be reported as incomplete.`}
              </p>
              {p.needsRestart && (
                <p className="warn-line" data-testid="restart-note">
                  EmptyEpsilon must be restarted before these exist: templates ({project.templates.map((t) => t.name).join(", ") || "none"}); models ({project.models.map((m) => m.name).join(", ") || "none"}).
                </p>
              )}
              {p.locked.length > 0 && (
                <p className="error" role="alert" data-testid="install-locked">
                  Another program holds these files open (for example a running EmptyEpsilon), so nothing can be installed: {p.locked.join(", ")}. Close it and check again.
                </p>
              )}
              {p.collisions.length > 0 && (
                <label className="checkbox" data-testid="overwrite">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Replace the {p.collisions.length} file(s) EE FORGE did not install. Their originals are copied to a backup folder first.
                </label>
              )}
              {p.warnings.map((w) => (
                <p key={w} className="warn-line">
                  ⚠ {w}
                </p>
              ))}
            </>
          )}
        </section>
      )}

      <div className="field-row">
        <button type="button" className="primary" disabled={!canInstall} onClick={() => void install()} data-testid="install-go">
          Install into {chosen?.label ?? "the chosen installation"}
        </button>
        <button type="button" onClick={onClose}>
          {result === null ? "Cancel" : "Close"}
        </button>
      </div>

    </Modal>
  );
}

function InstallResult({ record, onClose }: { record: NonNullable<ReturnType<typeof useEditor.getState>["verification"]>; onClose: () => void }): JSX.Element {
  const revision = useEditor((s) => s.revision);
  const project = useEditor((s) => s.project);
  const outcome = describeOutcome(record);
  const install = record.install;
  const fresh = freshnessOf(record, { projectId: project?.id ?? null, revision });
  void onClose;
  return (
    <section className={`install-result ${outcome.tone}`} data-testid="install-result" data-outcome={record.outcome} role="status">
      <h3 className="scene-subhead">Result</h3>
      <p className={`headline ${outcome.tone}`}>
        <strong>{outcome.headline}</strong>
      </p>
      {fresh === "outdated" && <p className="freshness outdated">The document has changed since (revision {record.revision} → {revision}); this result describes the earlier version.</p>}
      {install === null ? (
        <p className="error" role="alert">
          {record.message ?? "The build did not run."}
        </p>
      ) : (
        <dl className="facts">
          <dt>Installed</dt>
          <dd data-testid="result-installed">{install.installed.length === 0 ? "no files written" : install.installed.map((f) => <div key={f}><code>{f}</code></div>)}</dd>
          <dt>Already up to date</dt>
          <dd>{install.unchanged.length === 0 ? "none" : install.unchanged.map((f) => <div key={f}><code>{f}</code></div>)}</dd>
          <dt>Errors</dt>
          <dd data-testid="result-errors">
            {install.error === null ? "none" : <span className="error">{install.error}</span>}
            {install.collisions.length > 0 && <div>Existing files not installed by EE FORGE: {install.collisions.join(", ")}</div>}
            {install.locked.length > 0 && <div>Held open: {install.locked.join(", ")}</div>}
            {install.restore.unrestored.length > 0 && <div className="error">Could not be put back — restore by hand: {install.restore.unrestored.join(", ")}</div>}
            {install.restore.restored.length > 0 && <div>Put back: {install.restore.restored.length} file(s)</div>}
          </dd>
          <dt>Backup</dt>
          <dd>{install.backupDir === null ? "nothing was replaced, so there is none" : <code>{install.backupDir}</code>}</dd>
          <dt>Restart EmptyEpsilon</dt>
          <dd data-testid="result-restart">
            {install.needsRestart ? `Yes — ${install.restartFiles.length > 0 ? install.restartFiles.map((f) => f.split(/[\\/]/).pop()).join(", ") : "the templates file"} loads only at launch.` : "Not needed."}
          </dd>
          <dt>Require line</dt>
          <dd>{install.requireLine === null ? "not needed" : install.required ? `present: ${install.requireLine}` : `MISSING: add ${install.requireLine} to shipTemplates.lua`}</dd>
        </dl>
      )}
    </section>
  );
}
