#!/usr/bin/env node
// Builds and installs ONE archive-backed customised model per target into the ISOLATED clones C:\ForgeCollaudo\T\e24 and e26 —
// through the real service (compatibility check against the destination, transactional installer, ledger). Never an original install.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createForgeServices } from "../../../packages/forge-app/dist/index.js";
import { createObject } from "../../../packages/forge-core/dist/editor/factories.js";
import { emptyEEProject, EEProjectSchema } from "../../../packages/forge-contracts/dist/index.js";

const CLONES = [["EE-2024.12.08", "e24", 19824], ["EE-2026.09.22PR", "e26", 19826]];
const state = mkdtempSync(join(tmpdir(), "forge-engine-trial-"));
const services = createForgeServices({ projectsDir: join(state, "projects"), stateDir: join(state, "state") });
const report = [];
for (const [target, clone, port] of CLONES) {
  const dir = `/mnt/c/ForgeCollaudo/T/${clone}`;
  if (!dir.startsWith("/mnt/c/ForgeCollaudo/T/")) throw new Error("refusing: not a test clone");
  const reg = services.installations.register({ path: dir, label: `clone ${clone}` });
  const { library } = services.libraries.rescan(reg.id);
  const stock = library.models.find((m) => m.name === "LindwurmFighterBlue");
  const atlantis = library.templates.find((t) => t.name === "Atlantis");
  if (!stock?.definition || !atlantis) throw new Error(`${clone}: model or template missing from the scan`);
  const model = { ...structuredClone(stock.definition), id: "model_1", name: "archive_trial_model_1", scale: 3.5, radius: 55,
    engineEmitters: [...stock.definition.engineEmitters, { position: [-9, 0, 0], color: [0.2, 0.6, 1], scale: 2 }], origin: { model: stock.name, target } };
  const p = emptyEEProject("archive_trial", "Archive Trial"); p.eeVersion = target; p.models = [model];
  p.templates = [{ ...atlantis, id: "archive_ship", name: "Archive Ship", kind: "playership", copyOf: null, model: model.name }];
  const player = { ...createObject("PlayerSpaceship", "player", { x: 0, y: 0 }, { template: "Archive Ship", callsign: "ARCHIVE-TRIAL" }), rotation: 0 };
  p.map.groups = [{ id: "start", label: "Archive trial", when: "on_start", sector: null, objects: [player] }];
  const project = EEProjectSchema.parse(p);
  mkdirSync(join(state, "projects", project.id), { recursive: true });
  services.projects.save(project.id, project);
  const result = services.projects.build(project.id, { install: reg.id, modelSource: reg.id, patchShipTemplates: true, overwrite: true });
  if (!result.install?.ok) throw new Error(`${clone}: install failed ${JSON.stringify(result.install)}`);
  report.push({ target, clone, port, mesh: model.mesh, texture: model.texture, scale: model.scale, radius: model.radius, engineEmitters: model.engineEmitters.length,
    files: result.files, warnings: result.warnings, status: result.install.status, installed: result.install.installed, requireLine: result.install.requireLine });
  console.log(`${clone}: ${result.install.status}; ${result.files.length} files; resources shipped: ${result.files.filter((f) => f.install === "resources").length}; warnings: ${result.warnings.length}`);
}
writeFileSync(new URL("./engine-trial-install.json", import.meta.url), JSON.stringify(report, null, 2));
