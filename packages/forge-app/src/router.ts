import { ForgeRegisterInstallationSchema } from "@forge/contracts";
import { EE_TARGETS, describeCompatibility, extensionCompatibility, loadCatalog } from "@forge/core";
import { ForgeServiceError, badRequest, notFound } from "./errors.js";
import type { ForgeServices } from "./services.js";

/**
 * The transport contract. Anything that can carry a method, a path, a query
 * and a JSON body — an HTTP server, Electron IPC, a test — drives Forge
 * through {@link ForgeRouter.handle}; no transport knows what a route does.
 */
export interface ForgeRequest {
  readonly method: string;
  /** Path including the `/forge/` prefix, without the query string. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface ForgeResponse {
  readonly status: number;
  /** JSON-serialisable payload; ignored when `bytes` is set. */
  readonly body: unknown;
  /** Raw payload (images, models) with its media type. */
  readonly bytes?: Uint8Array;
  readonly contentType?: string;
}

export interface ForgeRouter {
  handle(request: ForgeRequest): Promise<ForgeResponse>;
}

export interface ForgeRouterOptions {
  /** Install directory assumed by routes that need one and were given none (e.g. an `EE_DIR` the host reads). */
  readonly defaultInstallDir?: string | null;
}

const ok = (body: unknown, status = 200): ForgeResponse => ({ status, body });

function record(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export function createForgeRouter(services: ForgeServices, options: ForgeRouterOptions = {}): ForgeRouter {
  const fallbackDir = options.defaultInstallDir ?? null;

  async function dispatch(request: ForgeRequest): Promise<ForgeResponse> {
    const method = request.method.toUpperCase();
    const path = request.path.replace(/\/+$/, "");
    const query = request.query ?? {};
    const body = record(request.body);
    const seg = path.split("/").filter((part) => part !== "").map(decodeURIComponent);
    if (seg[0] !== "forge") throw notFound(`no route ${method} ${request.path}`);
    const [, area, a, b] = seg;

    if (method === "GET" && area === "health") return ok({ ok: true, app: "forge" });

    if (area === "catalog" && method === "GET" && seg.length === 2) {
      try {
        return ok(loadCatalog(query["target"]));
      } catch (error) {
        throw badRequest(error instanceof Error ? error.message : String(error), "target");
      }
    }

    if (area === "library" && seg.length === 2 && method === "GET") {
      const { library, installation } = services.libraries.select({
        installId: query["install"] ?? null,
        target: query["target"] ?? null,
      });
      return ok({ library, installation });
    }
    if (area === "library" && a === "rescan" && method === "POST") {
      const eeDir = text(body["eeDir"]) ?? fallbackDir ?? "";
      const installId = text(body["install"]);
      if (installId === undefined && eeDir === "") throw badRequest("no EE install directory given", "eeDir");
      const installation =
        installId !== undefined
          ? services.installations.require(installId)
          : services.installations.register({
              path: eeDir,
              ...(text(body["eeVersion"]) !== undefined ? { eeVersion: text(body["eeVersion"])! } : {}),
            });
      return ok(services.libraries.rescan(installation.id));
    }

    if (area === "installations") {
      if (seg.length === 2 && method === "GET") return ok({ installations: services.installations.list() });
      if (seg.length === 2 && method === "POST") {
        const parsed = ForgeRegisterInstallationSchema.safeParse(request.body);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw badRequest(issue?.message ?? "invalid installation", issue === undefined ? null : issue.path.join("."));
        }
        return ok(services.installations.register(parsed.data), 201);
      }
      if (a !== undefined && seg.length === 3 && method === "DELETE") {
        services.installations.remove(a);
        return ok({ removed: true });
      }
      if (a !== undefined && b === "rescan" && seg.length === 4 && method === "POST") {
        return ok(services.libraries.rescan(a));
      }
    }

    if (area === "assets" && method === "GET" && seg.length > 2) {
      const asset = services.assets.resolve(seg.slice(2).join("/"), {
        installId: query["install"] ?? null,
        target: query["target"] ?? null,
      });
      return { status: 200, body: null, bytes: asset.bytes, contentType: asset.contentType };
    }

    if (area === "extensions" && seg.length === 2 && method === "GET") {
      return ok({
        extensions: services.extensions.map((extension) => ({
          id: extension.id,
          label: extension.label,
          protocol: extension.protocol,
          capabilities: [...extension.capabilities],
          compatibility: Object.fromEntries(EE_TARGETS.map((target) => [target.id, extensionCompatibility(extension, target.id)])),
        })),
      });
    }

    if (area === "compatibility" && seg.length === 2 && method === "GET") {
      return ok(describeCompatibility(services.extensions));
    }

    if (area === "dmx") {
      if (seg.length === 2 && method === "GET") return ok({ rig: services.dmx.rig() });
      if (seg.length === 2 && method === "PUT") return ok(services.dmx.save(request.body));
      if (a === "import" && method === "POST") {
        const eeDir = text(body["eeDir"]) ?? fallbackDir ?? undefined;
        return ok(
          services.dmx.importFrom({
            ...(eeDir !== undefined ? { eeDir } : {}),
            ...(text(body["install"]) !== undefined ? { install: text(body["install"])! } : {}),
          }),
        );
      }
      if (a === "build" && method === "POST") {
        return ok(services.dmx.build(text(body["install"]) !== undefined ? { install: text(body["install"])! } : {}));
      }
      if (a === "triggers" && method === "GET") return ok(await services.dmx.triggers(query["target"] ?? null));
    }

    if (area === "projects") {
      if (seg.length === 2 && method === "GET") return ok(services.projects.list());
      if (seg.length === 2 && method === "POST") return ok(services.projects.create(request.body), 201);
      if (a !== undefined && seg.length === 3 && method === "GET") return ok(services.projects.get(a));
      if (a !== undefined && seg.length === 3 && method === "PUT") return ok(services.projects.save(a, request.body));
      if (a !== undefined && b === "build" && seg.length === 4 && method === "POST") {
        const install = text(body["install"]);
        return ok(
          services.projects.build(a, {
            ...(install !== undefined ? { install } : {}),
            patchShipTemplates: body["patchShipTemplates"] === true,
            overwrite: body["overwrite"] === true,
            ...(body["mode"] === "vanilla" || body["mode"] === "integrated" ? { mode: body["mode"] } : {}),
            ...(text(body["libraryInstall"]) !== undefined ? { libraryInstall: text(body["libraryInstall"])! } : {}),
          }),
        );
      }
      if (a !== undefined && b === "install-preview" && seg.length === 4 && method === "POST") {
        return ok(
          services.projects.installPreview(a, {
            install: text(body["install"]) ?? "",
            ...(body["mode"] === "vanilla" || body["mode"] === "integrated" ? { mode: body["mode"] } : {}),
            ...(text(body["libraryInstall"]) !== undefined ? { libraryInstall: text(body["libraryInstall"])! } : {}),
          }),
        );
      }
    }

    throw notFound(`no route ${method} ${request.path}`);
  }

  return {
    async handle(request) {
      try {
        return await dispatch(request);
      } catch (error) {
        if (error instanceof ForgeServiceError) {
          return { status: error.status, body: { error: error.message, path: error.path } };
        }
        services.context.logger.warn({ err: error, path: request.path }, "forge: request failed");
        return { status: 500, body: { error: error instanceof Error ? error.message : String(error), path: null } };
      }
    },
  };
}
