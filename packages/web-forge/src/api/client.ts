import {
  AssetManifestSchema,
  EECatalogSchema,
  EEProjectSchema,
  ForgeBuildResultSchema,
  ForgeCreateResultSchema,
  ForgeInstallPreviewSchema,
  ForgeLibraryRescanResultSchema,
  ForgeLibraryResponseSchema,
  type ForgeInstallPreview,
  type ForgeLibraryRescanResult,
  ForgeProjectListSchema,
  ForgeSaveResultSchema,
  type AssetManifest,
  type EECatalog,
  type EELibrary,
  type EEProject,
  type ForgeBuildMode,
  type ForgeBuildResult,
  type ForgeCreateResult,
  type ForgeProjectList,
  type ForgeSaveResult,
  ForgeInstallationListSchema,
  type ForgeInstallation,
  EEDmxTriggerReadingSchema,
  ForgeDmxBuildResultSchema,
  ForgeDmxImportResultSchema,
  ForgeDmxResponseSchema,
  type EEDmxRig,
  type EEDmxTriggerReading,
  type ForgeDmxBuildResult,
  type ForgeDmxImportResult,
} from "@forge/contracts";
import { ForgeCompatibilitySchema, type ForgeCompatibility } from "@forge/contracts";
import { getDesktop } from "./desktop.js";
import { getTransport } from "./transport.js";

/**
 * Typed client for Forge's `/forge/*` surface.
 *
 * Every response is parsed through its contract schema rather than cast: a
 * service/editor skew then fails at the boundary with a readable path,
 * instead of surfacing as `undefined` somewhere in the canvas. The wire is a
 * {@link ForgeTransport}, so the same client talks to Forge's own server, the
 * EXODUS bridge, or a desktop shell without knowing which.
 */

export class ForgeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Offending document path, when the service could identify one. */
    readonly path: string | null = null,
  ) {
    super(message);
    this.name = "ForgeApiError";
  }
}

