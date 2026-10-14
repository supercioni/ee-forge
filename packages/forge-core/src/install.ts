import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { BuildFile } from "./codegen/build.js";

/**
 * Putting a built project where EmptyEpsilon will find it.
 *
 * Lives in the toolkit rather than the CLI because the editor has to do
 * this too. Ship templates load **only during EE's launch-time template
 * phase** — `ShipTemplate()` from a scenario is refused outright
 * (`ShipTemplate objects can not be created during a scenario`) — so a
 * project that defines any is not a drop-in: its templates file goes in
 * `scripts/shiptemplates/`, `shipTemplates.lua` has to name it, and EE has
 * to be restarted. An editor that generates the files and then leaves the
 * author to do that by hand has only done half the job.
 *
 * Everything here **returns** what happened instead of printing it; the
 * CLI renders the result, and so does the editor.
 */

/** How an install ended. Only `installed` means the bundle is in place and usable. */
export type InstallStatus =
  /** Every file written and read back; nothing else is needed (a restart may still be listed in `restart`). */
  | "installed"
  /** Written and read back, but a manual step is still missing (the `require` line): the templates will not load yet. */
  | "installed-pending"
  /** Preflight said no — a collision, a locked file, a failed backup. Nothing in the install was touched. */
  | "refused"
  /** A write failed part-way; everything written was put back. The install is as it was. */
  | "rolled-back"
  /** A write failed AND putting a file back failed: `restore.unrestored` names what to fix by hand. The only partial state. */
  | "rollback-failed";

export interface InstallResult {
  readonly status: InstallStatus;
  /** True only for `installed`. Callers must not report success on anything else. */
  readonly ok: boolean;
  /** Absolute paths written (created or replaced), in build order. Empty unless the bundle went in. */
  readonly installed: readonly string[];
  /** Files already identical to the build: left alone. */
  readonly unchanged: readonly string[];
  /**
   * Files a running EmptyEpsilon is holding open.
   *
   * EE keeps a handle on every script it has loaded, and leaks one when a
   * load errors part-way, so a write can fail with a sharing violation for a
   * reason that has nothing to do with the project. Found by the preflight,
   * before anything is written: one locked file refuses the whole install.
   */
  readonly locked: readonly string[];
  /**
   * Files that exist in the install and were not put there by this tool (or were edited since). The
   * install is refused unless the caller passes `overwrite`, in which case they are backed up first.
   */
  readonly collisions: readonly string[];
  /** Where the originals of every replaced file were copied before writing; null when nothing was replaced. */
  readonly backupDir: string | null;
  /** Set for `rolled-back` / `rollback-failed`. */
  readonly restore: { readonly restored: readonly string[]; readonly unrestored: readonly string[] };
  /** The error that stopped the install, when there was one. */
  readonly error: string | null;
  /** True when a templates file was installed or changed: EE must be restarted before it exists. */
  readonly needsRestart: boolean;
  /** Files of the bundle EE only reads at launch (templates, models). Listed apart from the scenario files. */
  readonly restartFiles: readonly string[];
  /** The `require` line `shipTemplates.lua` needs, when one is needed. */
  readonly requireLine: string | null;
  /** Whether that line is now present — patched by us or already there. */
  readonly required: boolean;
  readonly warnings: readonly string[];
}

export interface InstallOptions {
  /** Append the `require` line to `shipTemplates.lua` (the one EE-owned file this tool writes). Opt-in. */
  readonly patchShipTemplates?: boolean;
  /** Replace files this tool did not install (they are backed up first). Default: refuse. */
  readonly overwrite?: boolean;
  /** Where backups go. Default: `<install>/.ee-forge-backups`. Desktop passes a folder in the user's data. */
  readonly backupRoot?: string;
  /** Test seam: the clock for the backup folder name. */
  readonly now?: () => Date;
  /** Test seam: replaces the atomic write of one file (throw to simulate a failure part-way). */
  readonly writeFile?: (path: string, contents: string) => void;
}

const LEDGER = ".ee-forge-ledger.json";
const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

interface LedgerFile {
  version: 1;
  files: Record<string, { sha256: string; installedAt: string }>;
}

