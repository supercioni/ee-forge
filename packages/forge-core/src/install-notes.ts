import type { BuildFile } from "./codegen/build.js";

/**
 * The words that go with an export folder: exactly which files to copy where, and — only when the project defines ship
 * templates or models — the one line EmptyEpsilon needs in `shipTemplates.lua` and the restart that makes them exist.
 *
 * A scenario of three files is copy-and-play. A project with templates is not: the templates file is read only while
 * EmptyEpsilon starts, from `scripts/shiptemplates/`, and nothing loads it until `shipTemplates.lua` names it. The two
 * cases are told apart on purpose; an author who follows the short one for a project that needs the long one gets ships
 * that do not exist.
 */
export const INSTALL_NOTES_FILE = "INSTALL.txt";

/** The line `shipTemplates.lua` needs for a templates file. The one definition: the installer writes the same text. */
export const requireLineFor = (fileName: string): string => `require("shiptemplates/${fileName}")`;

export function manualInstallNotes(options: { readonly projectId: string; readonly target: string; readonly files: readonly Pick<BuildFile, "name" | "install">[] }): string {
  const scripts = options.files.filter((f) => f.install === "scripts").map((f) => f.name);
  const launch = options.files.filter((f) => f.install === "shiptemplates").map((f) => f.name);
  const lines: string[] = [`EE FORGE — installing "${options.projectId}" into ${options.target} by hand`, ""];
  lines.push(`This folder mirrors an EmptyEpsilon install: its scripts/ folder goes into the install's scripts/ folder.`, `Use the EmptyEpsilon of the same version (${options.target}); the files are generated for that engine only.`, "");
  if (launch.length === 0) {
    lines.push(`1. Copy these ${scripts.length} files from scripts/ into <EmptyEpsilon>/scripts/:`, ...scripts.map((n) => `     ${n}`), "", `2. Nothing else. This scenario defines no ship templates or models, so no other file has to be edited and EmptyEpsilon does not need a restart: "${options.projectId}" is in the scenario list the next time it is opened.`);
    return `${lines.join("\n")}\n`;
  }
  const entry = launch[0] ?? "";
  lines.push(
    `This project defines ship templates or models, so it is NOT just a scenario: EmptyEpsilon reads those only while it starts.`,
    "",
    `1. Close EmptyEpsilon completely (a running game keeps the template files open and reads them only at launch).`,
    "",
    `2. Copy these ${scripts.length} scenario files from scripts/ into <EmptyEpsilon>/scripts/:`,
    ...scripts.map((n) => `     ${n}`),
    "",
    `3. Copy the launch-time file from scripts/shiptemplates/ into <EmptyEpsilon>/scripts/shiptemplates/ (a different folder):`,
    ...launch.map((n) => `     ${n}`),
    "",
    `4. Open <EmptyEpsilon>/scripts/shipTemplates.lua and add this line AT THE END, once:`,
    `     ${requireLineFor(entry)}`,
    `   If the line is already there (an earlier install), do not add it again.`,
    "",
    `5. Start EmptyEpsilon again and choose "${options.projectId}" in the scenario list. The templates exist only after this restart.`,
    "",
    `Never add the require line to a scenario file or to a running game: it ends the process with no error.`,
    `Using Install scenario in EE FORGE does steps 2-4 for you (with a backup of shipTemplates.lua); step 1 and 5 stay yours.`,
  );
  return `${lines.join("\n")}\n`;
}
