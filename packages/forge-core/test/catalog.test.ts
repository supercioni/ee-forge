import { describe, expect, it } from "vitest";
import { SPAWNABLE_CLASSES, ShipSystemNameSchema, lookupMethod } from "@forge/contracts";
import { loadCatalog } from "../src/catalog/load.js";
import { parseScriptReference } from "../src/catalog/parse.js";

/**
 * The catalog is what makes "never invent EE API" mechanical, so these
 * tests guard both the parser and the committed artifact.
 */

const FIXTURE = `<html><body>
<div class="section"><p>Some of the types in the parameters:</p><ul>
<li><a name="enum_ESystem">ESystem</a>: "reactor", "warp" (<code>x.hpp</code>)</li>
<li><a name="enum_EDockingState">EDockingState</a>: 0 (not docking), 1 (docking)</li>
</ul></div>
<div class="section">
<a name="class_Widget"></a><h2>Widget</h2>
<div> A widget.<br> Example: w = Widget()</div>Subclass of: <a href="#class_Base">Base</a><dl>
<dt><a href="#class_Widget">Widget</a> Widget:setSize(number size)</dt><dd>Sets size.<br> Example: w:setSize(3)<br>Returns the object it was called on.</dd>
<dt>number x, number y Widget:getPosition()</dt><dd> Returns the position.</dd>
<dt><a href="#class_Widget">Widget</a> Widget:setPoints(number points_x, number points_y...)</dt><dd>Variadic.</dd>
<dt><a href="#class_Widget">Widget</a> Widget:setTimeout(number seconds=nil)</dt><dd>Optional.</dd>
<dt>Widget:typeName</dt><dd>Direct member.</dd>
</dl></div>
<div class="section">
<a name="class_Base"></a><h2>Base</h2>
<div> The base.</div><dl>
<dt><a href="#class_Base">Base</a> Base:setName(string name)</dt><dd>Sets the name.</dd>
</dl></div>
<div class="section"><h2>Functions</h2>
<ul><li>number random(number min_value, number max_value)<dd>Random.<br> Example: random(0,1)</dd>
<li>victory(string faction_name)<dd>Ends the scenario.</dd>
</ul></div>
</body></html>`;

describe("parseScriptReference", () => {
  const catalog = parseScriptReference(FIXTURE, {
    eeVersion: "TEST",
    source: "fixture.html",
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("extracts classes with their descriptions and parent", () => {
    expect(catalog.classes["Widget"]?.subclassOf).toBe("Base");
    expect(catalog.classes["Widget"]?.description).toContain("A widget");
    expect(catalog.classes["Base"]?.subclassOf).toBeNull();
  });

  it("parses parameters, defaults and variadics", () => {
    const setSize = catalog.classes["Widget"]?.methods.find((m) => m.name === "setSize");
    expect(setSize?.params).toEqual([
      { type: "number", name: "size", optional: false, variadic: false, defaultValue: null },
    ]);

    const setPoints = catalog.classes["Widget"]?.methods.find((m) => m.name === "setPoints");
    expect(setPoints?.params[1]).toMatchObject({ name: "points_y", variadic: true });

    const setTimeout = catalog.classes["Widget"]?.methods.find((m) => m.name === "setTimeout");
    expect(setTimeout?.params[0]).toMatchObject({ optional: true, defaultValue: "nil" });
  });

  it("keeps multi-return declarations as a list", () => {
    const getPosition = catalog.classes["Widget"]?.methods.find(
      (m) => m.name === "getPosition",
    );
    expect(getPosition?.returns).toEqual(["number x", "number y"]);
  });

  it("marks direct members so they are never emitted as calls", () => {
    const typeName = catalog.classes["Widget"]?.methods.find((m) => m.name === "typeName");
    expect(typeName?.kind).toBe("member");
  });

  it("does not re-list inherited methods under the subclass", () => {
    const names = catalog.classes["Widget"]?.methods.map((m) => m.name) ?? [];
    expect(names).not.toContain("setName");
  });

  it("lifts globals and quoted enum values", () => {
    expect(catalog.globals.map((g) => g.name)).toEqual(["random", "victory"]);
    expect(catalog.enums["ESystem"]?.values).toEqual(["reactor", "warp"]);
    // EDockingState is documented numerically — no quoted values to lift.
    expect(catalog.enums["EDockingState"]?.values).toEqual([]);
  });
});

describe("committed catalog", () => {
  const catalog = loadCatalog();

  it("is pinned to the EE build the project targets", () => {
    expect(catalog.eeVersion).toBe("EE-2026.09.22PR");
  });

  it("covers every class the editor can place on a map", () => {
    for (const className of SPAWNABLE_CLASSES) {
      expect(catalog.classes[className], `${className} missing from catalog`).toBeDefined();
    }
  });

  it("resolves inherited methods through the subclass chain", () => {
    expect(lookupMethod(catalog, "Asteroid", "setPosition")?.definedOn).toBe("Entity");
    expect(lookupMethod(catalog, "CpuShip", "setSystemHealth")?.definedOn).toBe("Entity");
    expect(lookupMethod(catalog, "CpuShip", "setTemplate")?.definedOn).toBe(
      "Entity",
    );
  });

  it("returns null for methods EE does not have", () => {
    expect(lookupMethod(catalog, "Asteroid", "setImaginaryDrive")).toBeNull();
    // ECS uses a shared method table; applicability depends on components.
    expect(lookupMethod(catalog, "SpaceStation", "isFullyScannedBy")?.definedOn).toBe("Entity");
  });

  it("agrees with the shared ESystem enum", () => {
    expect(catalog.enums["ESystem"]?.values).toEqual([...ShipSystemNameSchema.options]);
  });

  it("documents setScenario, which ee-api-reference.md §9.1 claims is absent", () => {
    // Kept as a test so the discrepancy cannot quietly disappear: probe
    // item 1 of ADR-0034 is about whether it also *works* at runtime.
    expect(catalog.globals.map((g) => g.name)).toContain("setScenario");
  });
});