async function request(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
  const transport = getTransport();
  let response;
  try {
    response = await transport.send(init?.method ?? "GET", path, init?.body);
  } catch {
    throw new ForgeApiError(`cannot reach the Forge service (${transport.label}) — is it running?`, 0);
  }

  const { status, body } = response;
  if (status < 200 || status >= 300) {
    const detail =
      body !== null && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${status}`;
    const path_ =
      body !== null && typeof body === "object" && "path" in body
        ? ((body as { path: unknown }).path as string | null)
        : null;
    throw new ForgeApiError(detail, status, path_);
  }
  return body;
}

const withQuery = (path: string, params: Record<string, string | null | undefined>): string => {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return query === "" ? path : `${path}?${query}`;
};

/** The API catalog of one engine (default: the service's pinned one). */
export async function fetchCatalog(target: string | null = null): Promise<EECatalog> {
  return EECatalogSchema.parse(await request(withQuery("/forge/catalog", { target })));
}

/** The scanned library of the engine's active installation, or null before any scan. */
export async function fetchLibrary(target: string | null = null): Promise<EELibrary | null> {
  return ForgeLibraryResponseSchema.parse(await request(withQuery("/forge/library", { target }))).library;
}

/**
 * The scan of an engine's installation *and which installation it is*. With `install` given, that installation's
 * scan; otherwise the active one of the engine. Two installations of one engine are two scans — a result that
 * says only "EE 2026" has not said which.
 */
export async function fetchLibrarySource(target: string | null = null, install: string | null = null): Promise<{ library: EELibrary | null; installation: ForgeInstallation | null }> {
  const response = ForgeLibraryResponseSchema.parse(await request(withQuery("/forge/library", { target, install })));
  return { library: response.library, installation: response.installation };
}

/** What has been shown to work, per engine; vanilla and each registered extension. */
export async function fetchCompatibility(): Promise<ForgeCompatibility> {
  return ForgeCompatibilitySchema.parse(await request("/forge/compatibility"));
}

/**
 * How a request names the EE install. In a browser the author types a folder; in the desktop shell the
 * editor only ever holds the id of an installation the shell registered (a path never crosses the
 * boundary), so the same field carries an id.
 */
const installBody = (ref: string): Record<string, string> => (getDesktop() !== null ? { install: ref } : { eeDir: ref });

export async function rescanInstallation(id: string): Promise<ForgeLibraryRescanResult> {
  return ForgeLibraryRescanResultSchema.parse(
    await request(`/forge/installations/${encodeURIComponent(id)}/rescan`, { method: "POST" }),
  );
}

export async function removeInstallation(id: string): Promise<void> {
  await request(`/forge/installations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchInstallations(): Promise<ForgeInstallation[]> {
  return ForgeInstallationListSchema.parse(await request("/forge/installations")).installations;
}

export async function fetchProjects(): Promise<ForgeProjectList> {
  return ForgeProjectListSchema.parse(await request("/forge/projects"));
}

export async function fetchProject(id: string): Promise<EEProject> {
  return EEProjectSchema.parse(await request(`/forge/projects/${encodeURIComponent(id)}`));
}

/**
 * Create a project. The bridge answers 409 when the id is taken — it will
 * not overwrite an existing scenario — and hands back the document it
 * wrote, so the editor opens it without a second round trip.
 */
export async function createProject(
  id: string,
  name: string,
  description: string,
): Promise<ForgeCreateResult> {
  return ForgeCreateResultSchema.parse(
    await request("/forge/projects", { method: "POST", body: { id, name, description } }),
  );
}

export async function saveProject(project: EEProject): Promise<ForgeSaveResult> {
  return ForgeSaveResultSchema.parse(
    await request(`/forge/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: project }),
  );
}

/**
 * Build a project, and optionally install it into an EE directory.
 *
 * The install is part of the same call because a build that stops at
 * `projects/<id>/build/` has not reached the game: ship templates load
 * only during EE's launch-time phase, so the file has to be in
 * `scripts/shiptemplates/` and named in `shipTemplates.lua` first.
 */
export async function buildProjectOnBridge(
  id: string,
  install: { readonly eeDir: string; readonly patchShipTemplates: boolean; readonly overwrite?: boolean } | null = null,
  mode: ForgeBuildMode | null = null,
  libraryInstall: string | null = null,
): Promise<ForgeBuildResult> {
  return ForgeBuildResultSchema.parse(
    await request(`/forge/projects/${encodeURIComponent(id)}/build`, {
      method: "POST",
      body: {
        ...(libraryInstall === null ? {} : { libraryInstall }),
        ...(install === null ? {} : { install: install.eeDir, patchShipTemplates: install.patchShipTemplates, overwrite: install.overwrite === true }),
        ...(mode === null ? {} : { mode }),
      },
    }),
  );
}

/** What installing would do — the preflight, with nothing written. */
export async function previewInstallOnBridge(id: string, install: string, mode: ForgeBuildMode | null, libraryInstall: string | null): Promise<ForgeInstallPreview> {
  return ForgeInstallPreviewSchema.parse(
    await request(`/forge/projects/${encodeURIComponent(id)}/install-preview`, {
      method: "POST",
      body: { install, ...(mode === null ? {} : { mode }), ...(libraryInstall === null ? {} : { libraryInstall }) },
    }),
  );
}

/**
 * The asset manifest (ADR-0020), served by the Forge service from its bundled
 * assets next to the radar sprites and planet textures. Parsed
 * through its schema like every other response — the ship preview reads
 * `model` and `rotationOffset` out of it and a cast would let a stale
 * manifest fail somewhere inside three.js instead of here.
 */
export async function fetchAssetManifest(target: string | null = null): Promise<AssetManifest> {
  // For the engine the project targets, like every other asset: without it the service answers from the bundled
  // set alone, whichever engine the open project is for.
  return AssetManifestSchema.parse(await request(withQuery("/forge/assets/manifest.json", { target })));
}

// --- DMX (ADR-0040) --------------------------------------------------------

export async function fetchDmxRig(): Promise<EEDmxRig | null> {
  return ForgeDmxResponseSchema.parse(await request("/forge/dmx")).rig;
}

export async function saveDmxRig(rig: EEDmxRig): Promise<void> {
  await request("/forge/dmx", { method: "PUT", body: rig });
}

/** Read the EE install's own `hardware.ini`, warnings and all. */
/**
 * Re-index the EE install so newly added textures, templates or models
 * appear in the editor's lists. `ee-library.json` is a snapshot.
 */
export async function rescanLibrary(eeDir: string): Promise<ForgeLibraryRescanResult> {
  return ForgeLibraryRescanResultSchema.parse(
    await request("/forge/library/rescan", { method: "POST", body: installBody(eeDir) }),
  );
}

export async function importDmxRig(eeDir: string): Promise<ForgeDmxImportResult> {
  return ForgeDmxImportResultSchema.parse(
    await request("/forge/dmx/import", { method: "POST", body: installBody(eeDir) }),
  );
}

export async function buildDmxRig(install: string | null): Promise<ForgeDmxBuildResult> {
  return ForgeDmxBuildResultSchema.parse(
    await request("/forge/dmx/build", { method: "POST", body: install === null ? {} : { install } }),
  );
}

/** What the rig's triggers read on the live ship, for the preview. */
export async function fetchDmxTriggers(target: string | null = null): Promise<EEDmxTriggerReading> {
  return EEDmxTriggerReadingSchema.parse(await request(withQuery("/forge/dmx/triggers", { target })));
}