function readLedger(scripts: string): LedgerFile {
  try {
    const parsed = JSON.parse(readFileSync(join(scripts, LEDGER), "utf8")) as Partial<LedgerFile>;
    if (parsed.version === 1 && parsed.files !== undefined && typeof parsed.files === "object") return parsed as LedgerFile;
  } catch {
    // no ledger, or one we cannot read: nothing is "ours", so every existing file is a collision
  }
  return { version: 1, files: {} };
}

/** Write through a temporary sibling and rename: a reader never sees half a file, and an open target fails the rename. */
function atomicWrite(path: string, contents: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.forge-tmp`;
  try {
    writeFileSync(temp, contents);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** True when the file can be opened for writing now (a running EE that holds it makes this fail on Windows). */
function writable(path: string): boolean {
  try {
    closeSync(openSync(path, "r+"));
    return true;
  } catch {
    return false;
  }
}

const rel = (scripts: string, path: string): string => relative(scripts, path).split(sep).join("/");

const emptyRestore = { restored: [], unrestored: [] } as const;

/**
 * Copy a built project's files into an EE install, all or nothing.
 *
 * 1. **Preflight** (nothing is written): the install has `scripts/`; no file of the bundle is held open;
 *    no existing file is foreign (not written by this tool, or edited since) unless `overwrite`; the
 *    backup of every file about to be replaced was made.
 * 2. **Write** each file through a temporary sibling, read it back and compare its hash; then the optional
 *    `require` line; the ledger last.
 * 3. **Any failure puts everything back** from the backup (and deletes what was created). The result says
 *    `rolled-back`; only when restoring itself fails is it `rollback-failed`, with the files to fix by hand.
 *
 * `shipTemplates.lua` is the one EE-owned file written, only with `patchShipTemplates`, and it is backed up
 * like the rest. The result never says `installed` for anything less than the whole bundle in place.
 */
export function installBuild(
  eeInstall: string,
  files: readonly BuildFile[],
  contentsOf: (file: BuildFile) => string,
  patchShipTemplatesOrOptions: boolean | InstallOptions = false,
): InstallResult {
  const options: InstallOptions = typeof patchShipTemplatesOrOptions === "boolean" ? { patchShipTemplates: patchShipTemplatesOrOptions } : patchShipTemplatesOrOptions;
  const scripts = join(eeInstall, "scripts");
  if (!existsSync(scripts)) throw new Error(`no scripts/ directory under ${eeInstall}`);
  const write = options.writeFile ?? atomicWrite;
  const warnings: string[] = [];

  const templateFile = files.find((f) => f.install === "shiptemplates");
  const ledger = readLedger(scripts);
  const stamp = (options.now?.() ?? new Date()).toISOString();

  interface Entry { file: BuildFile; target: string; key: string; text: string; hash: string; existed: boolean; existingHash: string | null; unreadable: boolean; action: "create" | "update" | "unchanged" }
  const entries: Entry[] = files.map((file) => {
    const target = file.install === "shiptemplates" ? join(scripts, "shiptemplates", file.name) : join(scripts, file.name);
    const text = contentsOf(file);
    const hash = sha(text);
    const key = rel(scripts, target);
    const existed = existsSync(target);
    // A file another program holds open exclusively cannot even be read on Windows: that is "locked", not a crash.
    let existingHash: string | null = null;
    let unreadable = false;
    if (existed) {
      try {
        existingHash = sha(readFileSync(target));
      } catch {
        unreadable = true;
      }
    }
    const action = !existed ? "create" : unreadable ? "update" : existingHash === hash ? "unchanged" : "update";
    return { file, target, key, text, hash, existed, existingHash, unreadable, action };
  });

  const restartFiles = entries.filter((e) => e.file.install === "shiptemplates" && e.action !== "unchanged").map((e) => e.target);

  const refuse = (status: InstallStatus, extra: Partial<InstallResult>): InstallResult => ({
    status, ok: false, installed: [], unchanged: [], locked: [], collisions: [], backupDir: null, restore: emptyRestore, error: null,
    needsRestart: false, restartFiles: [], requireLine: null, required: false, warnings, ...extra,
  });

  // --- preflight: collisions
  const collisions = entries
    .filter((e) => e.action === "update" && !e.unreadable && ledger.files[e.key]?.sha256 !== e.existingHash)
    .map((e) => e.target);
  if (collisions.length > 0 && options.overwrite !== true) {
    return refuse("refused", {
      collisions,
      error: `${collisions.length} file(s) already exist in the install and were not installed by EE FORGE (or were edited since): ${collisions.join(", ")}. Nothing was changed.`,
    });
  }
  if (collisions.length > 0) warnings.push(`replacing ${collisions.length} file(s) EE FORGE did not install; originals are in the backup`);

  // --- preflight: locked files
  const toReplace = entries.filter((e) => e.action === "update");
  const locked = toReplace.filter((e) => e.unreadable || !writable(e.target)).map((e) => e.target);
  const indexPath = join(scripts, "shipTemplates.lua");
  const plan = templateFile === undefined ? null : planRequire(scripts, templateFile.name, options.patchShipTemplates === true);
  if (plan !== null && (plan.unreadable || (plan.newText !== null && !writable(indexPath)))) locked.push(indexPath);
  if (locked.length > 0) {
    return refuse("refused", {
      locked,
      collisions,
      error: `${locked.length} file(s) are held open by a running EmptyEpsilon: ${locked.join(", ")}. Close EE (or leave the mission) and install again. Nothing was changed.`,
    });
  }

  // --- backup of everything about to be replaced
  const replaced: Array<{ target: string; key: string }> = toReplace.map((e) => ({ target: e.target, key: e.key }));
  if (plan !== null && plan.newText !== null) replaced.push({ target: indexPath, key: "shipTemplates.lua" });
  const ledgerPath = join(scripts, LEDGER);
  const ledgerExisted = existsSync(ledgerPath);
  let backupDir: string | null = null;
  if (replaced.length > 0 || ledgerExisted) {
    const safeStamp = stamp.replace(/[:.]/g, "-");
    backupDir = join(options.backupRoot ?? join(eeInstall, ".ee-forge-backups"), safeStamp);
    try {
      for (const item of replaced) {
        const to = join(backupDir, ...item.key.split("/"));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(item.target, to);
        if (sha(readFileSync(to)) !== sha(readFileSync(item.target))) throw new Error(`backup of ${item.target} did not read back identical`);
      }
      if (ledgerExisted) {
        mkdirSync(backupDir, { recursive: true });
        copyFileSync(ledgerPath, join(backupDir, LEDGER));
      }
      writeFileSync(join(backupDir, "backup.json"), JSON.stringify({ createdAt: stamp, install: eeInstall, files: replaced.map((r) => r.key) }, null, 2));
    } catch (error) {
      return refuse("refused", { error: `could not back up the files to be replaced (${msg(error)}); nothing was changed.` });
    }
  }

  // --- write, verify; on any failure put everything back
  const touched: Array<{ target: string; key: string; created: boolean }> = [];
  try {
    for (const entry of entries) {
      if (entry.action === "unchanged") continue;
      touched.push({ target: entry.target, key: entry.key, created: !entry.existed });
      write(entry.target, entry.text);
      if (sha(readFileSync(entry.target)) !== entry.hash) throw new Error(`${entry.target} did not read back as written`);
    }
    if (plan !== null && plan.newText !== null) {
      touched.push({ target: indexPath, key: "shipTemplates.lua", created: false });
      write(indexPath, plan.newText);
      if (sha(readFileSync(indexPath)) !== sha(plan.newText)) throw new Error(`${indexPath} did not read back as written`);
    }
    const next: LedgerFile = { version: 1, files: { ...ledger.files } };
    for (const entry of entries) next.files[entry.key] = { sha256: entry.hash, installedAt: stamp };
    touched.push({ target: ledgerPath, key: LEDGER, created: !ledgerExisted });
    write(ledgerPath, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    const restore = rollback(touched, backupDir);
    const unrestored = restore.unrestored;
    return refuse(unrestored.length === 0 ? "rolled-back" : "rollback-failed", {
      collisions, backupDir, restore, error: unrestored.length === 0
        ? `the install failed (${msg(error)}) and every file was put back; the install is as it was.`
        : `the install failed (${msg(error)}) and ${unrestored.length} file(s) could not be put back: ${unrestored.join(", ")}. Restore them from ${backupDir ?? "(no backup)"}.`,
    });
  }

  const required = plan === null ? false : plan.present || plan.newText !== null;
  const requireLine = plan === null ? null : plan.requireLine;
  warnings.push(...(plan === null ? [] : plan.warnings));
  const complete = templateFile === undefined || required;
  return {
    status: complete ? "installed" : "installed-pending",
    ok: complete,
    installed: entries.filter((e) => e.action !== "unchanged").map((e) => e.target),
    unchanged: entries.filter((e) => e.action === "unchanged").map((e) => e.target),
    locked: [], collisions, backupDir, restore: emptyRestore,
    error: complete ? null : `the files are in place, but the templates will not load until ${requireLine} is added to shipTemplates.lua.`,
    needsRestart: restartFiles.length > 0 || (plan !== null && plan.newText !== null),
    restartFiles, requireLine, required, warnings,
  };
}

/** What one file of the bundle would do to the install. */
export type InstallFileAction = "create" | "replace" | "unchanged" | "collision" | "locked";

export interface InstallPreview {
  readonly files: ReadonlyArray<{ readonly name: string; readonly path: string; readonly kind: BuildFile["install"]; readonly action: InstallFileAction }>;
  /** Existing files EE FORGE did not install (or that were edited since). */
  readonly collisions: readonly string[];
  /** Files a running EmptyEpsilon holds open. */
  readonly locked: readonly string[];
  /** What would be copied to the backup folder first (replaced files; with a collision only if overwrite is allowed). */
  readonly wouldBackUp: readonly string[];
  /** The line `shipTemplates.lua` needs, and whether it is there, would be added, or must be added by hand. */
  readonly requireLine: string | null;
  readonly requireState: "not-needed" | "present" | "will-add" | "by-hand" | "no-index";
  /** A templates file would be written: EE has to be restarted before the hulls exist. */
  readonly needsRestart: boolean;
  /** `installBuild` without `overwrite` would go ahead. */
  readonly clear: boolean;
}

/**
 * What `installBuild` would find, without writing anything: the same preflight, as a list.
 *
 * Meant to be shown before the author confirms — which files are new, which replace something, which are
 * someone else's (and so need an explicit yes), which a running EmptyEpsilon holds open. It reads the install
 * and nothing else; `installBuild` still runs its own preflight, so a change between the two is caught there.
 */
export function previewInstall(
  eeInstall: string,
  files: readonly BuildFile[],
  contentsOf: (file: BuildFile) => string,
  options: Pick<InstallOptions, "patchShipTemplates"> = {},
): InstallPreview {
  const scripts = join(eeInstall, "scripts");
  if (!existsSync(scripts)) throw new Error(`no scripts/ directory under ${eeInstall}`);
  const ledger = readLedger(scripts);
  const rows = files.map((file) => {
    const path = file.install === "shiptemplates" ? join(scripts, "shiptemplates", file.name) : join(scripts, file.name);
    const hash = sha(contentsOf(file));
    const key = rel(scripts, path);
    if (!existsSync(path)) return { file, path, key, action: "create" as InstallFileAction, existing: null as string | null };
    let existing: string | null = null;
    try {
      existing = sha(readFileSync(path));
    } catch {
      return { file, path, key, action: "locked" as InstallFileAction, existing };
    }
    if (existing === hash) return { file, path, key, action: "unchanged" as InstallFileAction, existing };
    if (!writable(path)) return { file, path, key, action: "locked" as InstallFileAction, existing };
    return { file, path, key, action: (ledger.files[key]?.sha256 === existing ? "replace" : "collision") as InstallFileAction, existing };
  });
  const templateFile = files.find((f) => f.install === "shiptemplates");
  const plan = templateFile === undefined ? null : planRequire(scripts, templateFile.name, options.patchShipTemplates === true);
  const locked = rows.filter((r) => r.action === "locked").map((r) => r.path);
  const indexPath = join(scripts, "shipTemplates.lua");
  if (plan !== null && (plan.unreadable === true || (plan.newText !== null && !writable(indexPath)))) locked.push(indexPath);
  const collisions = rows.filter((r) => r.action === "collision").map((r) => r.path);
  const requireState: InstallPreview["requireState"] =
    plan === null ? "not-needed" : !existsSync(indexPath) ? "no-index" : plan.present ? "present" : plan.newText !== null ? "will-add" : "by-hand";
  return {
    files: rows.map((r) => ({ name: r.file.name, path: r.path, kind: r.file.install, action: r.action })),
    collisions,
    locked,
    wouldBackUp: rows.filter((r) => r.action === "replace" || r.action === "collision").map((r) => r.path),
    requireLine: plan === null ? null : plan.requireLine,
    requireState,
    needsRestart: rows.some((r) => r.file.install === "shiptemplates" && r.action !== "unchanged") || requireState === "will-add",
    clear: collisions.length === 0 && locked.length === 0,
  };
}

const msg = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Put the touched files back from the backup (or delete the ones the install created), then check the result. */
function rollback(
  touched: ReadonlyArray<{ target: string; key: string; created: boolean }>,
  backupDir: string | null,
): { restored: string[]; unrestored: string[] } {
  const restored: string[] = [];
  const unrestored: string[] = [];
  // `force` forgives a missing file, not a missing *folder*: when the write failed because the parent is not a
  // folder, nothing was created there and there is nothing to remove.
  const remove = (path: string): void => {
    try {
      rmSync(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
    }
  };
  for (const item of [...touched].reverse()) {
    try {
      remove(`${item.target}.forge-tmp`);
      if (item.created) {
        remove(item.target);
        if (existsSync(item.target)) throw new Error("still present");
      } else {
        if (backupDir === null) throw new Error("no backup");
        const saved = join(backupDir, ...item.key.split("/"));
        const bytes = readFileSync(saved);
        atomicWrite(item.target, bytes);
        if (sha(readFileSync(item.target)) !== sha(bytes)) throw new Error("did not read back");
      }
      restored.push(item.target);
    } catch {
      unrestored.push(item.target);
    }
  }
  return { restored, unrestored };
}

export interface RequireResult {
  readonly requireLine: string;
  /** True when `shipTemplates.lua` now names the file. */
  readonly present: boolean;
  /** True when this call is what put it there. */
  readonly patched: boolean;
  readonly warnings: readonly string[];
}

/**
 * Name a generated templates file in EE's own `shipTemplates.lua`.
 *
 * Idempotent, and it preserves the file's existing line endings — the
 * install lives on a Windows mount, so rewriting CRLF as LF would show up
 * as a whole-file diff in anything the author uses to inspect it.
 */
export function requireShipTemplates(
  scriptsDir: string,
  fileName: string,
  patch: boolean,
): RequireResult {
  const plan = planRequire(scriptsDir, fileName, patch);
  if (plan.newText !== null) atomicWrite(join(scriptsDir, "shipTemplates.lua"), plan.newText);
  return { requireLine: plan.requireLine, present: plan.present || plan.newText !== null, patched: plan.newText !== null, warnings: plan.warnings };
}

interface RequirePlan {
  readonly requireLine: string;
  /** The line is already in `shipTemplates.lua`. */
  readonly present: boolean;
  /** The new content of `shipTemplates.lua` when it must be patched, else null. */
  readonly newText: string | null;
  readonly warnings: readonly string[];
  /** `shipTemplates.lua` exists but cannot be read (held open by another program). */
  readonly unreadable?: boolean;
}

function planRequire(scriptsDir: string, fileName: string, patch: boolean): RequirePlan {
  const indexPath = join(scriptsDir, "shipTemplates.lua");
  const requireLine = `require("shiptemplates/${fileName}")`;

  if (!existsSync(indexPath)) {
    return { requireLine, present: false, newText: null, warnings: [`${indexPath} not found — add ${requireLine} wherever templates load`] };
  }

  let source: string;
  try {
    source = readFileSync(indexPath, "utf8");
  } catch (error) {
    return { requireLine, present: false, newText: null, warnings: [`${indexPath} cannot be read: ${msg(error)}`], unreadable: true };
  }
  if (source.includes(requireLine)) return { requireLine, present: true, newText: null, warnings: [] };

  if (!patch) {
    return {
      requireLine,
      present: false,
      newText: null,
      warnings: [
        `ship templates will NOT load until this line is added to ${indexPath}: ${requireLine} ` +
          `(EE refuses ShipTemplate() from a scenario — see ADR-0034 §3)`,
      ],
    };
  }

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const separator = source.endsWith(eol) ? "" : eol;
  return { requireLine, present: false, newText: `${source}${separator}-- EE FORGE generated templates${eol}${requireLine}${eol}`, warnings: [] };
}
