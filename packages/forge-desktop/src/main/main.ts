import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { APP_ORIGIN, APP_SCHEME, CHANNEL, CloseDecisionSchema, DeclareInstallationArgsSchema, DirtyArgSchema, EnabledArgSchema, ExportArgsSchema, ImportKindSchema } from "../shared/ipc.js";
import { guardRequest } from "./guard.js";
import { DesktopOperations, type Dialogs } from "./operations.js";
import { fileLogger, Runtime } from "./runtime.js";

/**
 * EE FORGE desktop: one window, the Forge services running in this process, nothing else.
 *
 * No server is started and no port is opened. The editor is served from a private scheme, talks to the
 * services through a handful of validated IPC calls, and reaches the file system only through native
 * dialogs opened here. EXODUS is not required and not loaded unless the user opts in.
 */

// ---------------------------------------------------------------- paths
// Tests (and portable setups) can point the app at other folders; a normal run uses the OS's own.
const overrideUserData = process.env["FORGE_DESKTOP_USER_DATA"];
const overrideDocuments = process.env["FORGE_DESKTOP_DOCUMENTS"];
app.setName("EE FORGE");
if (overrideUserData !== undefined && overrideUserData !== "") app.setPath("userData", overrideUserData);

const here = __dirname; // the bundle's own folder (dist/); the bundle embeds no developer path
const rendererDir = join(here, "renderer");
const resourcesDir = join(here, "resources");

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ------------------------------------------------------------- dialogs
let mainWindow: BrowserWindow | null = null;

/** Looked up on every call (`dialog.showOpenDialog` is read at call time), so a test can stand in for the native chooser. */
const dialogs: Dialogs = {
  async pickFolder({ title, defaultPath }) {
    const options = { title, properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[], ...(defaultPath !== undefined ? { defaultPath } : {}) };
    const result = mainWindow === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(mainWindow, options);
    return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
  },
  async pickFile({ title, defaultPath, filters }) {
    const options = { title, properties: ["openFile"] as "openFile"[], filters, ...(defaultPath !== undefined ? { defaultPath } : {}) };
    const result = mainWindow === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(mainWindow, options);
    return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
  },
};

// -------------------------------------------------------- the app protocol
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".glb": "model/gltf-binary",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Same-origin only; no remote script, style, font or frame. `blob:`/`data:` serve decoded textures and models. */
const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' only: the glTF loader instantiates the mesh-decoder WebAssembly module; no eval, no remote script.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const securityHeaders = { "content-security-policy": CSP, "x-content-type-options": "nosniff" } as const;

function respond(status: number, type: string, body: string | Uint8Array): Response {
  // A copy as a plain ArrayBuffer view: that is what the Response constructor accepts.
  return new Response(typeof body === "string" ? body : new Uint8Array(body), { status, headers: { "content-type": type, ...securityHeaders } });
}

function registerAppProtocol(runtime: () => Runtime): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return respond(405, "text/plain", "method not allowed");
    const url = new URL(request.url);
    if (url.host !== "app") return respond(404, "text/plain", "not found");
    const pathname = decodeURIComponent(url.pathname);

    // Images and models: the one Forge route the page may read through the protocol.
    if (pathname.startsWith("/forge/assets/")) {
      const response = await runtime().router.handle({ method: "GET", path: pathname, query: Object.fromEntries(url.searchParams) });
      if (response.bytes !== undefined) return respond(response.status, response.contentType ?? "application/octet-stream", response.bytes);
      return respond(response.status, "application/json", JSON.stringify(response.body));
    }
    if (pathname.startsWith("/forge/")) return respond(404, "text/plain", "not found");

    const relative = pathname === "/" ? "/index.html" : pathname;
    const file = normalize(join(rendererDir, relative));
    if (!file.startsWith(rendererDir + sep)) return respond(404, "text/plain", "not found");
    try {
      if (!statSync(file).isFile()) return respond(404, "text/plain", "not found");
      return respond(200, CONTENT_TYPES[extname(file)] ?? "application/octet-stream", readFileSync(file));
    } catch {
      return respond(404, "text/plain", "not found");
    }
  });
}

// ------------------------------------------------------------------ IPC
function trusted(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  return url === `${APP_ORIGIN}/` || url.startsWith(`${APP_ORIGIN}/`) || url === `${APP_ORIGIN}/index.html`;
}

