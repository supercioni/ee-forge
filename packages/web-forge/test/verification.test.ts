import { describe, expect, it } from "vitest";
import type { ForgeBuildResult } from "@forge/contracts";
import { describeOutcome, documentLine, freshnessLine, freshnessOf, outcomeFromBuild, type VerificationRecord } from "../src/ui/verification.js";

const record = (over: Partial<VerificationRecord> = {}): VerificationRecord => ({
  kind: "verify", projectId: "p", projectName: "P", revision: 3, target: "EE-2026.09.22PR", mode: "vanilla", at: "2026-10-09T10:00:00Z",
  outcome: "passed", message: null, warnings: [], files: [], library: null, install: null, installation: null, ...over,
});
const install = (status: NonNullable<ForgeBuildResult["install"]>["status"]) =>
  ({ status, ok: status === "installed", installed: [], unchanged: [], locked: [], collisions: [], backupDir: null, restore: { restored: [], unrestored: [] }, error: null, needsRestart: false, restartFiles: [], requireLine: null, required: false, warnings: [] }) as NonNullable<ForgeBuildResult["install"]>;

describe("a result is only as good as the revision it was made from", () => {
  it("is current for the same revision and out of date after any edit", () => {
    expect(freshnessOf(record(), { projectId: "p", revision: 3 })).toBe("current");
    expect(freshnessOf(record(), { projectId: "p", revision: 4 })).toBe("outdated");
    expect(freshnessOf(record(), { projectId: "q", revision: 3 })).toBe("other-project");
  });
  it("says so in words", () => {
    expect(freshnessLine("outdated", record(), { revision: 5 })).toMatch(/Out of date.*revision 3.*revision 5/);
    expect(freshnessLine("current", record(), { revision: 3 })).toMatch(/^Current/);
  });
});

describe("what an outcome may be called", () => {
  const build = (installOutcome: ForgeBuildResult["install"]) => ({ install: installOutcome }) as ForgeBuildResult;
  it("passes a plain build and a complete install only", () => {
    expect(outcomeFromBuild(build(null))).toBe("passed");
    expect(outcomeFromBuild(build(install("installed")))).toBe("passed");
  });
  it("never calls anything else success", () => {
    expect(outcomeFromBuild(build(install("installed-pending")))).toBe("partial");
    for (const status of ["refused", "rolled-back", "rollback-failed"] as const) expect(outcomeFromBuild(build(install(status)))).toBe("failed");
  });
  it("headlines a partial or failed install as not done", () => {
    expect(describeOutcome(record({ kind: "install", outcome: "partial", install: install("installed-pending") })).tone).toBe("partial");
    expect(describeOutcome(record({ kind: "install", outcome: "failed", install: install("rollback-failed") })).headline).toMatch(/PARTLY undone/);
    expect(describeOutcome(record({ kind: "install", outcome: "failed", install: install("rolled-back") })).headline).toMatch(/put back/);
    expect(describeOutcome(record({ outcome: "refused" })).tone).toBe("bad");
  });
});

describe("the editor and the disk", () => {
  it("says which version a check will use", () => {
    expect(documentLine({ revision: 7, savedRevision: 5, dirty: true })).toMatch(/unsaved changes \(revision 7\).*Disk: revision 5.*saves first/);
    expect(documentLine({ revision: 7, savedRevision: 7, dirty: false })).toMatch(/same/);
  });
});
