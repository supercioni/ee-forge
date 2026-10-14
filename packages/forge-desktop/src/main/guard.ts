import { MAX_REQUEST_BYTES, RawForgeRequestSchema, type RawForgeRequest } from "../shared/ipc.js";

/**
 * The gate every Forge service request passes before it reaches the router.
 *
 * The renderer is the editor, but it is also a web page: whatever it can ask, a bug or an injected
 * script could ask. So the shell answers only the routes the editor uses, and refuses the ones that
 * take a file-system path — a path reaches the services only through the shell's own dialogs
 * (`operations.ts`), never from the page.
 */

export interface GuardContext {
  /** Is this the id of an installation Forge has registered? */
  isInstallId(value: string): boolean;
}

export type GuardResult =
  | { readonly ok: true; readonly request: RawForgeRequest }
  | { readonly ok: false; readonly status: number; readonly error: string };

const AREAS = new Set(["health", "catalog", "library", "installations", "assets", "extensions", "compatibility", "dmx", "projects"]);
const SAFE_PATH = /^\/forge(\/[A-Za-z0-9_.~%-]+)*\/?$/;

const refuse = (status: number, error: string): GuardResult => ({ ok: false, status, error });

const hasText = (body: unknown, key: string): boolean =>
  typeof body === "object" && body !== null && key in body && (body as Record<string, unknown>)[key] !== undefined;

const field = (body: unknown, key: string): unknown =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;

export function guardRequest(raw: unknown, context: GuardContext): GuardResult {
  const parsed = RawForgeRequestSchema.safeParse(raw);
  if (!parsed.success) return refuse(400, "malformed request");
  const request = parsed.data;

  if (!SAFE_PATH.test(request.path)) return refuse(400, "malformed path");
  let segments: string[];
  try {
    segments = request.path.split("/").filter((s) => s !== "").map(decodeURIComponent);
  } catch {
    return refuse(400, "malformed path");
  }
  if (segments.some((s) => s === ".." || s === "." || s.includes("/") || s.includes("\\") || s.includes("\0"))) {
    return refuse(400, "malformed path");
  }
  const [, area, a, b] = segments;
  if (segments[0] !== "forge" || area === undefined || !AREAS.has(area)) return refuse(404, "no such route");

  let size = 0;
  try {
    size = JSON.stringify(request.body ?? null).length;
  } catch {
    return refuse(400, "request body is not JSON");
  }
  if (size > MAX_REQUEST_BYTES) return refuse(413, "request body too large");

  const body = request.body;
  const method = request.method;

  // Registering an install takes a folder: only the shell's folder dialog may supply one.
  if (area === "installations" && method === "POST" && a === undefined) {
    return refuse(403, "installations are added from the desktop folder picker");
  }
  // Re-index / import from an install: by registered id, never by a path.
  if (area === "library" && a === "rescan" && hasText(body, "eeDir")) return refuse(403, "pass a registered installation, not a path");
  if (area === "dmx" && a === "import" && hasText(body, "eeDir")) return refuse(403, "pass a registered installation, not a path");
  // Build/install and DMX install: `install` must name a registered installation.
  if ((area === "projects" && (b === "build" || b === "install-preview")) || (area === "dmx" && a === "build") || (area === "library" && a === "rescan") || (area === "dmx" && a === "import")) {
    const install = field(body, "install");
    if (install !== undefined && install !== null && install !== "") {
      if (typeof install !== "string" || !context.isInstallId(install)) return refuse(403, "pass a registered installation, not a path");
    }
  }
  // The installation whose scan a build checks against is named the same way.
  if (area === "projects" && (b === "build" || b === "install-preview")) {
    const scan = field(body, "libraryInstall");
    if (scan !== undefined && scan !== null && scan !== "") {
      if (typeof scan !== "string" || !context.isInstallId(scan)) return refuse(403, "pass a registered installation, not a path");
    }
  }
  // Assets are read through the app protocol, not this channel.
  if (area === "assets") return refuse(404, "assets are served by the app protocol");

  return { ok: true, request };
}
