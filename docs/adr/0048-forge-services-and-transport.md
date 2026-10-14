# ADR-0048 — Forge services behind a transport contract

**Status:** accepted, 2026-10-02 (increment 3 of the autonomous Forge plan).

## Decision

1. **`@forge/app`** (`packages/forge-app`) holds the application logic that used to live in
   `bridge/src/forge/routes.ts`: `ProjectService`, `InstallationService`, `LibraryService`,
   `AssetService`, `DmxService`. It depends on `@forge/core`, `@forge/contracts` and Node only.
2. **A router is the transport contract.** `createForgeRouter(services).handle(request)` maps
   `{method, path, query, body}` to `{status, body | bytes}`. HTTP (Fastify in the bridge,
   `node:http` in Forge's own server) and, later, Electron IPC are thin carriers of it.
   The bridge keeps the legacy `/forge/*` paths through one catch-all; there is no second
   copy of any behaviour.
3. **The editor depends on a `ForgeTransport`**, not on a host or port. HTTP, same origin by
   default; overridable by `?forge-api=`, `VITE_FORGE_API`, or `window.__FORGE_TRANSPORT__`.
   Vite's dev server proxies `/forge` to `FORGE_API_URL` (default Forge's own server, 8092).
4. **Installations are registered with evidence.** `installations.json` records id, path,
   engine, `verified` (the install's `script_reference.html` SHA-256 matched a registered
   build) and the evidence hash. A declared version is allowed only for an unrecognised build
   and stays `verified: false`. Identity is re-checked before scan/install.
5. **State is per install.** Libraries: `libraries/<installId>.json`; mirrored images:
   `cache/<installId>/assets/`. Asset lookup: that install's cache (or the active install of
   the requested target), then Forge's bundled assets. Services never write to bundled assets
   (the old rescan overwrote `assets/` in place and mixed engines).
6. **DMX telemetry is an optional adapter per engine** (`DmxTelemetrySource`). The bridge
   registers one for the engine its EE client speaks; without it the preview reports
   `live: false`. Rig editing, import, build and the simulator need nothing running.

## Alternatives

- Keep the routes in the bridge and add a second server: two implementations that drift.
- Make the editor import the services directly (no transport): blocks IPC/browser modes and
  couples the UI to Node.
- Key libraries by target instead of install: two copies of one engine would overwrite each other.

## Consequences

- Rescan no longer updates the repository's `assets/`; `ee:scan` (CLI) still does, as the
  explicit tool that refreshes the bundled set.
- The editor works with the bridge, the game and every EXODUS service stopped
  (`pnpm --filter @forge/app serve`), and unchanged against the bridge.
- Electron (increment 5) needs only a transport implementation and a preload API.
