import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { AssetManifest, EELibrary, EETemplateDef } from "@forge/contracts";
import { describePreview, resolveShipModel } from "@forge/core/editor";
import { fetchAssetManifest } from "../api/client.js";
import { assetScopeKey, assetUrl } from "../api/transport.js";
import { describeAssetFailure } from "../ui/asset-failure.js";
import { useEditor } from "../store/editor.js";
import { ErrorBoundary } from "../ui/ErrorBoundary.js";
import { ResourceLine } from "./ShipResources.js";

/**
 * Gate in front of the 3D preview.
 *
 * The heavy component is behind `lazy`, so three.js is a chunk the editor
 * fetches only when someone opens a ship. The manifest is fetched once and
 * kept here rather than in the store: it describes the *asset library*, not
 * the project, and the store's rule is that it holds the document.
 *
 * What the preview shows is said in words above it (`describePreview`): the
 * model of this hull, the likeness of the hull it copies, a stand-in that
 * is not the hull, or a file that failed — never a picture that looks like
 * the hull without being it.
 */
const ShipPreview3D = lazy(async () => import("./ShipPreview3D.js"));

/** The manifest of one engine and one scan; a different engine or a rescan asks again. */
let cached: { readonly scope: string; readonly manifest: AssetManifest } | null = null;

export function ShipPreview({
  template,
  templates,
  library,
  target,
}: {
  template: EETemplateDef;
  templates: readonly EETemplateDef[];
  library: EELibrary | null;
  target: string;
}): JSX.Element {
  const scope = assetScopeKey();
  const [manifest, setManifest] = useState<AssetManifest | null>(cached?.scope === scope ? cached.manifest : null);
  const [failed, setFailed] = useState<string | null>(null);
  const [file, setFile] = useState<"loading" | "loaded" | "failed">("loading");
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (cached?.scope === scope) {
      setManifest(cached.manifest);
      setFailed(null);
      return;
    }
    setManifest(null);
    let alive = true;
    void fetchAssetManifest(target)
      .then((loaded) => {
        cached = { scope, manifest: loaded };
        if (alive) {
          setManifest(loaded);
          setFailed(null);
        }
      })
      .catch((cause: unknown) => {
        if (alive) setFailed(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
    };
  }, [scope, target]);

  // The URL the loader will ask for, resolved here as well as inside the
  // preview so the failure message can name the file without the boundary
  // having to dig it out of a three.js error.
  const entry = manifest === null ? null : resolveShipModel(manifest, template, templates);
  const url = entry === null ? "" : assetUrl(entry.entry.model);

  // A different hull, or a different file, starts from "loading" again.
  useEffect(() => {
    setFile("loading");
    setFailure(null);
  }, [template.id, url]);

  const loaded = useCallback(() => setFile("loaded"), []);
  const installLabel = useEditor((s) => s.libraryInstall?.label);
  const report = useMemo(
    () => describePreview({ template, templates, manifest, manifestError: failed, library, target, ...(installLabel !== undefined ? { installLabel } : {}), file, failure }),
    [template, templates, manifest, failed, library, target, installLabel, file, failure],
  );

  return (
    <div className="diagram" data-testid="ship-preview">
      <h3>3D preview</h3>
      <ResourceLine report={report} />
      {failed !== null ? null : (
        // `useGLTF` throws on a missing or unreadable mesh, and Suspense
        // catches suspensions, not throws — without this the editor went
        // blank on any ship whose .glb was never produced. Keyed on the
        // template so selecting another hull clears a caught error.
        <ErrorBoundary
          resetKey={`${template.id}|${url}`}
          onError={(error) => {
            setFile("failed");
            setFailure(describeAssetFailure(error, url));
          }}
          fallback={() => null}
        >
          <Suspense fallback={<p className="hint">Loading the 3D view…</p>}>
            <ShipPreview3D template={template} templates={templates} manifest={manifest} onLoaded={loaded} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
