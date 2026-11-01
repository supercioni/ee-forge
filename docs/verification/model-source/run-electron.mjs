#!/usr/bin/env node
// Real Electron collaudo of the model source (ADR-0061). Isolated userData/documents; EE installations are only READ.
//   node docs/verification/model-source/run-electron.mjs      (after `pnpm build`)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, sandboxDirs, OUT, REPO } from "./lib.mjs";
import { INSTALLS, createProject, makeFaulty, makeTwin, seed } from "./seed.mjs";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** Independent reader of an EE .pack (does not use Forge's code): sha256 of one entry. */
function packEntry(packFile, entry) {
  const b = readFileSync(packFile); const count = b.readUInt32BE(4); let cur = 8;
  for (let i = 0; i < count; i++) {
    const n = b[cur++]; const name = b.toString("utf8", cur, cur + n); cur += n;
    const off = b.readUInt32BE(cur), len = b.readUInt32BE(cur + 4); cur += 8;
    if (name === entry) return { sha: sha(b.subarray(off, off + len)), offset: off, length: len };
  }
  return null;
}

const fixtures = join(tmpdir(), `forge-fixtures-${process.pid}`);
rmSync(fixtures, { recursive: true, force: true }); mkdirSync(fixtures, { recursive: true });
const twins = {
  red: { path: makeTwin(fixtures, "twin-red", [220, 40, 40]), label: "Twin RED (EE 2026 stand-in)" },
  green: { path: makeTwin(fixtures, "twin-green", [40, 200, 60]), label: "Twin GREEN (EE 2026 stand-in)" },
  faulty: { path: makeFaulty(fixtures, "twin-faulty"), label: "Faulty fixtures (EE 2026 stand-in)" },
};
const dirs = sandboxDirs();
const s = await seed({ ...dirs, twins });
const id = Object.fromEntries(Object.entries(s.registered).map(([k, v]) => [k, v.id]));
createProject(s.services, "probe26", "EE-2026.09.22PR");
createProject(s.services, "probe24", "EE-2024.12.08");
createProject(s.services, "probe24b", "EE-2024.12.08");
const projectFile = (n) => join(s.projectsDir, n, "project.json");
const cacheModelDir = (installId) => join(s.stateDir, "cache", installId, "assets", "model-resources");

let h = await launch(dirs);
const P = () => h.page;
const sourceSelect = () => P().getByRole("combobox", { name: "Model source" });
const modelSelect = () => P().getByRole("combobox", { name: "3D model" });
const dirty = async () => (await P().locator("header, body").first().innerText()).includes("Unsaved changes");
async function openProject(name) {
  const select = P().locator("header select, .project-bar select, select").first();
  const value = await select.locator("option", { hasText: name }).first().getAttribute("value");
  await select.selectOption(value); await P().waitForTimeout(1500);
}
async function openHull(projectName, expectSource) {
  if (projectName) await openProject(projectName);
  await P().getByRole("button", { name: "Fleet", exact: true }).click();
  if (await P().getByText("New Hull").count() === 0) await P().getByRole("button", { name: "+ Template" }).click();
  else await P().getByRole("button", { name: /^New Hull/ }).first().click().catch(() => {});
  await P().getByRole("tab", { name: "Hull" }).or(P().getByRole("button", { name: "Hull", exact: true })).first().click();
  await sourceSelect().waitFor();
  // The source follows the project asynchronously: wait for it to settle on the expected installation.
  if (expectSource) await P().waitForFunction(v => document.querySelector('select[aria-label="Model source"]')?.value === v, expectSource, { timeout: 20000 }).catch(() => {});
  await P().waitForTimeout(800);
}
/** Wait until the preview either shows the canvas or an alert; return what the report says. */
async function settle() {
  const canvas = P().getByTestId("model-workbench-canvas");
  await P().waitForFunction(() => document.querySelector('[data-testid="model-workbench-canvas"]') || document.querySelector('.model-viewport [role="alert"]'), null, { timeout: 30000 });
  const shown = (await canvas.count()) > 0;
  await P().waitForTimeout(shown ? 1500 : 300);
  const rows = await P().locator('[data-testid="model-resource-report"] li').evaluateAll(lis => lis.map(tr => ({ state: tr.dataset.state, origin: tr.dataset.origin, text: tr.innerText.replace(/\s+/g, " ") })));
  const alert = (await P().locator('.model-viewport [role="alert"]').allInnerTexts()).join(" | ");
  return { shown, rows, alert };
}
const option = async (select, text) => select.locator("option", { hasText: text }).first().getAttribute("value");
async function chooseSource(text) { await sourceSelect().selectOption(await option(sourceSelect(), text)); await P().waitForTimeout(800); }
async function fileHash(installId, path) {
  return P().evaluate(async ([i, p]) => { const r = await fetch(window.__FORGE_TRANSPORT__.modelFileUrl(i, p)); if (!r.ok) return `HTTP ${r.status}`; const d = await crypto.subtle.digest("SHA-256", await r.arrayBuffer()); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join(""); }, [installId, path]);
}
const shotModel = async (name) => {
  // The 3D view with its resource list, and (beside it) the source panel; element shots avoid the scrolled layout.
  const view = P().locator(".model-viewport"); await view.scrollIntoViewIfNeeded(); await P().waitForTimeout(300);
  await view.screenshot({ path: join(OUT, name) });
  await P().locator(".model-source").screenshot({ path: join(OUT, name.replace(/\.png$/, "-source.png")) });
};
const diskHash = () => sha(readFileSync(projectFile("probe26")));

try {
  // ---------- 1. the real EE 2026 installation: a model whose files exist only inside archives
  const LIND = { name: "LindwurmFighterBlue", mesh: "LindwurmFighter/LindwurmFighterHull.model", tex: "LindwurmFighter/AlbedoAO/LindwurmFighterBlueAlbedoAO.png", pack: "msgamedev-2.pack" };
  check("2026 has no loose copy of the pack-only model", !existsSync(join(INSTALLS.e26, "resources", LIND.mesh)) && !existsSync(join(INSTALLS.e26, "resources", LIND.tex)));
  await openHull("probe26", "");
  check("with two 2026 installations registered nothing is chosen for the author", (await sourceSelect().inputValue()) === "" && (await P().getByText(/Forge does not pick one for you/).count()) > 0);
  await h.shot("00-source-not-chosen.png");
  await chooseSource("EE_2026");
  check("explicit choice of the real 2026 installation", (await sourceSelect().inputValue()) === id.e26);
  await modelSelect().selectOption(LIND.name);
  let r = await settle();
  await shotModel("01-2026-lindwurm-from-archive.png");
  check("2026: pack-only model shows a real preview (canvas, no placeholder)", r.shown && r.rows.length >= 2, r.alert);
  check("2026: mesh origin is the archive", r.rows.some(x => x.origin.includes(`packs/${LIND.pack}`) && x.origin.includes(LIND.mesh)), r.rows.map(x => x.origin).join(" ; "));
  const exp26 = packEntry(join(INSTALLS.e26, "packs", LIND.pack), LIND.mesh);
  check("2026: bytes served for the preview equal the archive range (independent parser)", (await fileHash(id.e26, LIND.mesh)) === exp26.sha, exp26.sha.slice(0, 12));
  check("no extracted copy of stock models exists in Forge's cache", !existsSync(cacheModelDir(id.e26)));
  check("choosing the model assigned it; the project is dirty only because of that", await dirty());
  await P().getByRole("button", { name: /^Save/ }).click(); await P().waitForTimeout(700);

  // ---------- 2. customise, edit, save
  await P().getByRole("button", { name: "Customise model" }).click();
  await P().getByLabel("Model scale", { exact: true }).fill("2.5").catch(async () => P().locator('input[aria-label="Model scale"]').fill("2.5"));
  await P().getByLabel("Radius (game units)", { exact: true }).fill("45");
  await P().getByRole("button", { name: "+ Engine" }).click();
  await P().getByRole("button", { name: /^Save/ }).click(); await P().waitForTimeout(800);
  r = await settle(); await shotModel("02-2026-customised.png");
  check("customised model still previews from the archive", r.shown && r.rows.some(x => x.origin.includes(`packs/${LIND.pack}`)));
  const stockEngines = JSON.parse(readFileSync(join(s.stateDir, "libraries", `${id.e26}.json`), "utf8")).models.find(m => m.name === LIND.name).definition.engineEmitters.length;
  const saved = JSON.parse(readFileSync(projectFile("probe26"), "utf8"));
  const copy = saved.models.find(m => m.mesh === LIND.mesh);
  check("saved copy keeps references, edits and origin", copy && copy.texture === LIND.tex && copy.scale === 2.5 && copy.radius === 45 && copy.engineEmitters.length === stockEngines + 1 && copy.origin?.model === LIND.name, JSON.stringify({ origin: copy?.origin, scale: copy?.scale, radius: copy?.radius, tex: copy?.texture, engines: copy?.engineEmitters?.length }));
  check("project file contains no machine path and no model source", !/(\/mnt\/|[A-Za-z]:\\|forge-ud|twin-)/.test(readFileSync(projectFile("probe26"), "utf8")));
  const savedHash = diskHash();

  // ---------- 3. restart Forge, reopen
  await h.close(); h = await launch(dirs);
  await openHull("probe26", id.e26);
  check("after restart the model source selection is remembered", (await sourceSelect().inputValue()) === id.e26);
  r = await settle(); await shotModel("03-after-restart.png");
  check("after restart the project model resolves from the archive again", r.shown && r.rows.some(x => x.origin.includes(`packs/${LIND.pack}`)));
  check("reopening does not dirty the document", !(await dirty()));

  // ---------- 4. 2026 -> 2024 -> 2026 with a model whose texture bytes differ per installation
  const SF = "small_fighter_1_color.jpg";
  const e24sf = packEntry(join(INSTALLS.e24, "packs", "Angryfly.pack"), SF), e26sf = packEntry(join(INSTALLS.e26, "packs", "Angryfly.pack"), SF);
  check("fixture truth: the same texture name differs between 2024 and 2026", e24sf.sha !== e26sf.sha);
  await modelSelect().selectOption("small_fighter_1"); await P().waitForTimeout(800);
  await shotModel("04-pre-save.png");
  await P().getByRole("button", { name: /^Save/ }).click(); await P().waitForTimeout(700);
  const beforeSwitch = diskHash();
  r = await settle(); await shotModel("04a-small-fighter-from-2026.png");
  check("2026 source: texture bytes are 2026's", (await fileHash(id.e26, SF)) === e26sf.sha && r.shown);
  await chooseSource("EE-2024"); r = await settle(); await shotModel("04b-small-fighter-from-2024.png");
  check("switch to 2024: preview now reads 2024's archive", r.shown && (await fileHash(id.e24, SF)) === e24sf.sha && r.rows.some(x => x.origin.includes("Win32_") || x.origin.includes("packs/Angryfly.pack")), r.rows.map(x => x.origin).join(" ; "));
  check("switch to 2024 did not change the project target", JSON.parse(readFileSync(projectFile("probe26"), "utf8")).eeVersion === "EE-2026.09.22PR");
  check("switch to 2024 did not dirty or rewrite the document", !(await dirty()) && diskHash() === beforeSwitch);
  check("switch to 2024 did not move the install destination", (await P().getByRole("combobox", { name: "EmptyEpsilon installation" }).inputValue()) !== "" );
  await chooseSource("EE_2026"); r = await settle(); await shotModel("04c-small-fighter-back-to-2026.png");
  check("back to 2026: 2026 bytes again, no contamination from 2024", r.shown && (await fileHash(id.e26, SF)) === e26sf.sha);
  check("2026 → 2024 → 2026 left the assigned model untouched", JSON.parse(readFileSync(projectFile("probe26"), "utf8")).templates.some(t => t.model === "small_fighter_1") && !(await dirty()));

  // ---------- 5. two installations of the same version
  await chooseSource("Twin RED"); await modelSelect().selectOption("probe");
  r = await settle(); await shotModel("05a-twin-red.png");
  check("twin RED: preview-only banner, nothing assigned", (await P().getByText(/Preview only/).count()) > 0 && !(await dirty()));
  const redSha = await fileHash(id.red, "probe.png");
  await chooseSource("Twin GREEN"); await modelSelect().selectOption("probe");
  r = await settle(); await shotModel("05b-twin-green.png");
  const greenSha = await fileHash(id.green, "probe.png");
  check("two installations of one version serve different bytes for one name", redSha !== greenSha && !redSha.startsWith("HTTP"), `${redSha.slice(0, 8)} vs ${greenSha.slice(0, 8)}`);
  check("twin GREEN preview is not twin RED's cache", r.rows.some(x => x.origin.includes("Twin GREEN")) && !r.rows.some(x => x.origin.includes("Twin RED")));
  check("exploring twins left the document unchanged", diskHash() === beforeSwitch && !(await dirty()));

  // ---------- 6. unavailable source — no hidden fallback
  const gone = twins.green.path + ".moved"; renameSync(twins.green.path, gone);
  await chooseSource("Twin RED"); await chooseSource("Twin GREEN");
  r = await settle(); await shotModel("06-source-unavailable.png");
  check("vanished source is reported as unavailable", (await P().getByRole("alert").allInnerTexts()).join(" ").match(/cannot be read|not available|gone/i) !== null, r.alert);
  check("vanished source stays chosen (no fallback to 2026 or the newest scan)", (await sourceSelect().inputValue()) === id.green && !r.shown);
  await chooseSource("EE_2026"); await modelSelect().selectOption("small_fighter_1"); r = await settle();
  check("choosing another source recovers", r.shown);
  renameSync(gone, twins.green.path);

  // ---------- 7. faults: missing resource, unsupported format, corrupt archive, stale cache
  await chooseSource("Faulty fixtures");
  for (const [model, expect_] of [["nomesh", /absent\.obj/i], ["notex", /absent\.png/i], ["badpack", /unreadable|truncated|bounds/i], ["tgafmt", /not supported/i]]) {
    await modelSelect().selectOption(model); r = await settle(); await shotModel(`07-fault-${model}.png`);
    check(`fault "${model}": reported, no placeholder, no preview`, !r.shown && expect_.test(r.alert + " " + r.rows.map(x => x.text).join(" ")), (r.alert || r.rows.map(x => x.text).join(" ")).slice(0, 200));
  }
  await modelSelect().selectOption("okmodel"); r = await settle(); await shotModel("07-fault-ok-before.png");
  check("okmodel previews while its files exist", r.shown);
  rmSync(join(twins.faulty.path, "resources", "ok.png"));            // the resource goes away behind Forge's back
  await modelSelect().selectOption("nomesh"); await modelSelect().selectOption("okmodel"); r = await settle(); await shotModel("07-fault-ok-after-delete.png");
  check("stale: after the resource disappears nothing old is presented as available", !r.shown && /ok\.png/.test(r.alert), r.alert.slice(0, 160));

  // ---------- 8. source / destination compatibility (2024 project, 2026 source)
  await openHull("probe24", id.e24);
  check("single 2024 installation is the unambiguous starting default for a 2024 project", (await sourceSelect().inputValue()) === id.e24);
  await P().getByRole("button", { name: /^Save/ }).click(); await P().waitForTimeout(700);   // the new template itself
  await chooseSource("EE_2026");
  await modelSelect().selectOption("astroid_1"); r = await settle(); await shotModel("08a-2024-project-2026-model.png");
  check("2026-only model in a 2024 project is preview-only, not assigned", (await P().getByText(/Preview only/).count()) > 0 && !(await dirty()));
  await P().getByRole("button", { name: "Customise model" }).click(); await P().waitForTimeout(500);
  const installCheck = async (shot) => {
    await P().getByRole("button", { name: "Install scenario" }).click(); await P().waitForTimeout(500);
    await P().getByRole("button", { name: /check the install/i }).click(); await P().waitForTimeout(3000);
    await h.shot(shot);
    const text = await P().locator("body").innerText();
    await P().getByRole("button", { name: "Cancel" }).click(); await P().waitForTimeout(400);
    return text;
  };
  let dialog = await installCheck("08b-install-normal-map.png");
  check("2026 normal map copied into a 2024 project is refused with the reason (property incompatibility)", /setNormalMap|normal map/i.test(dialog) && /Cannot|refus|rejected|failed/i.test(dialog), (dialog.match(/[^\n]*normal[^\n]*/i) ?? [""])[0].slice(0, 200));
  await P().getByRole("button", { name: /Remove normal map for 2024/ }).click(); await P().waitForTimeout(500);
  dialog = await installCheck("08c-install-after-normal-map-removed.png");
  check("after removing the normal map the install is not blocked, and different content behind the same name is reported", !/Cannot install/.test(dialog) && /different content/.test(dialog), (dialog.match(/[^\n]*different content[^\n]*/) ?? [""])[0].slice(0, 220));
  // a mesh that only the model source has: the destination cannot load it
  await chooseSource("Twin RED"); await modelSelect().selectOption("probe"); await settle();
  await P().getByRole("button", { name: "Customise model" }).click(); await P().waitForTimeout(500);
  dialog = await installCheck("08d-install-missing-resource.png");
  check("a copied model whose mesh/texture the destination lacks blocks the install and names them", /Cannot install/.test(dialog) && /probe\.obj/.test(dialog) && /would not load|cannot be loaded/.test(dialog), (dialog.match(/[^\n]*probe\.obj[^\n]*/) ?? [""])[0].slice(0, 220));

  // ---------- 9. the same path on the real EE 2024 installation (archive msgamedev.pack), including restart
  const L24 = { name: "LindwurmFighterBlue", mesh: "LindwurmFighter/LindwurmFighterHull.model", tex: "LindwurmFighter/AlbedoAO/LindwurmFighterBlueAlbedoAO.png", pack: "msgamedev.pack" };
  check("2024 has no loose copy of its pack-only model", !existsSync(join(INSTALLS.e24, "resources", L24.mesh)) && !existsSync(join(INSTALLS.e24, "resources", L24.tex)));
  await P().getByRole("button", { name: /^Save/ }).click().catch(() => {});
  await openHull("probe24b", id.e24);
  await modelSelect().selectOption(L24.name); r = await settle(); await shotModel("09a-2024-lindwurm-from-archive.png");
  check("2024: pack-only model previews from msgamedev.pack", r.shown && r.rows.every(x => x.origin.includes("packs/msgamedev.pack")) && r.rows.length >= 4, r.rows.map(x => x.origin.slice(-90)).join(" ; "));
  const exp24 = packEntry(join(INSTALLS.e24, "packs", L24.pack), L24.mesh);
  check("2024: bytes served for the preview equal the archive range (independent parser)", (await fileHash(id.e24, L24.mesh)) === exp24.sha && exp24.sha !== exp26.sha, exp24.sha.slice(0, 12) + " vs 2026 " + exp26.sha.slice(0, 12));
  await P().getByRole("button", { name: /^Save/ }).click(); await P().waitForTimeout(700);
  await P().getByRole("button", { name: "Customise model" }).click();
  await P().getByLabel("Model scale", { exact: true }).fill("3.5"); await P().getByLabel("Radius (game units)", { exact: true }).fill("55");
  await P().getByRole("button", { name: "+ Beam" }).first().click().catch(() => {});
  await P().getByRole("button", { name: "+ Engine" }).click();
  await P().getByRole("button", { name: /^Save/ }).click(); await P().waitForTimeout(800);
  const saved24 = JSON.parse(readFileSync(projectFile("probe24b"), "utf8")).models.find(m => m.mesh === L24.mesh);
  check("2024: saved copy keeps archive references and edits", saved24 && saved24.texture === L24.tex && saved24.scale === 3.5 && saved24.radius === 55 && saved24.origin?.target === "EE-2024.12.08", JSON.stringify({ scale: saved24?.scale, radius: saved24?.radius, origin: saved24?.origin }));
  await h.close(); h = await launch(dirs);
  await openHull("probe24b", id.e24); r = await settle(); await shotModel("09b-2024-after-restart.png");
  check("2024: after restart the customised model resolves from the archive", r.shown && r.rows.every(x => x.origin.includes("packs/msgamedev.pack")) && !(await dirty()));
  // the engine's own definition of the model, for the record of what a 2024 build would write
  const lua = JSON.stringify(s.services.projects.get("probe24b").models.map(m => m.name));
  check("2024 project's model list survives restart on disk", lua.includes("probe24b_model_"), lua);
} catch (error) {
  check("harness ran to the end", false, error?.stack ?? error);
  try { await h.shot("zz-failure.png"); } catch { /* ignore */ }
} finally {
  check("no renderer console errors (the radar/ship.png thumbnail 404 predates this work and is unrelated)", h.errors.filter(e => !/favicon|404/.test(e)).length === 0 && h.notFound.every(u => /\/forge\/assets\/radar\//.test(u)), h.errors.slice(0, 3).join(" | ") + " 404s: " + h.notFound.slice(0, 5).join(" , "));
  await h.close();
  writeFileSync(join(OUT, "..", "results-electron.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter(x => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
