import type { ForgeBuildFile, ForgeBuildMode, ForgeBuildResult, ForgeInstallOutcome, ForgeLibrarySource } from "@forge/contracts";

/**
 * What a check, an install or an export was *about* — and so whether it still says anything.
 *
 * A result is only a statement about one version of one document. "Verified" next to a project that has been
 * edited since is a stale claim, so every result carries the revision it was made from and the editor compares:
 * the same revision is *current*, any other is *out of date*. The revision counts edits to the document in the
 * editor (`revision` in the store), not saves: a result is for what was on screen when it ran (which is also
 * what was on disk, because the check saves first).
 */
export type VerificationKind = "verify" | "install";

export type VerificationOutcome =
  /** Generated, and — for an install — every file in place and active. */
  | "passed"
  /** The build refused the document: nothing was generated. */
  | "refused"
  /** An install that did not complete (refused by its preflight, rolled back, or left partly restored). */
  | "failed"
  /** Files are in place but something still has to be done by hand (the require line). */
  | "partial";

export interface VerificationRecord {
  readonly kind: VerificationKind;
  readonly projectId: string;
  readonly projectName: string;
  /** The document revision this result is about. */
  readonly revision: number;
  /** The engine the scenario was generated for. */
  readonly target: string;
  /** Vanilla (nothing of EXODUS) or integrated, as built; null when the build refused before choosing. */
  readonly mode: ForgeBuildMode | null;
  readonly at: string;
  readonly outcome: VerificationOutcome;
  /** The service's own words, in full, when it refused. */
  readonly message: string | null;
  /** Notes from the build that are not structured problems (compatibility, install warnings). */
  readonly warnings: readonly string[];
  readonly files: readonly ForgeBuildFile[];
  /** The scan the references were checked against; null when there was none. */
  readonly library: ForgeLibrarySource | null;
  readonly install: ForgeInstallOutcome | null;
  /** Where it was installed, for an install. */
  readonly installation: { readonly id: string; readonly label: string } | null;
}

export type Freshness = "current" | "outdated" | "other-project";

export function freshnessOf(record: VerificationRecord, now: { readonly projectId: string | null; readonly revision: number }): Freshness {
  if (record.projectId !== now.projectId) return "other-project";
  return record.revision === now.revision ? "current" : "outdated";
}

/** The word a result earns — never "installed" for anything but a complete install. */
export function outcomeFromBuild(result: ForgeBuildResult): VerificationOutcome {
  if (result.install === null) return "passed";
  switch (result.install.status) {
    case "installed":
      return "passed";
    case "installed-pending":
      return "partial";
    default:
      return "failed";
  }
}

export function describeOutcome(record: VerificationRecord): { readonly headline: string; readonly tone: "ok" | "bad" | "partial" } {
  const what = record.kind === "install" ? "Install" : "Verify";
  switch (record.outcome) {
    case "passed":
      return { headline: record.kind === "install" ? "Installed — every file written and read back" : "Generated — the build accepted the document", tone: "ok" };
    case "partial":
      return { headline: "Files copied but NOT active — a step is still missing", tone: "partial" };
    case "refused":
      return { headline: `${what} refused — the build did not accept the document`, tone: "bad" };
    case "failed": {
      const status = record.install?.status;
      if (status === "rolled-back") return { headline: "Not installed — the install failed and every file was put back", tone: "bad" };
      if (status === "rollback-failed") return { headline: "Install failed and is only PARTLY undone — fix the files listed below by hand", tone: "bad" };
      return { headline: "Not installed — refused before anything was written", tone: "bad" };
    }
  }
}

/** One line on what the editor holds relative to the disk, so "which version?" is never a guess. */
export function documentLine(state: { readonly revision: number; readonly savedRevision: number; readonly dirty: boolean }): string {
  return state.dirty
    ? `Editor: unsaved changes (revision ${state.revision}). Disk: revision ${state.savedRevision}. A check or export saves first, so it uses the editor's version.`
    : `Saved, revision ${state.revision}: the editor and the disk are the same.`;
}

export function freshnessLine(freshness: Freshness, record: VerificationRecord, now: { readonly revision: number }): string {
  switch (freshness) {
    case "current":
      return `Current — made from revision ${record.revision}, the document as it is now.`;
    case "outdated":
      return `Out of date — made from revision ${record.revision}; the document is now at revision ${now.revision}, so this result no longer describes it.`;
    case "other-project":
      return `This result is for “${record.projectName}”, not the project that is open.`;
  }
}
