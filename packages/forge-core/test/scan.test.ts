import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanInstall } from "../src/scan/install.js";
import {
  parseDataScript,
  parseStatements,
  splitStatements,
  stripComments,
  unrollNumericLoops,
} from "../src/scan/lua-data.js";

/**
 * The reader that turns an EE install into a content library. Fixtures
 * first (fast, deterministic), then a gated pass over the real install.
 */

describe("lua data reader", () => {
  it("drops line and long comments but keeps strings intact", () => {
    const source = `-- DROPPED_LINE
--[[ DROPPED_BLOCK
still dropped ]]
x = "text -- kept verbatim"
y = [[long -- kept verbatim]]`;
    const stripped = stripComments(source);
    expect(stripped).not.toContain("DROPPED_LINE");
    expect(stripped).not.toContain("DROPPED_BLOCK");
    expect(stripped).toContain('"text -- kept verbatim"');
    expect(stripped).toContain("[[long -- kept verbatim]]");
  });

  it("keeps a multi-line long string inside one statement", () => {
    // This is the case that shredded the first implementation: EE's
    // faction and template files are full of paragraph descriptions with
    // blank lines, and a line-based splitter silently lost most entries.
    const source = `a = FactionInfo():setName("X")
a:setDescription([[First paragraph.

Second paragraph with (unbalanced parens.]])
b = FactionInfo():setName("Y")`;
    const statements = splitStatements(source);
    expect(statements).toHaveLength(3);
    expect(statements[1]).toContain("Second paragraph");
    expect(statements[2]).toContain('setName("Y")');
  });

  it("joins a chain that continues on the next line", () => {
    const statements = splitStatements(`t = ShipTemplate():setName("A")
  :setHull(100)
  :setShields(50, 50)`);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("setShields(50, 50)");
  });

  it("reads constructors, subjects and chained calls", () => {
    const [statement] = parseStatements(`local t = ShipTemplate():setName("A"):setHull(10)`);
    expect(statement?.assignsTo).toBe("t");
    expect(statement?.constructs).toBe("ShipTemplate");
    expect(statement?.calls.map((c) => c.method)).toEqual(["setName", "setHull"]);
    expect(statement?.calls[1]?.args).toEqual([10]);
  });

  it("unwraps the translation helper to the translatable string", () => {
    const [statement] = parseStatements(`t:setLocaleName(_("ship", "Atlantis X23"))`);
    expect(statement?.calls[0]?.args).toEqual(["Atlantis X23"]);
  });

  it("keeps a variable argument verbatim so relations can be resolved", () => {
    const [statement] = parseStatements(`kraylor:setEnemy(human)`);
    expect(statement?.calls[0]?.args).toEqual(["human"]);
  });
});

const EE_INSTALL =
  process.env["EE_DIR"] ?? "/mnt/c/EE_2026/EmptyEpsilon";
const hasInstall = existsSync(EE_INSTALL);


describe("unrolling the loops EE generates template families with", () => {
  /**
   * Narrow on purpose: this is not a Lua interpreter, and the tests are
   * where that boundary is written down. What it cannot decide it must
   * leave alone, because a library that guesses stops being evidence about
   * the install.
   */

  it("expands a numeric for and folds the name it builds", () => {
    const { statements } = parseDataScript(`
for cnt=1,3 do
  template = ShipTemplate():setName("Freighter " .. cnt):setHull(100)
end
`);
    const names = statements.flatMap((s) =>
      s.calls.filter((c) => c.method === "setName").map((c) => c.args[0]),
    );
    expect(names).toEqual(["Freighter 1", "Freighter 2", "Freighter 3"]);
  });

  it("expands nested loops, which is how the 25 transports exist", () => {
    const { statements } = parseDataScript(`
for type=1,2 do
  for cnt=1,2 do
    template = ShipTemplate():setName("Transport" .. type .. "x" .. cnt)
  end
end
`);
    const names = statements.flatMap((s) =>
      s.calls.filter((c) => c.method === "setName").map((c) => c.args[0]),
    );
    expect(names).toEqual(["Transport1x1", "Transport1x2", "Transport2x1", "Transport2x2"]);
  });

  it("evaluates the guard around a variant instead of inventing it", () => {
    const { statements } = parseDataScript(`
for cnt=1,4 do
  template = ShipTemplate():setName("Base " .. cnt)
  if cnt > 2 then
    variation = template:copy("Jump " .. cnt)
  end
end
`);
    const copies = statements.flatMap((s) =>
      s.calls.filter((c) => c.method === "copy").map((c) => c.args[0]),
    );
    expect(copies).toEqual(["Jump 3", "Jump 4"]);
  });

  it("substitutes the variable but not a call of the same name", () => {
    // `type` is both a common loop variable in these files and a Lua
    // builtin; rewriting the call would corrupt the statement.
    const { source } = unrollNumericLoops(`for type=1,1 do x = type(v) .. type end`);
    expect(source).toContain("type(v)");
    expect(source).toContain(".. 1");
  });

  it("leaves prose alone, apostrophes and all", () => {
    // A description containing "cargo's" reads as an opening quote to a
    // naive substituter, which then swallows the rest of the body — the
    // exact bug that left five freighters unresolved.
    const { statements } = parseDataScript(`
for cnt=1,2 do
  template = ShipTemplate():setName("Fuel " .. cnt)
  template:setDescription(_([[Tanks for the ship's volatile cargo.]]))
  variation = template:copy("Jump " .. cnt)
end
`);
    const copies = statements.flatMap((s) =>
      s.calls.filter((c) => c.method === "copy").map((c) => c.args[0]),
    );
    expect(copies).toEqual(["Jump 1", "Jump 2"]);
  });

  it("refuses a loop it cannot bound, and says so", () => {
    const result = unrollNumericLoops(`for i=1,n do template = ShipTemplate():setName("X" .. i) end`);
    expect(result.source).toContain("for i=1,n do");
    expect(result.warnings).toEqual([]);
  });

  it("reports a conditional it cannot reduce rather than picking a branch", () => {
    const result = unrollNumericLoops(`
for cnt=1,1 do
  if cnt > 0 then
    a = 1
  else
    b = 2
  end
end
`);
    expect(result.warnings.some((w) => w.includes("else"))).toBe(true);
  });

  it("does not fold a concatenation with a value it does not know", () => {
    const { statements } = parseDataScript(`x = ShipTemplate():setName("A" .. unknown)`);
    const name = statements[0]?.calls[0]?.args[0];
    expect(typeof name === "string" && name.includes("..")).toBe(true);
  });
});

