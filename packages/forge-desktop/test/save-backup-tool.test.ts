import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The optional campaign-save backup utility (ADR-0058, Amendment 2) is a PowerShell script shipped BESIDE the program. What it does is checked with the real
 * Windows PowerShell by `scripts/ee-collaudo/backup-tool-check.mjs` (24 checks); these tests pin what must never change about how it is built and shipped.
 */
const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const tool = join(pkg, "resources", "save-backup", "forge-save-backup.ps1");
const readme = join(pkg, "resources", "save-backup", "README.txt");
const text = existsSync(tool) ? readFileSync(tool, "utf8") : "";

describe("the optional backup utility", () => {
  it("exists with its instructions, and the installer puts both beside the program, not inside app.asar", () => {
    expect(existsSync(tool)).toBe(true);
    expect(existsSync(readme)).toBe(true);
    const builder = readFileSync(join(pkg, "electron-builder.yml"), "utf8");
    expect(builder).toMatch(/from: save-backup\s+to: Save backup tool/);
    expect(builder).toContain('"!save-backup/**"');
    expect(readFileSync(join(pkg, "scripts", "verify-package.mjs"), "utf8")).toContain("Save backup tool/forge-save-backup.ps1");
  });

  it("is not a service and talks to no network: no scheduled task, no watcher, no web call, no registry", () => {
    expect(text).not.toMatch(/Register-ScheduledTask|schtasks|FileSystemWatcher|Register-ObjectEvent|Start-Job|Invoke-WebRequest|Invoke-RestMethod|System\.Net|New-Service|HKLM|HKCU|Set-ItemProperty/i);
  });

  it("never writes to the source: the source is only opened for reading", () => {
    expect(text).toContain("FileAccess]::Read");
    // every deletion is of a temp or a failed copy, never of $Source
    for (const line of text.split("\n").filter((l) => /Remove-Item/.test(l))) expect(line).not.toMatch(/\$Source|\$sourceFull/);
  });

  it("creates new files only with CreateNew (an existing file is never overwritten), and a restore keeps the file it replaces", () => {
    expect(text).toContain("FileMode]::CreateNew");
    expect(text).toContain("before-restore");
    expect(text).toMatch(/-cne 'RESTORE'/);
  });

  it("refuses to restore while EmptyEpsilon runs, with no override", () => {
    const restore = text.slice(text.indexOf("'restore' {"));
    expect(restore).toContain("Get-RunningGame");
    expect(restore).not.toContain("AllowRunning");
  });

  it("says what its checks mean: valid JSON is not a usable campaign, and a backup does not protect later progress", () => {
    for (const source of [text, readFileSync(readme, "utf8")]) {
      expect(source).toMatch(/Valid JSON is not (proof|a usable campaign)/i);
      expect(source).toMatch(/progress made after/i);
    }
  });
});
