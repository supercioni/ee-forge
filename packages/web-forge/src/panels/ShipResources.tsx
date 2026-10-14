import { useState } from "react";
import type { EELibrary, EETemplateDef } from "@forge/contracts";
import { describeTemplateResources, type ResourceReport, type ResourceState } from "@forge/core/editor";
import { assetUrl } from "../api/transport.js";
import { useEditor } from "../store/editor.js";

/**
 * What the hull needs from outside the project, one line each.
 *
 * The words come from `describeTemplateResources` / `describePreview`: found (and in which file of which
 * install), not found in a scan that ran, not checkable because no scan exists, a stand-in that is not this
 * hull. The state is written out and not only coloured, and nothing here edits the template — a name that is
 * not found stays in the form, marked, exactly as the project holds it.
 */
const STATE_WORD: Record<ResourceState, string> = {
  available: "Found",
  missing: "Not found",
  unverified: "Not checked",
  generic: "Stand-in",
  "other-source": "Other source",
};

export function ResourceLine({ report }: { report: ResourceReport }): JSX.Element {
  return (
    <div className="resource-line" data-state={report.state} data-resource={report.kind}>
      <span className={`resource-state ${report.state}`}>{STATE_WORD[report.state]}</span>
      <div>
        <p>
          {report.name !== null && report.kind !== "preview" && <strong>{report.label}: </strong>}
          {report.summary}
        </p>
        {report.source !== null && (
          <p className="muted">
            Source: <code>{report.source}</code>
          </p>
        )}
        {report.action !== null && <p className="resource-action">{report.action}</p>}
      </div>
    </div>
  );
}

/** The radar trace's image, only when it loads — a broken-image icon says nothing a sentence does not. */
function TraceImage({ trace }: { trace: string }): JSX.Element | null {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  const path = trace.startsWith("radar/") ? trace : `radar/${trace}`;
  return <img className="trace-thumb" src={assetUrl(path)} alt={`Radar trace ${trace}`} width={48} height={48} onError={() => setBroken(true)} />;
}

export function ShipResources({
  template,
  library,
  target,
  ownModels = true,
}: {
  template: Pick<EETemplateDef, "name" | "model" | "radarTrace">;
  library: EELibrary | null;
  target: string;
  /** False for an original ship: its model is the install's, whatever the project defines. */
  ownModels?: boolean;
}): JSX.Element {
  const models = useEditor((s) => s.project?.models ?? []);
  const installation = useEditor((s) => s.libraryInstall);
  const installLabel = installation?.label;
  const reports = describeTemplateResources(template, { projectModels: ownModels ? models.map((m) => m.name) : [], library, target, ...(installLabel !== undefined ? { installLabel } : {}) });
  const where = library === null ? `No install of ${target} is scanned.` : `Checked against ${installLabel ?? `the ${library.eeVersion} install`} (${library.eeVersion}), scanned ${library.scannedAt.slice(0, 10)}, folder ${library.installPath}.`;
  return (
    <div className="diagram resources" data-testid="ship-resources">
      <h3>Resources</h3>
      <p className="hint">{where}</p>
      {reports.map((report) => (
        <div key={report.kind} className="resource-row">
          <ResourceLine report={report} />
          {report.kind === "radarTrace" && report.state === "available" && template.radarTrace !== null && <TraceImage trace={template.radarTrace} />}
        </div>
      ))}
    </div>
  );
}
