import { useEffect, useMemo, useState } from "react";
import type { EELibrary, ForgeBuildMode, ForgeInstallation } from "@forge/contracts";
import { diagnose, plannedBundle, problemsFor, sortProblems, type Problem } from "@forge/core/editor";
import { fetchLibrarySource } from "../api/client.js";
import { useDesktop } from "../store/desktop.js";
import { useEditor } from "../store/editor.js";
import { Modal } from "../ui/Modal.js";
import { documentLine } from "../ui/verification.js";
import { EvidenceTable } from "./ProblemsDock.js";

const TARGETS = [
  { id: "EE-2024.12.08", label: "EE 2024.12.08" },
  { id: "EE-2026.09.22PR", label: "EE 2026.09.22PR" },
] as const;
type TargetId = (typeof TARGETS)[number]["id"];

interface Scan {
  readonly library: EELibrary | null;
  readonly installation: ForgeInstallation | null;
}

/**
 * Export: choose, read what will happen, then do it.
 *
 * Everything the export will do is on screen before it does it — which engine(s), with or without EXODUS, the
 * folder (chosen first, through the system's own dialog), what in the document blocks it and what only warns,
 * which installation's scan the names were checked against, and the files each engine's bundle will hold. The
 * blocking list and the warnings are the same ones the Problems panel shows, worked out for each engine with
 * that engine's own scan; a blocked engine is not exported and says why, and the others are.
 *
 * After it, three things are kept apart per engine because they are three different facts: the document was
 * *checked* (offline), the files were *generated*, and the scenario was *run in the engine* — which Forge never
 * does here, whatever has been recorded about the demonstration mission.
 */
