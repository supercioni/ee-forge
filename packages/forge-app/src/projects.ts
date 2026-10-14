import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  EEProjectSchema,
  ForgeCreateRequestSchema,
  type EELibrary,
  type EEProject,
  type ForgeBuildMode,
  type ForgeBuildResult,
  type ForgeCreateResult,
  type ForgeExportResult,
  type ForgeExportTargetResult,
  type ForgeImportResult,
  type ForgeInstallPreview,
  type ForgeLibrarySource,
  type ForgeProjectList,
  type ForgeProjectSummary,
  type ForgeSaveResult,
} from "@forge/contracts";
import {
  buildProject,
  detectInstallTarget,
  extensionCompatibility,
  requireTarget,
  vanillaCompatibility,
  type ForgeExtension,
  importProject,
  installBuild,
  loadCatalog,
  previewInstall,
  serializeProject,
} from "@forge/core";
import { starterProject } from "@forge/core/editor";
import type { ForgeContext } from "./context.js";
import { ForgeServiceError, badRequest, notFound, unprocessable } from "./errors.js";
import type { InstallationService } from "./installations.js";
import type { LibraryService } from "./libraries.js";

function summarise(project: EEProject, updatedAt: string): ForgeProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    groupCount: project.map.groups.length,
    objectCount: project.map.groups.reduce((n, g) => n + g.objects.length, 0),
    templateCount: project.templates.length,
    updatedAt,
  };
}

export interface BuildRequest {
  /** A registered installation id, or a directory path. */
  readonly install?: string | null;
  readonly patchShipTemplates?: boolean;
  /** Replace files EE FORGE did not install (backed up first). Default: such a collision refuses the install. */
  readonly overwrite?: boolean;
  /** Default: integrated when a registered extension owns an action the project uses, else vanilla. */
  readonly mode?: ForgeBuildMode;
  /**
   * The installation whose scan the reference checks use. Default: the active one of the project's engine.
   * It must be an installation of that engine: another engine's library is not evidence about this one.
   */
  readonly libraryInstall?: string | null;
}

const launchItemsOf = (project: EEProject): { templates: string[]; models: string[] } => ({
  templates: project.templates.map((t) => t.name),
  models: project.models.map((m) => m.name),
});

/** Projects: create, list, open, save, build, and put a build into an install. */
export class ProjectService {
  constructor(
    private readonly ctx: ForgeContext,
    private readonly installations: InstallationService,
    private readonly libraries: LibraryService,
    private readonly extensions: readonly ForgeExtension[] = [],
  ) {}

  private read(id: string): { project: EEProject; raw: string } {
    const path = join(this.ctx.projectsDir, id, "project.json");
    if (!existsSync(path)) throw notFound(`no project "${id}"`);
    const raw = readFileSync(path, "utf8");
    // Migrated in memory only: opening a project never rewrites its file;
    // the upgraded document reaches disk the next time the author saves.
    let imported;
    try {
      imported = importProject(JSON.parse(raw));
    } catch (error) {
      throw notFound(error instanceof Error ? error.message : String(error));
    }
    if (imported.lost.length > 0) {
      this.ctx.logger.warn({ project: id, fields: imported.lost }, "forge: project fields would be lost on save");
    }
    return { project: imported.project, raw };
  }

  list(): ForgeProjectList {
    const projects: ForgeProjectSummary[] = [];
    if (existsSync(this.ctx.projectsDir)) {
      for (const entry of readdirSync(this.ctx.projectsDir)) {
        const path = join(this.ctx.projectsDir, entry, "project.json");
        if (!existsSync(path)) continue;
        try {
          projects.push(summarise(this.read(entry).project, statSync(path).mtime.toISOString()));
        } catch (error) {
          this.ctx.logger.warn({ err: error, entry }, "forge: skipping unreadable project");
        }
      }
    }
    return { projects: projects.sort((a, b) => a.id.localeCompare(b.id)), projectsDir: this.ctx.projectsDir };
  }

  get(id: string): EEProject {
    return this.read(id).project;
  }

  /** Separate from `save` so it can refuse an id that exists: a new scenario must not overwrite another. */
  create(body: unknown): ForgeCreateResult {
    const parsed = ForgeCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw badRequest(issue?.message ?? "invalid create request", issue === undefined ? null : issue.path.join("."));
    }
    const dir = join(this.ctx.projectsDir, parsed.data.id);
    if (existsSync(join(dir, "project.json"))) {
      throw new ForgeServiceError(`project "${parsed.data.id}" already exists`, 409, "id");
    }
    const project: EEProject = {
      ...starterProject(parsed.data.id, parsed.data.name),
      // An empty description keeps the starter's, which is never blank:
      // EE shows it in the scenario picker.
      ...(parsed.data.description !== "" ? { description: parsed.data.description } : {}),
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.json"), serializeProject(project), "utf8");
    this.ctx.logger.info({ project: project.id, dir }, "forge: project created");
    return { project, dir };
  }

