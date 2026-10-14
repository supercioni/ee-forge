import { useEffect, useMemo, useState } from "react";
import type { ForgeCompatibility } from "@forge/contracts";
import { diagnose, sortProblems, type Problem } from "@forge/core/editor";
import { fetchCompatibility } from "../api/client.js";
import { useDesktop } from "../store/desktop.js";
import { useEditor } from "../store/editor.js";
import { describeOutcome, documentLine, freshnessLine, freshnessOf } from "../ui/verification.js";

/**
 * The Problems panel: what is wrong with the document, what the last check said, and what has actually been run.
 *
 * Docked under the work area in every view, so a long message never depends on the status bar and a problem can
 * be read while the thing it names is on screen. Three kinds of statement are kept apart on purpose:
 *
 *  - **Problems** are about the document, found offline and always current (`diagnose` re-reads the document on
 *    every edit). Each says how serious it is, what it is about, what that means, what to do, and goes there.
 *  - **Last check** is a record of one Verify or Install: for which revision, which engine and mode, against
 *    which installation's scan. After an edit it says it is out of date instead of staying green.
 *  - **Evidence** is what has been *run in an engine* — recorded separately, because a clean offline check is not
 *    a played game and the demonstration mission being tested is not this scenario being tested.
 */
export function ProblemsDock(): JSX.Element | null {
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const libraryInstall = useEditor((s) => s.libraryInstall);
  const open = useEditor((s) => s.problemsOpen);
  const setOpen = useEditor((s) => s.setProblemsOpen);
  const revision = useEditor((s) => s.revision);
  const savedRevision = useEditor((s) => s.savedRevision);
  const dirty = useEditor((s) => s.dirty);
  const verification = useEditor((s) => s.verification);
  const build = useEditor((s) => s.build);
  const openDialog = useDesktop((s) => s.openDialog);
  const [filter, setFilter] = useState<"all" | "error" | "warning">("all");
  const [compat, setCompat] = useState<ForgeCompatibility | null>(null);

  const problems = useMemo(() => (project === null ? [] : sortProblems(diagnose(project, { library, mode: "vanilla" }))), [project, library]);
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.length - errors;

  // Evidence is asked for once, when the panel is first opened.
  useEffect(() => {
    if (open && compat === null) void fetchCompatibility().then(setCompat).catch(() => undefined);
  }, [open, compat]);

  if (project === null) return null;
  const fresh = verification === null ? null : freshnessOf(verification, { projectId: project.id, revision });
  const shown = problems.filter((p) => filter === "all" || p.severity === filter);
  const outcome = verification === null ? null : describeOutcome(verification);

  return (
    <section className="problems-dock" aria-label="Problems" data-open={open}>
      <button type="button" className="problems-bar" aria-expanded={open} aria-controls="problems-body" onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> Problems
        <span className={`count ${errors > 0 ? "has-errors" : ""}`}>
          {errors} {errors === 1 ? "error" : "errors"}
        </span>
        <span className={`count ${warnings > 0 ? "has-warnings" : ""}`}>
          {warnings} {warnings === 1 ? "warning" : "warnings"}
        </span>
        {verification !== null && outcome !== null && (
          <span className={`last-check ${outcome.tone} ${fresh}`} data-testid="last-check-summary">
            {verification.kind === "install" ? "Install" : "Verify"} {outcome.tone === "ok" ? "passed" : outcome.tone === "partial" ? "incomplete" : "failed"}
            {fresh === "outdated" ? " — out of date" : fresh === "current" ? " — current" : ""}
          </span>
        )}
      </button>
      {open && (
        <div id="problems-body" className="problems-body">
          <div className="problems-context">
            <p>{documentLine({ revision, savedRevision, dirty })}</p>
            <p>
              Checked as <strong>vanilla</strong> (nothing of EXODUS — the baseline every scenario has to reach). An export with EXODUS is checked in the Export dialog.{" "}
              {library === null ? (
                <>
                  No install of {project.eeVersion} is scanned, so names the project takes from the game (factions, templates, models) are <strong>not checked</strong>.{" "}
                  <button type="button" className="small" onClick={() => openDialog("installations")}>
                    Installations…
                  </button>
                </>
              ) : (
                <>
                  References are checked against <strong>{libraryInstall?.label ?? library.installPath}</strong> ({library.eeVersion}, <code>{library.installPath}</code>), scanned {library.scannedAt.slice(0, 10)}.
                </>
              )}
            </p>
          </div>

          <h3>
            Problems in the document
            <span className="filters" role="group" aria-label="Show">
              {(["all", "error", "warning"] as const).map((f) => (
                <button key={f} type="button" className={filter === f ? "active small" : "small"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "error" ? "Errors" : "Warnings"}
                </button>
              ))}
            </span>
          </h3>
          {problems.length === 0 ? (
            <p className="hint" data-testid="no-problems">
              No problems found in the document. This is an offline check of the document; it does not run the scenario.
            </p>
          ) : shown.length === 0 ? (
            <p className="hint">Nothing in this filter.</p>
          ) : (
            <ul className="problem-list" aria-label={`Problems (${problems.length})`}>
              {shown.map((p) => (
                <ProblemRow key={p.id} problem={p} />
              ))}
            </ul>
          )}

          <h3>Last check</h3>
          {verification === null ? (
            <p className="hint">Nothing has been checked since this project was opened. Verify generates the scenario files and checks them; it does not run the game.</p>
          ) : (
            <div className="check-record" data-testid="check-record" data-freshness={fresh}>
              <p className={`headline ${outcome?.tone ?? ""}`}>
                <strong>{verification.kind === "install" ? "Install" : "Verify"}:</strong> {outcome?.headline}
              </p>
              <p className={`freshness ${fresh}`} data-testid="freshness">
                {freshnessLine(fresh ?? "current", verification, { revision })}{" "}
                {fresh === "outdated" && (
                  <button type="button" className="small" onClick={() => void build()}>
                    Verify again
                  </button>
                )}
              </p>
              <dl className="facts">
                <dt>Project</dt>
                <dd>
                  {verification.projectName} — revision {verification.revision}
                </dd>
                <dt>Engine</dt>
                <dd>{verification.target}</dd>
                <dt>Content</dt>
                <dd>{verification.mode === null ? "not decided (the build refused)" : verification.mode === "vanilla" ? "Vanilla — nothing of EXODUS" : "With EXODUS — alternatives as fallback"}</dd>
                <dt>Checked against</dt>
                <dd>
                  {verification.library === null ? (
                    <>No installation scan — references were <strong>not checked</strong>.</>
                  ) : (
                    <>
                      {verification.library.label} ({verification.library.eeVersion}
                      {verification.library.verified ? "" : ", declared, not verified"}), <code>{verification.library.path}</code>, scanned {verification.library.scannedAt.slice(0, 10)}
                    </>
                  )}
                </dd>
                <dt>Run in the engine</dt>
                <dd data-testid="record-not-run">
                  {verification.kind === "install"
                    ? "Not run. The files are in the installation, but Forge has not started EmptyEpsilon or played this scenario."
                    : "Not run. This is generation and an offline check; Forge has not played this scenario in EmptyEpsilon."}
                </dd>
                <dt>When</dt>
                <dd>{verification.at.slice(0, 19).replace("T", " ")} UTC</dd>
              </dl>
              {verification.message !== null && <pre className="long-message">{verification.message}</pre>}
              {verification.files.length > 0 && <p className="muted">Generated: {verification.files.map((f) => f.name).join(", ")}</p>}
              {verification.warnings.map((w) => (
                <p key={w} className="warn-line">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}

          <h3>Evidence — what has been run in an engine</h3>
          <EvidenceTable compat={compat} target={project.eeVersion} />
        </div>
      )}
    </section>
  );
}

function ProblemRow({ problem }: { problem: Problem }): JSX.Element {
  const openProblem = useEditor((s) => s.openProblem);
  return (
    <li className={`problem ${problem.severity}`} data-code={problem.code} data-severity={problem.severity}>
      <span className="severity">{problem.severity === "error" ? "Error" : "Warning"}</span>
      <div>
        <p className="title">
          <strong>{problem.subject}</strong> — {problem.title}
        </p>
        <p>{problem.message}</p>
        <p className="action">
          <em>To fix:</em> {problem.action}
        </p>
      </div>
      {problem.where !== null && (
        <button type="button" className="small" aria-label={`Go to ${problem.subject}`} onClick={() => openProblem(problem.where!)}>
          Go to it
        </button>
      )}
    </li>
  );
}

const LEVEL: Record<string, string> = {
  "engine-tested": "run in a real engine",
  offline: "checked offline only",
  unverified: "not verified",
  incompatible: "known incompatible",
};

/** The compatibility entries, worded so that "the demonstration was run" is never read as "your scenario was run". */
export function EvidenceTable({ compat, target }: { compat: ForgeCompatibility | null; target: string }): JSX.Element {
  if (compat === null) return <p className="hint">Reading the recorded evidence…</p>;
  return (
    <>
      <p className="hint">
        Forge generates a scenario and checks it offline. It does not run your scenario in EmptyEpsilon: <strong>nothing here says this scenario has been played.</strong> The entries below are runs that were recorded, and what they were.
      </p>
      <table className="compat evidence" data-testid="evidence">
        <thead>
          <tr>
            <th>Engine</th>
            <th>Without EXODUS</th>
            <th>With EXODUS</th>
          </tr>
        </thead>
        <tbody>
          {compat.targets.map((t) => (
            <tr key={t.target} className={t.target === target ? "current-target" : ""}>
              <td>
                {t.label}
                {t.target === target ? " (this project)" : ""}
              </td>
              <td>
                <span className={`compat-level ${t.vanilla.level}`}>{t.vanilla.level === "engine-tested" ? "the demonstration mission was run" : LEVEL[t.vanilla.level]}</span>
                <small>{t.vanilla.note}</small>
              </td>
              <td>
                {t.extensions.length === 0 ? (
                  <small>No extension installed — exports are vanilla.</small>
                ) : (
                  t.extensions.map((x) => (
                    <div key={x.id}>
                      <span className={`compat-level ${x.level}`}>{LEVEL[x.level]}</span>
                      <small>
                        {x.label}: {x.note}
                      </small>
                    </div>
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