export function ExportDialog(): JSX.Element {
  const d = useDesktop();
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const revision = useEditor((s) => s.revision);
  const savedRevision = useEditor((s) => s.savedRevision);
  const openProblem = useEditor((s) => s.openProblem);
  const own = project?.eeVersion ?? TARGETS[1].id;
  const [choice, setChoice] = useState<"own" | TargetId | "both">("own");
  const [mode, setMode] = useState<ForgeBuildMode>("vanilla");
  const targets: readonly string[] = choice === "both" ? TARGETS.map((t) => t.id) : [choice === "own" ? own : choice];
  const extension = d.info?.extension;
  const [scans, setScans] = useState<Readonly<Record<string, Scan>>>({});
  const eeDir = useEditor((s) => s.eeDir);
  const installations = useDesktop((s) => s.installations);
  // The installation picked in the toolbar decides its own engine's scan; the other engine uses its newest scan.
  const picked = installations.find((i) => i.id === eeDir) ?? null;

  // Each engine's own scan, asked for once per engine: a scan of one engine is no evidence about the other.
  useEffect(() => {
    let alive = true;
    setScans({});
    for (const target of targets) {
      void fetchLibrarySource(target, picked !== null && picked.target === target ? picked.id : null)
        .then((scan) => alive && setScans((s) => ({ ...s, [target]: scan })))
        .catch(() => alive && setScans((s) => ({ ...s, [target]: { library: null, installation: null } })));
    }
    return () => {
      alive = false;
    };
  }, [targets.join("|"), picked?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const perTarget = useMemo(
    () =>
      targets.map((target) => {
        const scan = scans[target];
        const problems = project === null ? [] : sortProblems(problemsFor(diagnose({ ...project, eeVersion: target }, { library: scan?.library ?? null, mode, extensionAvailable: extension?.loaded === true }), mode));
        return { target, scan: scan ?? null, errors: problems.filter((p) => p.severity === "error"), warnings: problems.filter((p) => p.severity === "warning") };
      }),
    [project, targets.join("|"), scans, mode, extension?.loaded], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (project === null) {
    return (
      <Modal title="Export" onClose={d.closeDialog} wide>
        <p className="hint">Open a project first.</p>
      </Modal>
    );
  }
  const clear = perTarget.filter((t) => t.errors.length === 0);
  const blocked = perTarget.filter((t) => t.errors.length > 0);
  const bundle = plannedBundle(project);
  const meta = d.lastExportMeta;
  const outOfDate = meta !== null && (meta.projectId !== project.id || meta.revision !== revision);

  const go = (p: Problem): void => {
    if (p.where === null) return;
    d.closeDialog();
    openProblem(p.where);
  };

  return (
    <Modal title="Export" onClose={d.closeDialog} wide>
      <p className="hint">
        Exports <strong>{project.name}</strong> as files ready to copy into an EmptyEpsilon install. Nothing is copied into an install by exporting — installing is a separate step with its own checks.
      </p>
      <p className="hint" data-testid="export-version">
        {dirty
          ? `This export will include your unsaved changes (revision ${revision}); they are saved first. ${documentLine({ revision, savedRevision, dirty })}`
          : `This export is of the saved document, revision ${revision}.`}
      </p>

      <div className="export-grid">
        <fieldset>
          <legend>Engine</legend>
          <label>
            <input type="radio" name="target" checked={choice === "own"} onChange={() => setChoice("own")} /> This project’s engine ({own})
          </label>
          {TARGETS.map((t) => (
            <label key={t.id}>
              <input type="radio" name="target" checked={choice === t.id} onChange={() => setChoice(t.id)} /> {t.label}
            </label>
          ))}
          <label>
            <input type="radio" name="target" checked={choice === "both"} onChange={() => setChoice("both")} /> Both — two separate exports, each built for its own engine
          </label>
        </fieldset>
        <fieldset>
          <legend>Content</legend>
          <label>
            <input type="radio" name="mode" checked={mode === "vanilla"} onChange={() => setMode("vanilla")} /> Vanilla — needs nothing of EXODUS
          </label>
          <label title={extension?.loaded ? "" : "Turn the EXODUS extension on in Settings first"}>
            <input type="radio" name="mode" disabled={extension?.loaded !== true} checked={mode === "integrated"} onChange={() => setMode("integrated")} /> With EXODUS — the EXODUS code behind a gate, the vanilla
            alternatives as fallback
            {extension?.loaded !== true && <small> (extension off)</small>}
          </label>
          {project.requires.length > 0 && mode === "vanilla" && (
            <p className="hint">This project uses EXODUS actions; a vanilla export replaces each with the alternative you recorded, and is blocked while any is still undecided.</p>
          )}
        </fieldset>
      </div>

      <h3 className="scene-subhead">Where it goes</h3>
      <div className="field-row" data-testid="export-destination">
        <button type="button" disabled={d.busy} onClick={() => void d.chooseExportFolder()}>
          {d.exportDestination === null ? "Choose folder…" : "Choose another folder…"}
        </button>
        {d.exportDestination === null ? (
          <span className="muted">No folder chosen yet. A folder per engine is created inside it.</span>
        ) : (
          <span>
            <code>{d.exportDestination.path}</code>
          </span>
        )}
      </div>
      {d.message !== null && d.lastExport === null && (
        <p className="hint" role="status">
          {d.message}
        </p>
      )}

      <h3 className="scene-subhead">What will be exported</h3>
      <table className="export-summary" data-testid="export-summary">
        <thead>
          <tr>
            <th>Engine</th>
            <th>Content</th>
            <th>Checked against</th>
            <th>Blocking</th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>
          {perTarget.map((t) => (
            <tr key={t.target} data-target={t.target} className={t.errors.length > 0 ? "blocked" : "clear"}>
              <td>{t.target}</td>
              <td>{mode === "vanilla" ? "Vanilla" : "With EXODUS"}</td>
              <td>
                {t.scan === null ? (
                  "reading…"
                ) : t.scan.library === null ? (
                  <>No scan of this engine — names are <strong>not checked</strong></>
                ) : (
                  <>
                    {t.scan.installation?.label ?? t.scan.library.installPath}
                    <small>
                      {" "}
                      {t.scan.library.scannedAt.slice(0, 10)}
                      {picked !== null && t.scan.installation?.id === picked.id ? " · chosen in the toolbar" : " · newest scan of this engine"}
                    </small>
                  </>
                )}
              </td>
              <td>{t.errors.length === 0 ? "none" : <strong>{t.errors.length} — not exported</strong>}</td>
              <td>{t.warnings.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {perTarget.map((t) =>
        t.errors.length === 0 && t.warnings.length === 0 ? null : (
          <details key={t.target} className="export-problems" open={t.errors.length > 0} data-target={t.target}>
            <summary>
              {t.target}: {t.errors.length} blocking, {t.warnings.length} warning{t.warnings.length === 1 ? "" : "s"}
            </summary>
            <ul className="problem-list">
              {[...t.errors, ...t.warnings].map((p) => (
                <li key={p.id} className={`problem ${p.severity}`} data-severity={p.severity}>
                  <span className="severity">{p.severity === "error" ? "Blocks" : "Warning"}</span>
                  <div>
                    <p className="title">
                      <strong>{p.subject}</strong> — {p.title}
                    </p>
                    <p>{p.message}</p>
                    <p className="action">
                      <em>To fix:</em> {p.action}
                    </p>
                  </div>
                  {p.where !== null && (
                    <button type="button" className="small" aria-label={`Go to ${p.subject}`} onClick={() => go(p)}>
                      Go to it
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ),
      )}
      {mode === "integrated" && (
        <div className="banner warn" data-testid="exodus-warning">
          {perTarget.flatMap((t) => {
            const compat = d.compatibility?.targets.find((c) => c.target === t.target);
            return (compat?.extensions ?? []).filter((x) => x.level !== "engine-tested").map((x) => <div key={`${t.target}-${x.id}`}>{`${compat?.label}: ${x.label} is ${x.level === "incompatible" ? "known incompatible" : x.level === "unverified" ? "not verified" : "checked offline only"} — ${x.note}`}</div>);
          })}
          <div>The export is still produced; do not rely on EXODUS on engines marked above.</div>
        </div>
      )}
      <p className="hint">
        Each engine&apos;s folder will hold: {bundle.map((f) => f.name).join(", ")}
        {bundle.some((f) => f.kind === "shiptemplates") ? " — the templates file loads only when EmptyEpsilon starts" : ""}.
      </p>

      <h3 className="scene-subhead">Evidence</h3>
      <EvidenceTable compat={d.compatibility} target={own} />

      <div className="field-row">
        <button
          type="button"
          className="primary"
          disabled={d.busy || d.exportDestination === null || clear.length === 0}
          title={d.exportDestination === null ? "Choose the folder first" : clear.length === 0 ? "Everything selected is blocked" : ""}
          onClick={() => void d.exportProject(clear.map((t) => t.target), mode)}
        >
          {clear.length === 0 ? "Export" : blocked.length > 0 ? `Export ${clear.length} of ${perTarget.length} (${blocked.length} blocked)` : clear.length === 2 ? "Export both engines" : `Export for ${clear[0]!.target}`}
        </button>
        {d.lastExport !== null && (
          <button type="button" onClick={() => void d.revealExport()}>
            Show in folder
          </button>
        )}
      </div>

      {d.lastExport !== null && (
        <div data-testid="export-result" role="status" className="export-result">
          <p className="hint">
            Wrote to <code>{d.lastExport.outRoot}</code>
            {meta !== null && (
              <>
                {" "}
                — from revision {meta.revision}, {meta.mode === "vanilla" ? "vanilla" : "with EXODUS"}.{" "}
                <span className={outOfDate ? "freshness outdated" : "freshness"}>{outOfDate ? `Out of date: the document is now at revision ${revision}.` : "Current."}</span>
              </>
            )}
          </p>
          {d.lastExport.targets.map((t) => (
            <div key={t.target} className={t.ok ? "export-ok" : "export-failed"} data-target={t.target}>
              <strong>{t.target}</strong> — {t.ok ? `${t.files.length} file(s), ${t.mode === "vanilla" ? "vanilla" : "with EXODUS"}` : "NOT exported"}
              <dl className="facts">
                <dt>Checked</dt>
                <dd>
                  {t.library === null ? "Offline; no scan of this engine, so names taken from the game were not checked." : `Offline, against ${t.library.label} (${t.library.eeVersion}), scanned ${t.library.scannedAt.slice(0, 10)}.`}{" "}
                  {t.warnings.length} warning{t.warnings.length === 1 ? "" : "s"}.
                </dd>
                <dt>Generated</dt>
                <dd>{t.ok ? <>{t.files.map((f) => f.name).join(", ")} in <code>{t.outDir}</code></> : <span className="error" role="alert">{t.error}</span>}</dd>
                <dt>Run in the engine</dt>
                <dd data-testid="not-run">Not run. Forge did not execute this scenario in EmptyEpsilon; only the demonstration mission has been run (see Evidence).</dd>
              </dl>
              {t.warnings.map((w) => (
                <div key={w} className="warn-line">
                  ⚠ {w}
                </div>
              ))}
              {t.needsLaunchInstall && (
                <div className="warn-line" data-testid="launch-items">
                  Loads only at EE launch — templates: {t.launchItems.templates.join(", ") || "none"}; models: {t.launchItems.models.join(", ") || "none"}. Copy scripts/, add the require line, restart EE. (The model files named by a model must already exist in the install.)
                </div>
              )}
            </div>
          ))}
          {d.lastExport.targets.some((t) => !t.ok) && d.lastExport.targets.some((t) => t.ok) && (
            <p className="banner warn" role="alert">
              Only part of the export succeeded: use the folders marked exported, not the whole set.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