  save(id: string, body: unknown): ForgeSaveResult {
    const parsed = EEProjectSchema.safeParse(body);
    if (!parsed.success) {
      // First offending path, so the editor can focus the field.
      const issue = parsed.error.issues[0];
      throw badRequest(issue?.message ?? "invalid project document", issue === undefined ? null : issue.path.join("."));
    }
    if (parsed.data.id !== id) {
      throw badRequest(`document id "${parsed.data.id}" does not match route id "${id}"`, "id");
    }
    const dir = join(this.ctx.projectsDir, parsed.data.id);
    mkdirSync(dir, { recursive: true });
    const serialised = serializeProject(parsed.data);
    writeFileSync(join(dir, "project.json"), serialised, "utf8");
    this.ctx.logger.info({ project: parsed.data.id }, "forge: project saved");
    return {
      saved: true,
      savedAt: new Date().toISOString(),
      sourceHash: createHash("sha256").update(serialised).digest("hex"),
    };
  }

  /**
   * Build a project, and optionally put it where EE will find it. The install
   * step belongs to the same call because a build still sitting in
   * `projects/<id>/build/` has not reached the game (ADR-0034 §3).
   */
  /**
   * Generate the files for a project as it would be exported for `project.eeVersion`. Shared by
   * `build` (one target, optionally installed) and `exportBundle` (one or two targets).
   */
  /** The scan a build of this project would check against, and the installation it came from. */
  private libraryFor(project: EEProject, libraryInstall: string | null | undefined): { library: EELibrary | null; source: ForgeLibrarySource | null } {
    let selection;
    if (libraryInstall !== undefined && libraryInstall !== null && libraryInstall !== "") {
      const chosen = this.installations.get(libraryInstall);
      if (chosen === null) throw notFound(`no registered installation "${libraryInstall}"`, "libraryInstall");
      if (chosen.target !== project.eeVersion) {
        throw unprocessable(`project "${project.id}" targets ${project.eeVersion} but installation ${chosen.label} is ${chosen.target}: its scan says nothing about this engine`, "libraryInstall");
      }
      selection = this.libraries.select({ installId: chosen.id });
    } else {
      selection = this.libraries.select({ target: project.eeVersion });
    }
    const { library, installation } = selection;
    return {
      library,
      source:
        library === null
          ? null
          : { installId: installation?.id ?? null, label: installation?.label ?? library.installPath, path: library.installPath, eeVersion: library.eeVersion, verified: installation?.verified ?? false, scannedAt: library.scannedAt },
    };
  }

  private compile(project: EEProject, raw: string, mode: ForgeBuildMode | undefined, libraryInstall?: string | null): ReturnType<typeof buildProject> & { source: ForgeLibrarySource | null } {
    const { library, source } = this.libraryFor(project, libraryInstall);
    let built;
    try {
      built = buildProject(loadCatalog(project.eeVersion), project, {
        sourceHash: createHash("sha256").update(raw).digest("hex"),
        ...(library !== null ? { library } : {}),
        ...(mode !== undefined ? { mode } : {}),
        extensions: this.extensions,
      });
    } catch (error) {
      // Codegen errors are the author's problem, not a server fault.
      const message = error instanceof Error ? error.message : String(error);
      this.ctx.logger.warn({ project: project.id, err: message }, "forge: build rejected");
      throw unprocessable(message);
    }
    // An integrated export leans on an extension's service; say so when that pairing has no evidence.
    if (built.mode === "integrated") {
      for (const extension of this.extensions) {
        const entry = extensionCompatibility(extension, project.eeVersion);
        if (entry.level !== "engine-tested") {
          built = { ...built, warnings: [...built.warnings, `${extension.label} on ${project.eeVersion} is ${entry.level}: ${entry.note}`] };
        }
      }
    }
    return { ...built, source };
  }

