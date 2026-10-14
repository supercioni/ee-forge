/**
 * How the editor reaches Forge's services.
 *
 * The editor never knows a host, a port or that EXODUS exists: it talks to a
 * {@link ForgeTransport}. The default carries requests over HTTP to whatever
 * serves `/forge/*` (Forge's own server, or the EXODUS bridge), resolved at
 * run time; a desktop shell can install its own transport (IPC) before the
 * app mounts, by assigning `window.__FORGE_TRANSPORT__`.
 */

export interface ForgeTransportResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ForgeTransport {
  /** Short description for error messages, e.g. the base URL. */
  readonly label: string;
  send(method: string, path: string, body?: unknown): Promise<ForgeTransportResponse>;
  /** URL an `<img>` or glTF loader can fetch for a service asset. */
  assetUrl(path: string, target: string | null, install?: string | null): string;
}

declare global {
  interface Window {
    /** Injected by a host (desktop shell) to replace the HTTP transport. */
    __FORGE_TRANSPORT__?: ForgeTransport;
    /** Injected by a host page to point the HTTP transport at a service. */
    __FORGE_API__?: string;
  }
}

/** Base URL of the service: injected value, then `?forge-api=`, then the build-time env, else same origin. */
export function resolveApiBase(): string {
  if (typeof window === "undefined") return "";
  if (typeof window.__FORGE_API__ === "string") return window.__FORGE_API__.replace(/\/+$/, "");
  const fromQuery = new URLSearchParams(window.location.search).get("forge-api");
  if (fromQuery !== null && fromQuery !== "") return fromQuery.replace(/\/+$/, "");
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const fromEnv = env?.["VITE_FORGE_API"];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv.replace(/\/+$/, "") : "";
}

export function httpTransport(base: string): ForgeTransport {
  return {
    label: base === "" ? "this origin" : base,
    async send(method, path, body) {
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      const response = await fetch(`${base}${path}`, init);
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    assetUrl(path, target, install = null) {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const query = [target === null ? "" : `target=${encodeURIComponent(target)}`, install === null ? "" : `install=${encodeURIComponent(install)}`].filter((q) => q !== "");
      return `${base}/forge/assets/${encoded}${query.length === 0 ? "" : `?${query.join("&")}`}`;
    },
  };
}

let current: ForgeTransport | null = null;

export function setTransport(transport: ForgeTransport | null): void {
  current = transport;
}

export function getTransport(): ForgeTransport {
  if (current !== null) return current;
  if (typeof window !== "undefined" && window.__FORGE_TRANSPORT__ !== undefined) {
    return window.__FORGE_TRANSPORT__;
  }
  current = httpTransport(resolveApiBase());
  return current;
}

/**
 * Engine whose installation answers asset requests. Set when a project is
 * opened, so a 2024 project draws 2024's textures and a 2026 one 2026's.
 */
let assetTarget: string | null = null;

export function setAssetTarget(target: string | null): void {
  assetTarget = target;
}

/**
 * Bumped after every scan of an installation: the images it copies appear under URLs the page may already have
 * requested (and been refused) before the scan, and a refusal must not be remembered.
 */
let assetEpoch = 0;

/**
 * The registered installation whose files answer asset requests. Two installations can be the same version, so the
 * engine alone does not say which one the author chose: without this the service answers from whichever of them was
 * scanned last, while the lists and the checks describe the chosen one.
 */
let assetInstall: string | null = null;

export function setAssetInstall(id: string | null): void {
  if (id === assetInstall) return;
  assetInstall = id;
  assetEpoch += 1; // the same path now names a different file: nothing fetched before may be reused
}

export function bumpAssetEpoch(): void {
  assetEpoch += 1;
}

/** URL of a service asset (`planets/x.png`, `radar/y.png`, a model, the manifest). */
export function assetUrl(path: string): string {
  const url = getTransport().assetUrl(path, assetTarget, assetInstall);
  return assetEpoch === 0 ? url : `${url}${url.includes("?") ? "&" : "?"}v=${assetEpoch}`;
}

/**
 * Which scan of which engine the assets now come from. A cache of anything fetched from the asset store (the
 * manifest) must be keyed on it: the same URL names a different file after the project's engine changes or an
 * installation is rescanned.
 */
export function assetScopeKey(): string {
  return `${assetTarget ?? ""}@${assetInstall ?? ""}#${assetEpoch}`;
}