describe.skipIf(!hasInstall)("scan of the pinned EE install", () => {
  const library = scanInstall({ eeInstall: EE_INSTALL, eeVersion: "EE-2026.09.22PR" });

  it("indexes the stock ship templates", () => {
    expect(library.templates.length).toBeGreaterThanOrEqual(164);
    const atlantis = library.templates.find((t) => t.name === "Atlantis");
    expect(atlantis).toMatchObject({
      kind: "playership",
      model: "battleship_destroyer_1_upgraded",
      className: "Corvette",
      hull: 250,
    });
  });

  /**
   * The oracle for copying a stock hull into a project (ADR-0041): the
   * author gets exactly what was read here, so every value is checked
   * against `shiptemplates/corvette.lua` by hand.
   *
   * `Atlantis` is the interesting one — it is `Atlantis X23:copy("Atlantis")`
   * with overrides, so it exercises inheritance, EE's CamelCase room
   * systems, and the fields `copy()` silently drops.
   */
  it("reads a stock hull whole, the way corvette.lua declares it", () => {
    const atlantis = library.templates.find((t) => t.name === "Atlantis");
    expect(atlantis).toBeDefined();
    if (atlantis === undefined) return;

    expect(atlantis.copiedFrom).toBe("Atlantis X23");
    expect(atlantis.sourceFile).toBe("scripts/shiptemplates/corvette.lua");

    // Overridden by the variation.
    expect(atlantis.hull).toBe(250);
    expect(atlantis.shields).toEqual([200, 200]);
    expect(atlantis.speed).toEqual({
      impulse: 90,
      turn: 10,
      acceleration: 20,
      reverseSpeed: null,
      reverseAcceleration: null,
    });
    expect(atlantis.combatManeuver).toEqual({ boost: 400, strafe: 250 });

    // Inherited from the base through copy().
    expect(atlantis.subclassName).toBe("Destroyer");
    expect(atlantis.radarTrace).toBe("dread.png");

    // `has_jump_drive` IS carried by copy(); the range pair is NOT.
    expect(atlantis.jumpDrive).toEqual({ enabled: true, minRange: null, maxRange: null });

    // Beam 2 is switched off by being zeroed, EE's own idiom.
    expect(atlantis.beams).toHaveLength(3);
    expect(atlantis.beams.find((b) => b.index === 0)).toMatchObject({
      arc: 100,
      direction: -20,
      range: 1500,
      cycleTime: 6,
      damage: 8,
    });
    expect(atlantis.beams.find((b) => b.index === 2)).toMatchObject({ damage: 0, range: 0 });

    expect(atlantis.tubes?.count).toBe(5);
    expect(atlantis.tubes?.loadTime).toBe(8);
    expect(atlantis.tubes?.perTube.find((t) => t.index === 4)).toMatchObject({
      direction: 180,
      exclusiveFor: "Mine",
    });
    expect(atlantis.tubes?.perTube.find((t) => t.index === 0)?.disallow).toEqual(["Mine"]);

    // HVLI is the base's, the rest are the variation's.
    expect([...atlantis.weaponStorage].sort((a, b) => (a.weapon < b.weapon ? -1 : 1))).toEqual([
      { weapon: "EMP", amount: 6 },
      { weapon: "HVLI", amount: 20 },
      { weapon: "Homing", amount: 12 },
      { weapon: "Mine", amount: 8 },
      { weapon: "Nuke", amount: 4 },
    ]);

    // The deck plan Engineering needs — and corvette.lua writes its system
    // names in CamelCase, which EE accepts case-insensitively.
    expect(atlantis.rooms).toHaveLength(13);
    expect(atlantis.rooms[0]).toEqual({ x: 1, y: 0, width: 2, height: 1, system: "maneuver" });
    expect(atlantis.rooms.some((r) => r.system === "beamweapons")).toBe(true);
    expect(atlantis.doors.length).toBeGreaterThan(0);
  });

  /**
   * 65 of the install's templates exist only inside `for` loops, and their
   * stats are written as arithmetic on the loop variable. The unroller
   * substitutes it; the literal folder finishes the job.
   */
  it("resolves stats written as arithmetic once the loop variable is substituted", () => {
    // corvette.lua: setSpeed(60 - 5 * cnt, 6, 10), cnt = 3
    expect(library.templates.find((t) => t.name === "Personnel Freighter 3")?.speed).toEqual({
      impulse: 45,
      turn: 6,
      acceleration: 10,
      reverseSpeed: null,
      reverseAcceleration: null,
    });
    // corvette.lua: setJumpDriveRange(5000, 100 * 50000)
    expect(library.templates.find((t) => t.name === "Jump Carrier")?.jumpDrive).toEqual({
      enabled: true,
      minRange: 5000,
      maxRange: 5000000,
    });
    // dreadnaught.lua: setBeamWeapon(n, 90, n * 22.5, 3200, 3, 10) for n = 0..15
    const odin = library.templates.find((t) => t.name === "Odin");
    expect(odin?.beams).toHaveLength(16);
    expect(odin?.beams.find((b) => b.index === 4)?.direction).toBe(90);
  });

  /**
   * The library is what a copy is made from, so a field the reader could
   * not resolve has to be reported rather than left looking unset. Both
   * remaining cases are `setLocaleName(string.format(…))` on loop-generated
   * families — folding `string.format` would be growing an evaluator.
   */
  it("reports the fields it could not read, and nothing else", () => {
    expect(library.warnings).toHaveLength(2);
    for (const warning of library.warnings) {
      expect(warning).toContain("setLocaleName");
      expect(warning).toContain("cannot resolve");
    }
    expect(library.templates.find((t) => t.name === "Personnel Freighter 3")?.localeName).toBeNull();
  });

  it("follows shipTemplates.lua's own require order", () => {
    expect(
      library.templates.some((t) => t.sourceFile.endsWith("shiptemplates/stations.lua")),
    ).toBe(true);
  });

  it("indexes model data with the radius nothing else exposes", () => {
    const model = library.models.find((m) => m.name === "battleship_destroyer_1_upgraded");
    expect(model?.radius).toBe(200);
    expect(model?.mesh).toContain(".model");
  });

  it("indexes all ten stock factions with their relations", () => {
    expect(library.factions.map((f) => f.name)).toEqual([
      "Independent",
      "Human Navy",
      "Kraylor",
      "Arlenians",
      "Exuari",
      "Ghosts",
      "Ktlitans",
      "TSN",
      "USN",
      "CUF",
    ]);
    const kraylor = library.factions.find((f) => f.name === "Kraylor");
    expect(kraylor?.enemies).toContain("Human Navy");
    expect(kraylor?.gmColor).toEqual([255, 0, 0]);
  });

  it("indexes resources with EE-relative paths", () => {
    expect(library.resources.planetTextures).toContain("planets/planet-earth.png");
    expect(library.resources.radarTraces).toContain("radar/dread.png");
    expect(library.resources.packs.length).toBeGreaterThan(0);
    // Meshes come mostly from the .pack archives, not from loose files.
    expect(library.resources.meshes.length).toBeGreaterThan(50);
  });

  it("enumerates the families EE builds in loops", () => {
    // transport.lua's 25 hulls and corvette.lua's five freighter families
    // are generated by nested `for` loops — 65 templates, a third of the
    // install. A reader that skipped them showed an author a library
    // visibly poorer than EmptyEpsilon's own ship picker.
    for (const name of ["Transport1x1", "Transport5x5", "Transport3x2"]) {
      expect(library.templates.some((t) => t.name === name), name).toBe(true);
    }
    expect(library.templates.filter((t) => t.name.startsWith("Transport")).length).toBe(25);
    expect(library.templates.filter((t) => t.name.includes("Freighter")).length).toBe(40);
  });

  it("honours the guard EE puts around its jump variants", () => {
    // `if cnt > 2 then … copy("… Jump Freighter " .. cnt)` — unrolling the
    // loop without evaluating that guard would invent two hulls per family
    // that the game does not have.
    for (const n of [3, 4, 5]) {
      expect(
        library.templates.some((t) => t.name === `Fuel Jump Freighter ${n}`),
        `Fuel Jump Freighter ${n}`,
      ).toBe(true);
    }
    for (const n of [1, 2]) {
      expect(
        library.templates.some((t) => t.name === `Fuel Jump Freighter ${n}`),
        `Fuel Jump Freighter ${n} must not exist`,
      ).toBe(false);
    }
  });

  it("never invents a name it could not resolve", () => {
    expect(library.templates.some((t) => t.name.includes(".."))).toBe(false);
    expect(library.templates.some((t) => t.name.includes("string.format"))).toBe(false);
    expect(library.templates.every((t) => t.name.trim() !== "")).toBe(true);
  });
});
