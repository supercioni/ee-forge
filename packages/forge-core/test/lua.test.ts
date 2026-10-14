import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load.js";
import {
  CodegenError,
  ctor,
  luaString,
  luaTable,
  num,
  raw,
  renderChain,
  renderGlobalCall,
  renderValue,
  str,
  bool,
} from "../src/codegen/lua.js";

const catalog = loadCatalog();

describe("value rendering", () => {
  it("escapes strings so prose with quotes and newlines survives", () => {
    expect(luaString('he said "go"')).toBe('"he said \\"go\\""');
    expect(luaString("line1\nline2")).toBe('"line1\\nline2"');
    expect(luaString("back\\slash")).toBe('"back\\\\slash"');
  });

  it("keeps coordinates free of exponent notation", () => {
    // EE game units run to ~1e6 for the largest sector coordinates, so
    // plain decimal output keeps generated files diffable against
    // hand-written scenarios.
    expect(renderValue(num(15000))).toBe("15000");
    expect(renderValue(num(-1200000))).toBe("-1200000");
    expect(renderValue(num(0.5))).toBe("0.5");
  });

  it("refuses non-finite numbers rather than emitting nan", () => {
    expect(() => renderValue(num(Number.NaN))).toThrow(CodegenError);
  });

  it("orders table keys deterministically", () => {
    expect(luaTable({ b: num(2), a: str("x") })).toBe('{ a = "x", b = 2 }');
  });
});

describe("catalog-checked calls", () => {
  it("emits a chain for methods that exist", () => {
    const lua = renderChain(catalog, "Asteroid", ctor("Asteroid"), [
      { method: "setPosition", args: [num(100), num(200)] },
      { method: "setSize", args: [num(80)] },
    ]);
    expect(lua).toBe("Asteroid():setPosition(100, 200):setSize(80)");
  });

  it("refuses a method EE does not have", () => {
    expect(() =>
      renderChain(catalog, "Asteroid", ctor("Asteroid"), [
        { method: "setImaginaryDrive", args: [bool(true)] },
      ]),
    ).toThrow(/does not exist in EE-2026.09.22PR/);
  });

  it("names the hard rule it is enforcing", () => {
    expect(() =>
      renderChain(catalog, "Nebula", ctor("Nebula"), [{ method: "setRadius2", args: [] }]),
    ).toThrow(/CLAUDE.md §0.3/);
  });

  it("resolves ECS methods through Entity even for station handles", () => {
    expect(renderChain(catalog, "SpaceStation", raw("station"), [
      { method: "setSystemHealth", args: [str("reactor"), num(0.5)] },
    ])).toBe('station:setSystemHealth("reactor", 0.5)');
  });

  it("checks arity", () => {
    expect(() =>
      renderChain(catalog, "Asteroid", ctor("Asteroid"), [
        { method: "setPosition", args: [num(1)] },
      ]),
    ).toThrow(/expects 2..2 argument\(s\), got 1/);
  });

  it("allows any count past a variadic parameter", () => {
    const lua = renderChain(catalog, "Zone", ctor("Zone"), [
      { method: "setPoints", args: [num(0), num(0), num(10), num(0), num(10), num(10)] },
    ]);
    expect(lua).toContain("setPoints(0, 0, 10, 0, 10, 10)");
  });

  it("checks primitive parameter types", () => {
    expect(() =>
      renderChain(catalog, "Asteroid", ctor("Asteroid"), [
        { method: "setSize", args: [str("big")] },
      ]),
    ).toThrow(/must be a number/);
  });

  it("checks strict enum values", () => {
    expect(() =>
      renderChain(catalog, "CpuShip", raw("ship"), [
        { method: "setSystemHealth", args: [str("shields"), num(0.5)] },
      ]),
    ).toThrow(/must be one of reactor, beamweapons/);
  });

  it("wraps long chains one call per line", () => {
    const lua = renderChain(catalog, "Planet", ctor("Planet"), [
      { method: "setPosition", args: [num(1000), num(2000)] },
      { method: "setPlanetRadius", args: [num(2500)] },
      { method: "setPlanetSurfaceTexture", args: [str("planets/planet-earth.png")] },
      { method: "setPlanetCloudTexture", args: [str("planets/clouds-1.png")] },
    ]);
    expect(lua.split("\n").length).toBeGreaterThan(1);
  });
});

describe("global calls", () => {
  it("emits documented globals", () => {
    expect(renderGlobalCall(catalog, "victory", [str("Human Navy")])).toBe(
      'victory("Human Navy")',
    );
  });

  it("honours optional parameters", () => {
    expect(renderGlobalCall(catalog, "globalMessage", [str("hi")])).toBe('globalMessage("hi")');
    expect(renderGlobalCall(catalog, "globalMessage", [str("hi"), num(5)])).toBe(
      'globalMessage("hi", 5)',
    );
  });

  it("refuses undocumented globals", () => {
    expect(() => renderGlobalCall(catalog, "spawnWave", [])).toThrow(/does not exist/);
  });
});
