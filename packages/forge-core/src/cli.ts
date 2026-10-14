import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EEDmxRigSchema,
  EELibrarySchema,
  EEProjectSchema,
  type EELibrary,
} from "@forge/contracts";
import { generateCatalog } from "./catalog/generate.js";
import { loadCatalog } from "./catalog/load.js";
import { writeHardwareIni } from "./dmx/write.js";
import { buildProject } from "./codegen/build.js";
import { simulate, type SimEvent, type SimExodus, type SimOptions } from "./logic/simulate.js";
import { projectIdFor, starterProject } from "./editor/factories.js";
import { scanInstall } from "./scan/install.js";
import { detectInstallTarget } from "./scan/detect.js";
import { TARGET_2026 } from "./targets.js";
import { installBuild } from "./install.js";
import { importProject, serializeProject } from "./project/migrate.js";
import { mirrorInstallAssets } from "./scan/assets.js";

/**
 * EE FORGE command line.
 *
 *   ee:catalog   regenerate the API catalog from an EE install
 *   ee:scan      index an install's templates / models / factions / resources
 *   forge:build  render a project document to the portable Lua bundle
 *   forge:simulate  dry-run a project's narrative without EmptyEpsilon
 */


interface Args {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { positional, flags };
}

function flagString(args: Args, name: string): string | null {
  const value = args.flags[name];
  return typeof value === "string" ? value : null;
}

