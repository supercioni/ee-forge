#!/usr/bin/env node
// Browser-mode collaudo (HTTP transport, no Electron): the same model-source behaviour through Forge's own HTTP server.
//   node docs/verification/model-source/run-browser.mjs      (after `pnpm build`)
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../../node_modules/.pnpm/playwright-core@1.64.0/node_modules/playwright-core/index.mjs";
import { createForgeHttpServer, createForgeRouter, createForgeServices } from "../../../packages/forge-app/dist/index.js";
import { INSTALLS, createProject, makeTwin } from "./seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? join(here, "screens-browser");
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const sha = (b) => createHash("sha256").update(b).digest("hex");

const root = mkdtempSync(join(tmpdir(), "forge-browser-"));
const fixtures = join(root, "fx"); mkdirSync(fixtures);
const services = createForgeServices({ projectsDir: join(root, "projects"), stateDir: join(root, "state") });
const reg = {};
const twin = makeTwin(fixtures, "twin-red", [220, 40, 40]);
reg.red = services.installations.register({ path: twin, label: "Twin RED (EE 2026 stand-in)" });
for (const [k, path] of Object.entries(INSTALLS)) reg[k] = services.installations.register({ path });
for (const i of Object.values(reg)) services.libraries.rescan(i.id);
createProject(services, "browser26", "EE-2026.09.22PR");
const server = createForgeHttpServer(createForgeRouter(services), { staticDir: resolve(here, "../../../packages/web-forge/dist"), corsOrigin: null });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/home/ricca/.agent-browser/browsers/chrome-148.0.7778.178/chrome", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage(); page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const sourceSelect = () => page.getByRole("combobox", { name: "Model source" });
const modelSelect = () => page.getByRole("combobox", { name: "3D model" });
const option = (sel, text) => sel.locator("option", { hasText: text }).first().getAttribute("value");
const dirty = async () => (await page.locator("body").innerText()).includes("Unsaved changes");
async function settle() {
  await page.waitForFunction(() => document.querySelector('[data-testid="model-workbench-canvas"]') || document.querySelector('.model-viewport [role="alert"]'), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { shown: (await page.getByTestId("model-workbench-canvas").count()) > 0, alert: (await page.locator('.model-viewport [role="alert"]').allInnerTexts()).join(" | "), origins: await page.locator('[data-testid="model-resource-report"] li').evaluateAll(l => l.map(x => x.dataset.origin)) };
}
const shot = async (n) => { await page.locator(".model-viewport").scrollIntoViewIfNeeded(); await page.locator(".model-viewport").screenshot({ path: join(OUT, n) }); };
const fileHash = (id, p) => page.evaluate(async ([i, q]) => { const r = await fetch(`/forge/model-source/${i}/file/${q.split("/").map(encodeURIComponent).join("/")}`); if (!r.ok) return `HTTP ${r.status}`; return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await r.arrayBuffer()))].map(x => x.toString(16).padStart(2, "0")).join(""); }, [id, p]);
const projectFile = join(root, "projects", "browser26", "project.json");

try {
  await page.goto(base); await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Fleet", exact: true }).click();
  await page.getByRole("button", { name: "+ Template" }).click();
  await page.getByRole("button", { name: "Hull", exact: true }).first().click();
  await sourceSelect().waitFor();
  check("browser: with two 2026 installations nothing is chosen for the author", (await sourceSelect().inputValue()) === "");
  await sourceSelect().selectOption(await option(sourceSelect(), "EE_2026"));
  await page.waitForTimeout(800);
  const LIND = "LindwurmFighter/LindwurmFighterHull.model";
  await modelSelect().selectOption("LindwurmFighterBlue");
  let r = await settle(); await shot("b1-2026-lindwurm.png");
  check("browser: pack-only 2026 model previews, origin is msgamedev-2.pack", r.shown && r.origins.every(o => o.includes("packs/msgamedev-2.pack") || o.includes("packs/")) && r.origins.some(o => o.includes("msgamedev-2.pack")), r.origins[0] ?? r.alert);
  await page.getByRole("button", { name: /^Save/ }).click(); await page.waitForTimeout(700);
  const before = sha(readFileSync(projectFile));
  await sourceSelect().selectOption(await option(sourceSelect(), "EE-2024")); r = await settle(); await shot("b2-switch-to-2024.png");
  check("browser: switch to 2024 reads 2024's archive (msgamedev.pack)", r.shown && r.origins.some(o => o.includes("msgamedev.pack")) && !r.origins.some(o => o.includes("msgamedev-2.pack")), r.origins[0]);
  check("browser: switching source leaves the document unchanged and not dirty", !(await dirty()) && sha(readFileSync(projectFile)) === before);
  await sourceSelect().selectOption(await option(sourceSelect(), "EE_2026")); r = await settle();
  check("browser: back to 2026 reads 2026 again", r.shown && r.origins.some(o => o.includes("msgamedev-2.pack")));
  await sourceSelect().selectOption(await option(sourceSelect(), "Twin RED")); await modelSelect().selectOption("probe"); r = await settle(); await shot("b3-twin-red.png");
  check("browser: same-version twin shows its own bytes", r.shown && (await fileHash(reg.red.id, "probe.png")) !== (await fileHash(reg.e26.id, "LindwurmFighter/LindwurmFighterIllumination.png")));
  // persistence of the choice across a page reload, then vanished source
  await page.reload(); await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Fleet", exact: true }).click();
  await page.getByRole("button", { name: /^New Hull/ }).first().click().catch(() => {});
  await page.getByRole("button", { name: "Hull", exact: true }).first().click();
  await sourceSelect().waitFor(); await page.waitForTimeout(1200);
  check("browser: the chosen source is remembered after reload", (await sourceSelect().inputValue()) === reg.red.id);
  renameSync(twin, twin + ".gone");
  await sourceSelect().selectOption(await option(sourceSelect(), "EE_2026")); await page.waitForTimeout(600);
  await sourceSelect().selectOption(await option(sourceSelect(), "Twin RED")); await page.waitForTimeout(1200);
  const banner = (await page.getByRole("alert").allInnerTexts()).join(" ");
  check("browser: vanished source is reported and stays chosen (no fallback)", /cannot be read|gone/.test(banner) && (await sourceSelect().inputValue()) === reg.red.id, banner.slice(0, 160));
  await page.screenshot({ path: join(OUT, "b4-unavailable.png") });
  check("browser: no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("browser harness ran to the end", false, error?.stack ?? error);
  await page.screenshot({ path: join(OUT, "b-failure.png") }).catch(() => {});
} finally {
  await browser.close(); server.close();
  writeFileSync(join(here, "results-browser.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter(x => !x.ok); console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
