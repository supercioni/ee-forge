import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import { importProject } from "../src/project/migrate.js";
import { TARGET_2024, TARGET_2026 } from "../src/targets.js";

/**
 * "The Lua of a project that does not use campaign saves is unchanged" — pinned by hash, not by the absence of a few words.
 *
 * The expected hashes are those of the files the released Forge 0.8.0 generated for the "Hop Jump" scenario (sectors and Change sector, no saves) and
 * installed into the isolated engine clones on 2026-10-12; the source-dependent header lines (sha256, source, project) are left out. The build of today,
 * with campaign saves in the code but off in the project, must produce the very same text.
 */
const here = dirname(fileURLToPath(import.meta.url));
const strip = (text: string): string => text.split("\n").filter((l) => !/^-- (sha256|source|project)/.test(l)).join("\n");
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

const EXPECTED: Record<string, Record<string, string>> = {
  hop_jump: {
    "hop_jump_content.lua": "f6589269104a5b0ad92a065502889cf3946e98c9cf4610eda7d7e823bdc39777",
    "hop_jump_map.lua": "e7d3e599c70d36627b20fdf096c697a2220cf760687f4a900260e745d360bd60",
    "scenario_hop_jump.lua": "ebfe942c7bd5598969be9ff9df487218e6d96dc5683b465add62bc5ad69a39f2",
  },
  hop_jump_24: {
    "hop_jump_24_content.lua": "332ca1c5d6e64bbf40eb4a2f1ced6bcfb7fe64b0459bf41727967082214ce7d5",
    "hop_jump_24_map.lua": "fc1f29ec2ab9dd26a0fbee77c96dfe936ff5630d1006255d8bbf0bc1208553b7",
    "scenario_hop_jump_24.lua": "9d22676a717508f6416ecdf343ab36a13605bc65ee9233f6e517d483010f7f53",
  },
};

describe("a project with sectors and jumps but no campaign saves generates the Lua the released 0.8.0 generated", () => {
  for (const [id, files] of Object.entries(EXPECTED)) {
    it(`${id}: every file hashes to what 0.8.0 installed`, () => {
      const raw = JSON.parse(readFileSync(join(here, "golden", `${id}.project.json`), "utf8")) as Record<string, unknown>;
      const { project } = importProject(raw);
      expect(project.campaign.persistence).toBe(false);
      const target = project.eeVersion === "EE-2024.12.08" ? TARGET_2024 : TARGET_2026;
      const built = buildProject(loadCatalog(target), project, { sourceHash: "x" });
      expect(built.files.map((f) => f.name).sort()).toEqual(Object.keys(files).sort());
      for (const f of built.files) expect(sha(strip(f.contents)), f.name).toBe(files[f.name]);
    });
  }
});