  build(id: string, request: BuildRequest = {}): ForgeBuildResult {
    const { project, raw } = this.read(id);
    const built = this.compile(project, raw, request.mode, request.libraryInstall);

    const target = this.resolveInstallTarget(project, request.install ?? null);

    const outDir = join(this.ctx.projectsDir, project.id, "build");
    mkdirSync(outDir, { recursive: true });
    for (const file of built.files) writeFileSync(join(outDir, file.name), file.contents, "utf8");

    let install: ForgeBuildResult["install"] = null;
    if (target !== null) {
      const done = installBuild(target.path, built.files, (file) => file.contents, {
        patchShipTemplates: request.patchShipTemplates === true,
        overwrite: request.overwrite === true,
        backupRoot: join(this.ctx.stateDir, "backups", target.key),
      });
      install = {
        status: done.status,
        ok: done.ok,
        installed: [...done.installed],
        unchanged: [...done.unchanged],
        locked: [...done.locked],
        collisions: [...done.collisions],
        backupDir: done.backupDir,
        restore: { restored: [...done.restore.restored], unrestored: [...done.restore.unrestored] },
        error: done.error,
        needsRestart: done.needsRestart,
        restartFiles: [...done.restartFiles],
        requireLine: done.requireLine,
        required: done.required,
        warnings: [...done.warnings, ...(target.verified ? [] : [`${target.path} is not a recognised build; its version was not verified`])],
      };
    }

    this.ctx.logger.info({ project: project.id, files: built.files.length, warnings: built.warnings.length }, "forge: project built");
    return {
      target: project.eeVersion,
      library: built.source,
      mode: built.mode,
      files: built.files.map((f) => ({ name: f.name, install: f.install, bytes: Buffer.byteLength(f.contents, "utf8") })),
      warnings: [...built.warnings],
      outDir,
      needsLaunchInstall: built.files.some((f) => f.install === "shiptemplates"),
      install,
      launchItems: launchItemsOf(project),
    };
  }