function requireFlag(args: Args, name: string): string {
  const value = flagString(args, name);
  if (value === null) {
    throw new Error(`missing required --${name}`);
  }
  return value;
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Monorepo root — `packages/ee-forge` sits two levels below it. */
function repoRoot(): string {
  return resolve(packageRoot(), "..", "..");
}

/**
 * Accept a path relative to the working directory *or* to the repo root.
 * `pnpm --filter @forge/core forge:build projects/demo` runs with the
 * package as cwd, while the same command typed at the repo root does not —
 * resolving both keeps one documented invocation working from either place.
 */
function resolveUnderRepo(path: string): string {
  const fromCwd = resolve(process.cwd(), path);
  if (existsSync(fromCwd)) return fromCwd;
  const fromRepo = resolve(repoRoot(), path);
  if (existsSync(fromRepo)) return fromRepo;
  return fromCwd;
}

function loadLibrary(path: string | null): EELibrary | undefined {
  if (path === null) return undefined;
  if (!existsSync(path)) {
    console.warn(`! library ${path} not found — reference checks will be skipped`);
    return undefined;
  }
  return EELibrarySchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * The engine an install actually is. An explicit `--ee-version` must agree
 * with the install's own script reference when that is recognisable; an
 * unrecognised install needs the flag, and is then reported as unverified.
 */
function resolveEngine(eeInstall: string, flag: string | null): string {
  const detected = detectInstallTarget(eeInstall);
  if (flag !== null && detected !== null && flag !== detected) {
    throw new Error(`--ee-version ${flag} but ${eeInstall} is ${detected}`);
  }
  const engine = flag ?? detected;
  if (engine === null) {
    throw new Error(
      `${eeInstall} is not a recognised EmptyEpsilon build; pass --ee-version after adding it to the target registry`,
    );
  }
  return engine;
}

function cmdCatalog(args: Args): void {
  const eeInstall = requireFlag(args, "ee-install");
  const eeVersion = resolveEngine(eeInstall, flagString(args, "ee-version"));
  // 2026 keeps its historical file; other targets go under targets/ so
  // regenerating one never overwrites another's catalog.
  const outDir =
    flagString(args, "out-dir") ??
    (eeVersion === TARGET_2026
      ? join(packageRoot(), "src", "catalog")
      : join(packageRoot(), "src", "catalog", "targets"));
  const outName = flagString(args, "out-dir") === null && eeVersion !== TARGET_2026 ? eeVersion : null;

  const result = generateCatalog({ eeInstall, eeVersion, outDir, ...(outName !== null ? { fileName: `${outName}.json` } : {}) });
  console.log(`catalog written: ${result.outPath}`);
  console.log(
    `  ${result.classCount} classes, ${result.methodCount} methods, ` +
      `${result.globalCount} globals, ${result.enumCount} enums (${eeVersion})`,
  );
}

function cmdScan(args: Args): void {
  const eeInstall = requireFlag(args, "ee-install");
  const eeVersion = resolveEngine(eeInstall, flagString(args, "ee-version"));
  const out = flagString(args, "out") ?? join(repoRoot(), "projects", "ee-library.json");

  const library = scanInstall({ eeInstall, eeVersion });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(library, null, 2)}\n`, "utf8");

  console.log(`library written: ${out}`);
  console.log(
    `  ${library.templates.length} templates, ${library.models.length} models, ` +
      `${library.factions.length} factions`,
  );
  console.log(
    `  resources: ${library.resources.radarTraces.length} radar traces, ` +
      `${library.resources.planetTextures.length} planet textures, ` +
      `${library.resources.meshes.length} meshes, ${library.resources.textures.length} textures`,
  );
  // Indexing without mirroring leaves the canvas asking for images nobody
  // copied, which reads as a broken texture rather than a missing step.
  const mirror = mirrorInstallAssets(eeInstall, join(repoRoot(), "assets"));
  console.log(
    mirror.copied.length === 0
      ? "  assets already current"
      : `  copied ${mirror.copied.length} asset(s): ${mirror.copied.join(", ")}`,
  );
  for (const warning of [...library.warnings, ...mirror.warnings]) console.warn(`  ! ${warning}`);
}

function readProject(projectDir: string): {
  project: ReturnType<typeof EEProjectSchema.parse>;
  hash: string;
} {
  const path = join(projectDir, "project.json");
  if (!existsSync(path)) {
    throw new Error(`no project.json in ${projectDir}`);
  }
  const source = readFileSync(path, "utf8");
  return {
    project: importProject(JSON.parse(source)).project,
    hash: createHash("sha256").update(source).digest("hex"),
  };
}

function cmdNew(args: Args): void {
  const name = args.positional[1];
  if (name === undefined) {
    throw new Error('usage: forge:new "<scenario name>" [--dir projects] [--id my-id]');
  }
  const parent = resolveUnderRepo(flagString(args, "dir") ?? "projects");
  const taken = new Set(
    existsSync(parent)
      ? readdirSync(parent).filter((entry) => existsSync(join(parent, entry, "project.json")))
      : [],
  );
  const id = flagString(args, "id") ?? projectIdFor(taken, name);
  const dir = join(parent, id);
  if (existsSync(join(dir, "project.json"))) {
    // Same rule as the editor's create route: never overwrite a scenario
    // because a name happened to slug to an id already in use.
    throw new Error(`project "${id}" already exists at ${dir}`);
  }

  mkdirSync(dir, { recursive: true });
  const project = starterProject(id, name);
  writeFileSync(join(dir, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  console.log(`created ${join(dir, "project.json")}`);
  console.log(`  one on_start group ("Core") with one player ship`);
  console.log(`  next: open it in the editor, or forge:build ${dir}`);
}

function cmdBuild(args: Args): void {
  const input = args.positional[1];
  if (input === undefined) throw new Error("usage: forge:build <project-dir>");
  const projectDir = resolveUnderRepo(input);

  const { project, hash } = readProject(projectDir);
  const libraryFlag = flagString(args, "library");
  const library = loadLibrary(libraryFlag === null ? null : resolveUnderRepo(libraryFlag));
  // This command carries no extensions, so it exports vanilla (and says what is
  // left to decide); an integrated export is the host's — the bridge or the app.
  const modeFlag = flagString(args, "mode");
  if (modeFlag !== null && modeFlag !== "vanilla" && modeFlag !== "integrated") {
    throw new Error(`--mode must be vanilla or integrated, not "${modeFlag}"`);
  }
  const result = buildProject(loadCatalog(project.eeVersion), project, {
    sourceHash: hash,
    ...(modeFlag !== null ? { mode: modeFlag } : {}),
    ...(library !== undefined ? { library } : {}),
  });

  const outDir = flagString(args, "out-dir") ?? join(projectDir, "build");
  mkdirSync(outDir, { recursive: true });
  for (const file of result.files) {
    writeFileSync(join(outDir, file.name), file.contents, "utf8");
    console.log(`  wrote ${join(outDir, file.name)}`);
  }

  for (const warning of result.warnings) console.warn(`  ! ${warning}`);

  const install = flagString(args, "install");
  if (install !== null) {
    const installed = installBuild(install, result.files, (file) => file.contents, {
      patchShipTemplates: args.flags["patch-shiptemplates"] === true,
      overwrite: args.flags["overwrite"] === true,
    });
    for (const path of installed.installed) console.log(`  installed ${path}`);
    for (const path of installed.unchanged) console.log(`  unchanged ${path}`);
    for (const warning of installed.warnings) console.warn(`  ! ${warning}`);
    if (installed.backupDir !== null) console.log(`  originals backed up in ${installed.backupDir}`);
    if (installed.status !== "installed") {
      // Never print a success line for anything less than the whole bundle in place.
      console.error(`  INSTALL ${installed.status.toUpperCase()}: ${installed.error ?? ""}`);
      if (installed.collisions.length > 0) console.error("    Re-run with --overwrite to replace them (they are backed up first).");
      if (installed.requireLine !== null && !installed.required) console.error(`    Re-run with --patch-shiptemplates to append the require line automatically.`);
      process.exitCode = 1;
    } else if (installed.needsRestart) {
      console.log(`  ship templates and models load at launch — RESTART EmptyEpsilon (${installed.restartFiles.join(", ")}).`);
    }
  }

  console.log(
    `built ${project.id}: ${result.files.length} files, ${result.warnings.length} warning(s)`,
  );
}

function cmdSimulate(args: Args): void {
  const input = args.positional[1];
  if (input === undefined) throw new Error("usage: forge:simulate <project-dir>");

  const { project } = readProject(resolveUnderRepo(input));
  const until = Number(flagString(args, "until") ?? "600");

  let events: SimEvent[] = [];
  const eventsPath = flagString(args, "events");
  if (eventsPath !== null) {
    events = JSON.parse(readFileSync(eventsPath, "utf8")) as SimEvent[];
  }

  // EXODUS during the run: `vanilla` (export without it), `absent`, `stale` (a beacon left behind), `incompatible`, `running` (default).
  const exodusFlag = flagString(args, "exodus");
  const exodus: SimExodus | undefined =
    exodusFlag === null
      ? undefined
      : exodusFlag === "vanilla"
        ? { mode: "vanilla" }
        : exodusFlag === "absent" || exodusFlag === "stale" || exodusFlag === "incompatible"
          ? { mode: "integrated", service: { kind: exodusFlag } }
          : exodusFlag === "running"
            ? { mode: "integrated", service: { kind: "active" } }
            : (() => {
                throw new Error(`--exodus must be vanilla, absent, stale, incompatible or running, not "${exodusFlag}"`);
              })();
  const result = simulate(project, {
    untilSeconds: until,
    events: events as SimOptions["events"] & SimEvent[],
    ...(exodus !== undefined ? { exodus } : {}),
  });

  console.log(`dry-run ${project.id} — ${until}s virtual`);
  for (const firing of result.firings) {
    const stamp = `T+${String(Math.floor(firing.at / 60)).padStart(2, "0")}:${String(firing.at % 60).padStart(2, "0")}`;
    console.log(`  ${stamp}  [${firing.source}] ${firing.id} — ${firing.label}`);
    for (const action of firing.actions) console.log(`           ${action}`);
  }
  if (result.endedWith !== null) console.log(`  scenario ended: victory ${result.endedWith}`);
  console.log(`  variables: ${JSON.stringify(result.variables)}`);
  for (const line of result.exodusLog) console.log(`  exodus T+${line.at}s  ${line.text}`);
  if (result.notSimulated.length > 0) {
    console.log(`  not simulated: ${result.notSimulated.join("; ")}`);
  }
}

/**
 * Render the DMX rig to `hardware.ini` (ADR-0040).
 *
 * `--install` copies it into the EE directory, **after backing up any
 * file already there**. That asymmetry with `build --install` is
 * deliberate: the scenario files are artefacts of a document, while
 * `hardware.ini` is a singleton somebody may have wired by hand.
 */
function cmdDmx(args: Args): void {
  const rigPath =
    flagString(args, "rig") ?? join(repoRoot(), "projects", "dmx-rig.json");
  if (!existsSync(rigPath)) {
    throw new Error(`no DMX rig at ${rigPath} — build one in the editor's DMX view`);
  }
  const rig = EEDmxRigSchema.parse(JSON.parse(readFileSync(rigPath, "utf8")));
  const contents = writeHardwareIni(rig);

  const outDir = join(dirname(rigPath), "dmx-rig", "build");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "hardware.ini");
  writeFileSync(outPath, contents, "utf8");
  console.log(`  wrote ${outPath}`);

  const install = flagString(args, "install");
  if (install !== null) {
    const target = join(install, "hardware.ini");
    if (existsSync(target)) {
      writeFileSync(`${target}.bak`, readFileSync(target, "utf8"), "utf8");
      console.log(`  backed up existing config to ${target}.bak`);
    }
    writeFileSync(target, contents, "utf8");
    console.log(`  installed ${target}`);
    console.log("  EmptyEpsilon reads hardware.ini at launch — restart it to apply.");
  }

  console.log(
    `built DMX rig: ${rig.devices.length} device(s), ${rig.fixtures.length} fixture(s), ` +
      `${rig.states.length} state(s), ${rig.events.length} event(s)`,
  );
}