function registerIpc(runtime: () => Runtime, operations: () => DesktopOperations): void {
  const handle = <A extends z.ZodTypeAny | null>(channel: string, schema: A, run: (args: A extends z.ZodTypeAny ? z.infer<A> : void) => unknown): void => {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      if (!trusted(event)) throw new Error("untrusted sender");
      const args = schema === null ? undefined : (schema as z.ZodTypeAny).parse(raw);
      return run(args as never);
    });
  };

  ipcMain.handle(CHANNEL.request, async (event, raw: unknown) => {
    if (!trusted(event)) return { status: 403, body: { error: "untrusted sender", path: null } };
    const verdict = guardRequest(raw, { isInstallId: (id) => operations().isInstallId(id) });
    if (!verdict.ok) return { status: verdict.status, body: { error: verdict.error, path: null } };
    const { method, path, query, body } = verdict.request;
    const response = await runtime().router.handle({ method, path, ...(query !== undefined ? { query } : {}), ...(body !== undefined ? { body } : {}) });
    return { status: response.status, body: response.body };
  });

  handle(CHANNEL.info, null, () => operations().info());
  handle(CHANNEL.chooseProjectsFolder, null, () => operations().chooseProjectsFolder());
  handle(CHANNEL.addInstallation, null, () => operations().addInstallation());
  handle(CHANNEL.declareInstallation, DeclareInstallationArgsSchema, (a) => operations().declareInstallation(a.token, a.eeVersion));
  handle(CHANNEL.importProject, ImportKindSchema, (kind) => operations().importProject(kind));
  handle(CHANNEL.chooseExportFolder, null, () => operations().chooseExportFolder());
  handle(CHANNEL.exportProject, ExportArgsSchema, (a) => operations().exportProject(a));
  handle(CHANNEL.revealLastExport, null, () => operations().revealLastExport());
  handle(CHANNEL.chooseExtension, null, () => operations().chooseExtension());
  handle(CHANNEL.setExtensionEnabled, EnabledArgSchema, (enabled) => operations().setExtensionEnabled(enabled));
  handle(CHANNEL.forgetExtension, null, () => operations().forgetExtension());
}

// --------------------------------------------------------------- window
let dirty = false;
let forceClose = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "EE FORGE",
    backgroundColor: "#14181c",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: process.env["FORGE_DESKTOP_DEVTOOLS"] === "1",
    },
  });
  win.once("ready-to-show", () => win.show());

  // The page never navigates away from the app or opens another window.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });

  // Closing with unsaved work: the editor decides (it can save), the shell only asks.
  win.on("close", (event) => {
    if (forceClose || !dirty) return;
    event.preventDefault();
    win.webContents.send(CHANNEL.closeRequested);
  });
  win.webContents.on("render-process-gone", () => {
    forceClose = true;
  });
  win.on("unresponsive", () => {
    forceClose = true;
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  return win;
}

async function boot(): Promise<void> {
  const userData = app.getPath("userData");
  const log = fileLogger(userData);
  const documents = overrideDocuments !== undefined && overrideDocuments !== "" ? overrideDocuments : app.getPath("documents");
  const runtime = new Runtime(
    { userData, documents, resources: resourcesDir, version: app.getVersion(), electronVersion: process.versions.electron ?? "" },
    log,
  );
  await runtime.start();
  const operations = new DesktopOperations(runtime, dialogs, (path) => void shell.openPath(path));

  // Nothing is granted to the page: no camera, no notifications, no device, no clipboard read.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  registerAppProtocol(() => runtime);
  registerIpc(() => runtime, () => operations);
  ipcMain.on(CHANNEL.dirty, (event, raw: unknown) => {
    if (!trusted(event)) return;
    const parsed = DirtyArgSchema.safeParse(raw);
    if (parsed.success) dirty = parsed.data;
  });
  ipcMain.on(CHANNEL.closeDecision, (event, raw: unknown) => {
    if (!trusted(event)) return;
    const parsed = CloseDecisionSchema.safeParse(raw);
    if (parsed.success && parsed.data === "close") {
      forceClose = true;
      mainWindow?.close();
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow = createWindow();
  await mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  log(`info ready projects=${runtime.projectsDir} state=${runtime.stateDir}`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  void app.whenReady().then(boot).catch((error: unknown) => {
    dialog.showErrorBox("EE FORGE could not start", error instanceof Error ? error.message : String(error));
    app.exit(1);
  });
}