  /**
   * Copy a project from somewhere else into the projects directory. The source (a folder holding
   * `project.json`, or that file) is only read. The copy gets a free id — an existing project is never
   * overwritten — and is stored in the current document format; fields Forge does not interpret are kept.
   */
  importCopy(sourcePath: string): ForgeImportResult {
    const source = resolve(sourcePath);
    if (!existsSync(source)) throw notFound(`no such file or folder: ${sourcePath}`, "path");
    const isDir = statSync(source).isDirectory();
    const file = isDir ? join(source, "project.json") : source;
    if (!existsSync(file)) throw unprocessable(`${sourcePath} has no project.json`, "path");
    if (!isDir && basename(file).toLowerCase() !== "project.json") {
      throw unprocessable(`${basename(file)} is not a project.json — pick the project folder or its project.json`, "path");
    }

    let imported;
    try {
      imported = importProject(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      throw unprocessable(`${file} is not a usable project: ${error instanceof Error ? error.message : String(error)}`, "path");
    }

    const originalId = imported.project.id;
    let id = originalId;
    for (let n = 2; existsSync(join(this.ctx.projectsDir, id, "project.json")); n += 1) id = `${originalId}_${n}`;
    const project: EEProject = id === originalId ? imported.project : { ...imported.project, id };

    const dir = join(this.ctx.projectsDir, id);
    mkdirSync(dir, { recursive: true });
    const serialised = serializeProject(project);
    writeFileSync(join(dir, "project.json"), serialised, "utf8");
    this.ctx.logger.info({ project: id, from: file, renamed: id !== originalId }, "forge: project imported");
    return {
      project: summarise(project, new Date().toISOString()),
      id,
      renamedFrom: id === originalId ? null : originalId,
      sourceKind: isDir ? "directory" : "file",
      fromVersion: imported.fromVersion,
      toVersion: imported.toVersion,
      preserved: [...imported.preserved],
      lost: [...imported.lost],
    };
  }

  /**
   * Export a project for one or both engines into `<outRoot>/<id>/<target>/scripts/…` (the layout of an EE
   * install) plus `<outRoot>/<id>/export-report.json`. Each target is built on its own — its catalog, its
   * library, its dialogue/API branches — and a failure on one never stops the other. Nothing is copied into
   * an EE install here; that is a separate, explicit step.
   */
  exportBundle(id: string, request: { targets: readonly string[]; mode?: ForgeBuildMode; outRoot: string; libraryInstalls?: Readonly<Record<string, string>> }): ForgeExportResult {
    const { project, raw } = this.read(id);
    const targets = [...new Set(request.targets)];
    if (targets.length === 0) throw badRequest("choose at least one target", "targets");
    for (const target of targets) {
      try {
        requireTarget(target);
      } catch (error) {
        throw badRequest(error instanceof Error ? error.message : String(error), "targets");
      }
    }

    const outRoot = join(resolve(request.outRoot), project.id);
    mkdirSync(outRoot, { recursive: true });
    // The installation the author chose for an engine, when it really is one of that engine; otherwise the newest scan.
    const scanFor = (target: string): string | null => {
      const chosen = request.libraryInstalls?.[target];
      return chosen !== undefined && this.installations.get(chosen)?.target === target ? chosen : null;
    };
    const results: ForgeExportTargetResult[] = targets.map((target) => {
      const outDir = join(outRoot, target);
      const compatibility = {
        vanilla: vanillaCompatibility(target),
        extensions: this.extensions.map((extension) => ({ id: extension.id, ...extensionCompatibility(extension, target) })),
      };
      try {
        const built = this.compile({ ...project, eeVersion: target }, raw, request.mode, scanFor(target));
        for (const file of built.files) {
          const dest = file.install === "shiptemplates" ? join(outDir, "scripts", "shiptemplates", file.name) : join(outDir, "scripts", file.name);
          mkdirSync(join(dest, ".."), { recursive: true });
          writeFileSync(dest, file.contents, "utf8");
        }
        return {
          target,
          library: built.source,
          ok: true,
          outDir,
          mode: built.mode,
          files: built.files.map((f) => ({ name: f.name, install: f.install, bytes: Buffer.byteLength(f.contents, "utf8") })),
          warnings: [...built.warnings],
          error: null,
          needsLaunchInstall: built.files.some((f) => f.install === "shiptemplates"),
          launchItems: launchItemsOf(project),
          compatibility,
        };
      } catch (error) {
        return {
          target,
          library: this.libraryFor({ ...project, eeVersion: target }, scanFor(target)).source,
          ok: false,
          outDir,
          mode: null,
          files: [],
          warnings: [],
          error: error instanceof Error ? error.message : String(error),
          needsLaunchInstall: false,
          launchItems: { templates: [], models: [] },
          compatibility,
        };
      }
    });

    const result: ForgeExportResult = { projectId: project.id, outRoot, reportPath: join(outRoot, "export-report.json"), targets: results };
    writeFileSync(result.reportPath, `${JSON.stringify({ ...result, exportedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    this.ctx.logger.info({ project: project.id, targets: results.map((r) => `${r.target}:${r.ok ? "ok" : "failed"}`) }, "forge: project exported");
    return result;
  }

  /**
   * What installing this project into an installation would do — the preflight, with nothing written (neither in
   * the install nor in the project's build folder). The same engine check as the install itself: a mismatch is
   * reported as `blocked`, not thrown, so a dialog can show it next to everything else.
   */
  installPreview(id: string, request: { install: string; mode?: ForgeBuildMode; libraryInstall?: string | null; patchShipTemplates?: boolean }): ForgeInstallPreview {
    const { project, raw } = this.read(id);
    const built = this.compile(project, raw, request.mode, request.libraryInstall);
    const registered = this.installations.get(request.install);
    const path = registered?.path ?? request.install;
    const base = {
      target: project.eeVersion,
      mode: built.mode,
      installation: { id: registered?.id ?? null, label: registered?.label ?? path, path, target: registered?.target ?? null, verified: registered?.verified ?? false },
      files: [] as ForgeInstallPreview["files"],
      collisions: [] as string[],
      locked: [] as string[],
      wouldBackUp: [] as string[],
      requireLine: null,
      requireState: "not-needed" as const,
      needsRestart: false,
      clear: false,
      warnings: [] as string[],
    };
    try {
      const target = this.resolveInstallTarget(project, request.install);
      if (target === null) return { ...base, blocked: "no installation chosen" };
      const preview = previewInstall(target.path, built.files, (f) => f.contents, { patchShipTemplates: request.patchShipTemplates !== false });
      return {
        ...base,
        files: preview.files.map((f) => ({ ...f })),
        collisions: [...preview.collisions],
        locked: [...preview.locked],
        wouldBackUp: [...preview.wouldBackUp],
        requireLine: preview.requireLine,
        requireState: preview.requireState,
        needsRestart: preview.needsRestart,
        clear: preview.clear,
        blocked: null,
        warnings: target.verified ? [] : [`${target.path} is not a recognised build; its version was not verified`],
      };
    } catch (error) {
      return { ...base, blocked: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Where a build may be copied, refusing an engine other than the project's target. */
  private resolveInstallTarget(project: EEProject, install: string | null): { path: string; verified: boolean; key: string } | null {
    if (install === null || install === "") return null;
    const registered = this.installations.get(install);
    const path = registered?.path ?? install;
    if (!existsSync(path)) throw notFound(`no such directory: ${install}`, "install");
    if (registered !== null) this.installations.assertStillIdentical(registered);

    const detected = detectInstallTarget(path);
    const target = detected ?? (registered !== null && !registered.verified ? registered.target : null);
    // Content built for one engine must not land in another's scripts/.
    if (target !== null && target !== project.eeVersion) {
      throw unprocessable(`project "${project.id}" targets ${project.eeVersion} but ${path} is ${target}`, "install");
    }
    return { path, verified: detected !== null, key: registered?.id ?? createHash("sha256").update(path).digest("hex").slice(0, 12) };
  }
}
