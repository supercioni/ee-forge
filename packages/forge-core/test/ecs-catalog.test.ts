import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScriptReference } from "../src/catalog/parse.js";
import { generateCatalog } from "../src/catalog/generate.js";
import { supplementEcsSources } from "../src/catalog/ecs-source.js";

const html = `<div id="types" class="section"><li><a name="enum_Mode">Mode</a>: one, two, one</li></div>
<div id="creation" class="section"><li>CpuShip</a>()<dd>A ship.</dd><pre><code></code></pre></li></div>
<div id="entity" class="section"><ul><li><a href="#category_">Index</a></li></ul>
<li><a name="method_ModelData:setName">ModelData:setName</a>(name)<dd>Name.</dd><pre><code></code></pre></li>
<li><a name="method_Entity:setPosition">Entity:setPosition</a>(x, y)<dd>Position.</dd><pre><code>ship:setPosition(1,2)</code></pre></li></div>
<div id="global" class="section"><li>globalMessage(message, timeout)<dd>void globalMessage(string message, std::optional&lt;float&gt; timeout) Message.</dd><pre><code></code></pre></li></div>`;
const parse = () => parseScriptReference(html, { eeVersion: "EE-2026.09.22PR", source: "fixture" });

describe("2026 catalog", () => {
  it("does not swallow the first method after the category table of contents", () => {
    const c = parse();
    expect(c.classes["ModelData"]?.methods[0]?.name).toBe("setName");
    expect(c.classes["CpuShip"]?.subclassOf).toBe("Entity");
    expect(c.classes["Entity"]?.methods[0]?.params.map((p) => p.name)).toEqual(["x", "y"]);
    expect(c.enums["Mode"]?.values).toEqual(["one", "two"]);
  });
  it("retains typed native globals and C++ optional parameters", () => {
    const method = parse().globals.find((m) => m.name === "globalMessage");
    expect(method?.params[0]).toMatchObject({ type: "string", optional: false });
    expect(method?.params[1]).toMatchObject({ type: "number", optional: true });
  });
  it("fills documented omissions only when source declares them", () => {
    const dir = mkdtempSync(join(tmpdir(), "ecs-catalog-"));
    try {
      mkdirSync(join(dir, "entity"));
      writeFileSync(join(dir, "entity", "spaceship.lua"), `function Entity:orderRoamingAt(x, y)\n return self\nend\n`);
      writeFileSync(join(dir, "factory.lua"), `function FactionInfo()\n local e = createEntity()\n return e\nend\nfunction Entity:setPosition(x, y)\n if y == nil then y = x end\n return self\nend\n`);
      const c = parse();
      supplementEcsSources(c, dir);
      expect(c.classes["FactionInfo"]?.subclassOf).toBe("Entity");
      expect(c.classes["Entity"]?.methods.find((m) => m.name === "setPosition")?.params[1]?.optional).toBe(true);
      expect(c.classes["Entity"]?.methods.find((m) => m.name === "orderRoamingAt")?.params).toHaveLength(2);
      expect(c.classes["InventedFactory"]).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("refuses an empty reference without overwriting a working catalog", () => {
    const dir = mkdtempSync(join(tmpdir(), "ecs-catalog-"));
    try {
      writeFileSync(join(dir, "script_reference.html"), "<html>unsupported</html>");
      writeFileSync(join(dir, "catalog.generated.json"), "existing catalog");
      expect(() => generateCatalog({ eeInstall: dir, outDir: dir, eeVersion: "TEST" })).toThrow(/empty EE reference/);
      expect(readFileSync(join(dir, "catalog.generated.json"), "utf8")).toBe("existing catalog");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
