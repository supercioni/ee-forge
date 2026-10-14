import { useEffect, useState } from "react";
import type { ForgeCompatLevel } from "@forge/contracts";
import { getDesktop } from "../api/desktop.js";
import { useDesktop } from "../store/desktop.js";
import { useEditor } from "../store/editor.js";
import { Modal } from "../ui/Modal.js";
import { ExportDialog } from "./ExportDialog.js";

/**
 * Desktop-only dialogs: installations, export, settings, and the unsaved-changes question.
 * They are in-page dialogs built on the shared `Modal` (focus goes in and stays in, the editor behind is inert,
 * Escape is Cancel, focus returns to the opener); every file or folder choice is made in the operating
 * system's own dialog, opened by the shell.
 */

const LEVEL_TEXT: Readonly<Record<ForgeCompatLevel, string>> = {
  "engine-tested": "run in a real engine (the demonstration mission)",
  offline: "checked offline only",
  unverified: "not verified",
  incompatible: "known incompatible",
};

function Level({ level, note }: { level: ForgeCompatLevel; note?: string }): JSX.Element {
  return (
    <span className={`compat-level ${level}`} {...(note !== undefined ? { title: note } : {})}>
      {LEVEL_TEXT[level]}
    </span>
  );
}

/** The compatibility matrix: what has been shown to work, per engine, vanilla and EXODUS apart. */
function CompatTable(): JSX.Element | null {
  const compat = useDesktop((s) => s.compatibility);
  if (compat === null) return null;
  return (
    <table className="compat">
      <thead>
        <tr>
          <th>Engine</th>
          <th>Vanilla export</th>
          <th>With EXODUS</th>
        </tr>
      </thead>
      <tbody>
        {compat.targets.map((t) => (
          <tr key={t.target} data-target={t.target}>
            <td>{t.label}</td>
            <td>
              <Level level={t.vanilla.level} />
              <small>{t.vanilla.note}</small>
            </td>
            <td>
              {t.extensions.length === 0 ? (
                <small>Not installed — vanilla exports only.</small>
              ) : (
                t.extensions.map((x) => (
                  <div key={x.id}>
                    <Level level={x.level} />
                    <small>{x.note}</small>
                  </div>
                ))
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InstallationsDialog(): JSX.Element {
  const d = useDesktop();
  const eeDir = useEditor((s) => s.eeDir);
  const [declared, setDeclared] = useState("EE-2026.09.22PR");
  return (
    <Modal title="EmptyEpsilon installations" onClose={d.closeDialog} wide>
      <p className="hint">
        Register the folders where EmptyEpsilon is installed. Forge only reads them to index textures, templates and
        models — and writes into one only when you ask to install a build. Two installs (2024 and 2026) never share
        a library or an image cache.
      </p>
      <table className="installs">
        <tbody>
          {d.installations.length === 0 && (
            <tr>
              <td className="hint">No installation registered yet.</td>
            </tr>
          )}
          {d.installations.map((i) => (
            <tr key={i.id} data-install={i.id}>
              <td>
                <label>
                  <input type="radio" name="install" aria-label={`Use ${i.label}`} checked={eeDir === i.id} onChange={() => d.selectInstallation(i.id)} /> use
                </label>
              </td>
              <td>
                <strong>{i.label}</strong>
                <br />
                <small>{i.path}</small>
              </td>
              <td>
                {i.target} <span className={i.verified ? "ok" : "warn"}>{i.verified ? "verified" : "declared, not verified"}</span>
                <br />
                <small>{i.scannedAt === null ? "not scanned yet" : `scanned ${i.scannedAt.slice(0, 19).replace("T", " ")}`}</small>
              </td>
              <td className="actions">
                <button type="button" aria-label={`Rescan ${i.label}`} disabled={d.busy} onClick={() => void d.rescan(i.id)}>
                  Rescan
                </button>
                <button type="button" className="danger" aria-label={`Forget ${i.label}`} onClick={() => void d.remove(i.id)}>
                  Forget
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="field-row">
        <button type="button" className="primary" disabled={d.busy} onClick={() => void d.addInstallation()}>
          Add EmptyEpsilon folder…
        </button>
      </div>
      {d.pendingInstall !== null && (
        <div className="banner warn" data-testid="declare-install" role="status">
          {d.pendingInstall.message}
          <div className="field-row">
            <select aria-label="Declared engine version" value={declared} onChange={(e) => setDeclared(e.target.value)}>
              <option value="EE-2024.12.08">EE 2024.12.08</option>
              <option value="EE-2026.09.22PR">EE 2026.09.22PR</option>
            </select>
            <button type="button" onClick={() => void d.declareInstallation(declared)}>
              Register as declared (not verified)
            </button>
          </div>
        </div>
      )}
      {d.message !== null && <p className="hint" role="status">{d.message}</p>}
    </Modal>
  );
}

function SettingsDialog(): JSX.Element {
  const d = useDesktop();
  const info = d.info;
  const ext = info?.extension;
  return (
    <Modal title="Settings" onClose={d.closeDialog} wide>
      <section>
        <h3>Where your work lives</h3>
        <p>
          Projects: <code data-testid="projects-dir">{info?.projectsDir}</code>
        </p>
        <p className="hint">
          Projects are yours: they stay in this folder when the application is updated. Forge’s own state (installations,
          indexes, image caches) is kept apart in <code>{info?.stateDir}</code>.
        </p>
        <button type="button" onClick={() => void d.chooseProjectsFolder()}>
          Change projects folder…
        </button>
      </section>
      <section>
        <h3>EXODUS (optional)</h3>
        <p className="hint">
          EXODUS is not needed to edit, simulate or export. With the extension on, an export may include EXODUS code behind a
          gate, with your vanilla alternatives as fallback. It stays off until you turn it on.
        </p>
        <p data-testid="extension-state">
          {ext === undefined
            ? ""
            : ext.loaded
              ? `On — ${ext.label}`
              : ext.enabled
                ? `Could not be loaded: ${ext.error ?? "unknown reason"}`
                : ext.available
                  ? `Off — a module is available (${ext.source === "user" ? "chosen by you" : "shipped with the app"})`
                  : "Off — no module chosen"}
        </p>
        <div className="field-row">
          <button type="button" onClick={() => void d.chooseExtension()}>
            Choose module…
          </button>
          <button type="button" disabled={ext?.available !== true || ext.loaded} onClick={() => void d.setExtensionEnabled(true)}>
            Turn on
          </button>
          <button type="button" disabled={ext?.enabled !== true} onClick={() => void d.setExtensionEnabled(false)}>
            Turn off
          </button>
          <button type="button" className="danger" disabled={ext?.available !== true} onClick={() => void d.forgetExtension()}>
            Forget
          </button>
        </div>
      </section>
      <section>
        <h3>Compatibility</h3>
        <p className="hint">What has actually been shown to work. A version number alone is never taken as proof.</p>
        <CompatTable />
      </section>
      <p className="hint">
        {info?.app} {info?.version} · {info?.platform}/{info?.arch} · Electron {info?.electron}
      </p>
      {d.message !== null && <p className="hint" role="status">{d.message}</p>}
    </Modal>
  );
}

function UnsavedDialog(): JSX.Element | null {
  const unsaved = useDesktop((s) => s.unsaved);
  const answer = useDesktop((s) => s.answerUnsaved);
  const project = useEditor((s) => s.project);
  if (unsaved === null) return null;
  return (
    <Modal title="Unsaved changes" alert onClose={() => answer("cancel")}>
      <p>
        <strong>{project?.name}</strong> has changes that are not saved. Save them before you {unsaved.reason}?
      </p>
      <div className="field-row">
        <button type="button" className="primary" data-autofocus onClick={() => answer("save")}>
          Save
        </button>
        <button type="button" className="danger" onClick={() => answer("discard")}>
          Don’t save
        </button>
        <button type="button" onClick={() => answer("cancel")}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/**
 * Mounted once. Starts the desktop state, keeps the shell informed of unsaved work, and answers the
 * shell’s “the window wants to close” — asking first when there is something to lose.
 */
export function DesktopHost(): JSX.Element {
  const desktop = getDesktop();
  const dialog = useDesktop((s) => s.dialog);
  const init = useDesktop((s) => s.init);
  const dirty = useEditor((s) => s.dirty);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    desktop?.reportDirty(dirty);
  }, [desktop, dirty]);

  // In a browser the only protection is the browser's own leave-page prompt.
  useEffect(() => {
    if (desktop !== null || !dirty) return undefined;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [desktop, dirty]);

  useEffect(() => {
    if (desktop === null) return undefined;
    return desktop.onCloseRequested(() => {
      void useDesktop
        .getState()
        .confirmUnsaved("close the window")
        .then((go) => desktop.answerClose(go ? "close" : "cancel"));
    });
  }, [desktop]);

  if (desktop === null) return <UnsavedDialog />;
  return (
    <>
      {dialog === "installations" && <InstallationsDialog />}
      {dialog === "export" && <ExportDialog />}
      {dialog === "settings" && <SettingsDialog />}
      <UnsavedDialog />
    </>
  );
}

/** The installation choice for the DMX view and the toolbar, where a browser has a text field for a folder. */
export function InstallSelect({ value, onChange }: { value: string; onChange: (id: string) => void }): JSX.Element {
  const installations = useDesktop((s) => s.installations);
  const openDialog = useDesktop((s) => s.openDialog);
  return (
    <>
      <select aria-label="EmptyEpsilon installation" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">no installation chosen</option>
        {installations.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label} — {i.target}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => openDialog("installations")}>
        Installations…
      </button>
    </>
  );
}