/**
 * `forge:migrate <project-dir> --out <dir>` — upgrade a project document to
 * the current schema version into a COPY and report. Without `--out` it is a
 * dry run. The source file is never modified.
 */
function cmdMigrate(args: Args): void {
  const input = args.positional[1];
  if (input === undefined) throw new Error("usage: forge:migrate <project-dir> [--out <dir>]");
  const source = join(resolveUnderRepo(input), "project.json");
  if (!existsSync(source)) throw new Error(`no project.json in ${input}`);

  const imported = importProject(JSON.parse(readFileSync(source, "utf8")));
  console.log(
    `schema v${imported.fromVersion} → v${imported.toVersion}` +
      (imported.applied.length > 0 ? ` (${imported.applied.join(", ")})` : " (already current)"),
  );
  if (imported.preserved.length > 0) {
    console.log(`kept ${imported.preserved.length} field(s) the schema does not model, under "unmodelled"`);
  }
  if (imported.lost.length > 0) {
    throw new Error(`fields would be lost, refusing to continue:\n  ${imported.lost.join("\n  ")}`);
  }

  const out = flagString(args, "out");
  if (out === null) {
    console.log("dry run: pass --out <dir> to write the migrated copy");
    return;
  }
  const dest = resolveUnderRepo(out);
  if (resolve(dest) === resolve(resolveUnderRepo(input))) {
    throw new Error("--out must differ from the project directory: migration never overwrites its source");
  }
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "project.json"), serializeProject(imported.project), "utf8");
  console.log(`wrote ${join(dest, "project.json")}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];

  try {
    switch (command) {
      case "catalog":
        cmdCatalog(args);
        break;
      case "scan":
        cmdScan(args);
        break;
      case "new":
        cmdNew(args);
        break;
      case "build":
        cmdBuild(args);
        break;
      case "simulate":
        cmdSimulate(args);
        break;
      case "migrate":
        cmdMigrate(args);
        break;
      case "dmx":
        cmdDmx(args);
        break;
      default:
        console.error("usage: cli.ts <catalog|scan|new|build|simulate|migrate|dmx> [options]");
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

main();
