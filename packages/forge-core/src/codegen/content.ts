import type {
  EECatalog,
  EEFactionDef,
  EEModelDef,
  EEProject,
  EETemplateDef,
} from "@forge/contracts";
import { carriedByCopy } from "../template-copy.js";
import {
  bool,
  CodegenError,
  ctor,
  num,
  raw,
  renderChain,
  str,
  type CallSpec,
} from "./lua.js";

/**
 * Emits the two content files.
 *
 * Load order (from EE's own binary, confirmed against the install):
 *
 *   model_data.lua → shipTemplates.lua → factionInfo.lua → scenario_*.lua
 *
 * **Factions** can be created from a scenario, so they ride in
 * `<project>_content.lua`, which the generated scenario `require`s.
 *
 * **Ship templates cannot.** EE refuses them outright — probed 2026-08-09,
 * `EmptyEpsilon.log`:
 *
 *   [ERROR]: ShipTemplate objects can not be created during a scenario.
 *
 * **Models follow the templates**, even though `ModelData()` itself works
 * fine from a scenario. A template that calls `setModel("x")` is evaluated
 * during `shipTemplates.lua`, which runs *before* any scenario — so a
 * scenario-defined model is not there yet and EE logs
 * `Failed to find model data: x`, silently falling back to a default mesh.
 * Splitting models by usage would make moving one reference from an artifact
 * to a template break the mesh silently, so all project models go to the
 * launch-time file. One rule, no footgun.
 *
 * The launch-time half is therefore `<project>_templates.lua`: models then
 * ship templates, loaded from `scripts/shiptemplates/` via one `require`
 * line in `shipTemplates.lua`. See ADR-0034 §3 and its correction note.
 */

function luaLocal(prefix: string, id: string): string {
  return `${prefix}_${id.replace(/-/g, "_")}`;
}

function emitFaction(catalog: EECatalog, faction: EEFactionDef): string {
  const local = luaLocal("faction", faction.id);
  const calls: CallSpec[] = [{ method: "setName", args: [str(faction.name)] }];
  if (faction.localeName !== null) {
    calls.push({ method: "setLocaleName", args: [str(faction.localeName)] });
  }
  if (faction.gmColor !== null) {
    const [r, g, b] = faction.gmColor;
    calls.push({ method: "setGMColor", args: [num(r), num(g), num(b)] });
  }
  if (faction.description !== null) {
    calls.push({ method: "setDescription", args: [str(faction.description)] });
  }

  const chain = renderChain(catalog, "FactionInfo", ctor("FactionInfo"), calls, {
    indent: "  ",
  });

  // Re-running a scenario re-runs this file. `existing_faction` uses pcall
  // because it is not yet settled whether getFactionInfo() returns nil or
  // raises for an unknown name (probe item 2, ADR-0034) — pcall is correct
  // under either answer.
  return `local ${local} = existing_faction(${JSON.stringify(faction.name)})
if ${local} == nil then
  ${local} = ${chain}
end`;
}

function emitFactionRelations(catalog: EECatalog, project: EEProject): string {
  const lines: string[] = [];
  const byName = new Map(project.factions.map((f) => [f.name, f]));

  for (const faction of project.factions) {
    const local = luaLocal("faction", faction.id);
    const ref = (name: string): string => {
      const own = byName.get(name);
      return own === undefined
        ? `getFactionInfo(${JSON.stringify(name)})`
        : luaLocal("faction", own.id);
    };
    // EE reciprocates setEnemy/setFriendly automatically, so only one
    // direction is emitted — writing both would be redundant, not wrong.
    for (const enemy of faction.enemies) {
      lines.push(
        renderChain(catalog, "FactionInfo", raw(local), [
          { method: "setEnemy", args: [raw(ref(enemy))] },
        ]),
      );
    }
    for (const friend of faction.friends) {
      lines.push(
        renderChain(catalog, "FactionInfo", raw(local), [
          { method: "setFriendly", args: [raw(ref(friend))] },
        ]),
      );
    }
  }
  return lines.join("\n");
}

function emitModel(catalog: EECatalog, model: EEModelDef): string {
  const calls: CallSpec[] = [
    { method: "setName", args: [str(model.name)] },
    { method: "setMesh", args: [str(model.mesh)] },
  ];
  if (model.texture !== null) calls.push({ method: "setTexture", args: [str(model.texture)] });
  if (model.specular !== null) {
    calls.push({ method: "setSpecular", args: [str(model.specular)] });
  }
  if (model.illumination !== null) {
    calls.push({ method: "setIllumination", args: [str(model.illumination)] });
  }
  if (model.scale !== null) calls.push({ method: "setScale", args: [num(model.scale)] });
  if (model.radius !== null) calls.push({ method: "setRadius", args: [num(model.radius)] });
  if (model.collisionBox !== null) {
    const [x, y] = model.collisionBox;
    calls.push({ method: "setCollisionBox", args: [num(x), num(y)] });
  }
  if (model.renderOffset !== null) {
    const [x, y, z] = model.renderOffset;
    calls.push({ method: "setRenderOffset", args: [num(x), num(y), num(z)] });
  }
  for (const [x, y, z] of model.beamPositions) {
    calls.push({ method: "addBeamPosition", args: [num(x), num(y), num(z)] });
  }
  for (const [x, y, z] of model.tubePositions) {
    calls.push({ method: "addTubePosition", args: [num(x), num(y), num(z)] });
  }
  for (const emitter of model.engineEmitters) {
    const [x, y, z] = emitter.position;
    const [r, g, b] = emitter.color;
    calls.push({
      method: "addEngineEmitter",
      args: [num(x), num(y), num(z), num(r), num(g), num(b), num(emitter.scale)],
    });
  }

  return renderChain(catalog, "ModelData", ctor("ModelData"), calls, { indent: "  " });
}

/**
 * `ShipTemplate` methods this emitter deliberately never writes, and why.
 *
 * A test walks the catalog and fails when a method is neither emitted from a
 * fully-populated template nor listed here — so the day EE adds authoring
 * surface, the suite says so instead of the gap being discovered by an
 * author who cannot express something.
 */
export const TEMPLATE_METHODS_NOT_EMITTED: Readonly<Record<string, string>> = {
  setBeam:
    "identical signature to setBeamWeapon in the catalog, and EE's own shiptemplates use the two names interchangeably " +
    "(starFighters.lua writes setBeam, corvette.lua writes setBeamWeapon). One field behind two names would only ask the author which spelling they prefer.",
  setDockClasses:
    "the older name for setExternalDockClasses — both assign the same external_dock_classes member in shipTemplate.cpp, and no dock_classes member exists. " +
    "The model carried both for a while and the emitter wrote both, in order, so the second silently overwrote the first. One list, written under the newer name.",
  __init__: "Lua class constructor; invoked by ShipTemplate(), never an authoring setter.",
};

/**
 * Bases before the variants that copy them.
 *
 * `copy()` chains off the base's *local*, so a variant emitted first would
 * index a nil. The document does not have to be in that order — the editor
 * appends — so the emitter puts it in one, and refuses a cycle rather than
 * choosing an arbitrary starting point.
 */
export function orderTemplates(
  templates: readonly EETemplateDef[],
): readonly EETemplateDef[] {
  const byName = new Map(templates.map((t) => [t.name, t]));
  const ordered: EETemplateDef[] = [];
  const done = new Set<string>();

  const visit = (template: EETemplateDef, chain: readonly string[]): void => {
    if (done.has(template.id)) return;
    if (chain.includes(template.id)) {
      throw new CodegenError(
        `ship templates copy each other in a cycle: ${[...chain, template.id].join(" → ")}`,
      );
    }
    const base = template.copyOf === null ? undefined : byName.get(template.copyOf);
    // A missing base is emitTemplate's error to report, with its own advice.
    if (base !== undefined) visit(base, [...chain, template.id]);
    done.add(template.id);
    ordered.push(template);
  };

  for (const template of templates) visit(template, []);
  return ordered;
}

function emitTemplate(
  catalog: EECatalog,
  template: EETemplateDef,
  projectTemplates: ReadonlyMap<string, EETemplateDef>,
): string {
  const local = luaLocal("template", template.id);

  let subject: string;
  let base: EETemplateDef | null = null;
  if (template.copyOf === null) {
    subject = renderChain(catalog, "ShipTemplate", ctor("ShipTemplate"), [
      { method: "setName", args: [str(template.name)] },
    ]);
  } else {
    // EE exposes no `getShipTemplate(name)` global (verified against the 48
    // documented globals), so `copy()` can only chain off a template this
    // same project defined earlier in the file.
    const found = projectTemplates.get(template.copyOf);
    if (found === undefined) {
      throw new CodegenError(
        `template "${template.name}" copies "${template.copyOf}", which this project does not define. ` +
          `EE has no getShipTemplate() global, so stock templates cannot be copied — define the base in the project instead.`,
      );
    }
    base = found;
    subject = renderChain(catalog, "ShipTemplate", raw(luaLocal("template", base.id)), [
      { method: "copy", args: [str(template.name)] },
    ]);
  }

  /**
   * Does this variant need to write the field?
   *
   * `copy()` carries *most* things over, so a variant only writes what it
   * changes — which is how EE's own templates are written (`corvette.lua`'s
   * Atlantis restates six setters, not sixty). For most setters restating
   * an identical value would merely be noise, but `addRoom` and `addDoor`
   * are *additive*: restating those would give the variant two copies of
   * the base's deck plan.
   *
   * The six fields `copy()` leaves behind are the exception, and they are
   * always written: skipping one because it matched the base would hand the
   * variant EE's constructor default instead — a jump ship keeping its
   * drive and losing its range. See {@link NOT_CARRIED_BY_COPY}.
   */
  const changed = (key: keyof EETemplateDef): boolean =>
    base === null ||
    !carriedByCopy(key) ||
    JSON.stringify(base[key]) !== JSON.stringify(template[key]);

  const calls: CallSpec[] = [];
  if (template.localeName !== null && changed("localeName")) {
    calls.push({ method: "setLocaleName", args: [str(template.localeName)] });
  }
  if (changed("kind")) calls.push({ method: "setType", args: [str(template.kind)] });
  if (template.className !== null && (changed("className") || changed("subclassName"))) {
    calls.push({
      method: "setClass",
      args: [str(template.className), str(template.subclassName ?? "")],
    });
  }
  if (template.description !== null && changed("description")) {
    calls.push({ method: "setDescription", args: [str(template.description)] });
  }
  if (template.model !== null && changed("model")) {
    calls.push({ method: "setModel", args: [str(template.model)] });
  }
  if (template.radarTrace !== null && changed("radarTrace")) {
    calls.push({ method: "setRadarTrace", args: [str(template.radarTrace)] });
  }
  if (template.hull !== null && changed("hull")) {
    calls.push({ method: "setHull", args: [num(template.hull)] });
  }
  if (template.shields.length > 0 && changed("shields")) {
    calls.push({ method: "setShields", args: template.shields.map(num) });
  }
  if (template.speed !== null && changed("speed")) {
    const s = template.speed;
    const args = [num(s.impulse), num(s.turn), num(s.acceleration)];
    if (s.reverseSpeed !== null) {
      args.push(num(s.reverseSpeed));
      if (s.reverseAcceleration !== null) args.push(num(s.reverseAcceleration));
    }
    calls.push({ method: "setSpeed", args });
  }
  if (template.combatManeuver !== null && changed("combatManeuver")) {
    calls.push({
      method: "setCombatManeuver",
      args: [num(template.combatManeuver.boost), num(template.combatManeuver.strafe)],
    });
  }
  if (template.warpSpeed !== null && changed("warpSpeed")) {
    calls.push({ method: "setWarpSpeed", args: [num(template.warpSpeed)] });
  }
  if (template.jumpDrive !== null && changed("jumpDrive")) {
    calls.push({ method: "setJumpDrive", args: [bool(template.jumpDrive.enabled)] });
    if (template.jumpDrive.minRange !== null && template.jumpDrive.maxRange !== null) {
      calls.push({
        method: "setJumpDriveRange",
        args: [num(template.jumpDrive.minRange), num(template.jumpDrive.maxRange)],
      });
    }
  }
  if (template.cloaking !== null && changed("cloaking")) {
    calls.push({ method: "setCloaking", args: [bool(template.cloaking)] });
  }
  if (template.energyStorage !== null && changed("energyStorage")) {
    calls.push({ method: "setEnergyStorage", args: [num(template.energyStorage)] });
  }
  if (template.repairCrewCount !== null && changed("repairCrewCount")) {
    calls.push({ method: "setRepairCrewCount", args: [num(template.repairCrewCount)] });
  }
  const beams = changed("beams") ? template.beams : [];
  for (const beam of beams) {
    calls.push({
      method: "setBeamWeapon",
      args: [
        num(beam.index),
        num(beam.arc),
        num(beam.direction),
        num(beam.range),
        num(beam.cycleTime),
        num(beam.damage),
      ],
    });
    if (beam.turret !== null) {
      calls.push({
        method: "setBeamWeaponTurret",
        args: [
          num(beam.index),
          num(beam.turret.arc),
          num(beam.turret.direction),
          num(beam.turret.rotationRate),
        ],
      });
    }
    if (beam.texture !== null) {
      calls.push({ method: "setBeamTexture", args: [num(beam.index), str(beam.texture)] });
    }
    if (beam.energyPerFire !== null) {
      calls.push({
        method: "setBeamWeaponEnergyPerFire",
        args: [num(beam.index), num(beam.energyPerFire)],
      });
    }
    if (beam.heatPerFire !== null) {
      calls.push({
        method: "setBeamWeaponHeatPerFire",
        args: [num(beam.index), num(beam.heatPerFire)],
      });
    }
  }
  if (base !== null && changed("beams")) {
    // EE's own idiom for taking a beam away from a variant: zero it. The
    // Atlantis in `shiptemplates/corvette.lua` drops its third battery with
    // `setBeam(2, 0, 0, 0, 0, 0)`. There is no removeBeam().
    const kept = new Set(template.beams.map((b) => b.index));
    for (const beam of base.beams) {
      if (kept.has(beam.index)) continue;
      calls.push({
        method: "setBeamWeapon",
        args: [num(beam.index), num(0), num(0), num(0), num(0), num(0)],
      });
    }
  }
  if (template.tubes !== null && changed("tubes")) {
    calls.push({
      method: "setTubes",
      args: [num(template.tubes.count), num(template.tubes.loadTime)],
    });
    for (const tube of template.tubes.perTube) {
      if (tube.direction !== null) {
        calls.push({ method: "setTubeDirection", args: [num(tube.index), num(tube.direction)] });
      }
      if (tube.size !== null) {
        calls.push({ method: "setTubeSize", args: [num(tube.index), str(tube.size)] });
      }
      if (tube.loadTime !== null) {
        calls.push({ method: "setTubeLoadTime", args: [num(tube.index), num(tube.loadTime)] });
      }
      // Exclusivity first: it clears every other type, so an `allow` written
      // after it survives and one written before it would not. EE's own
      // templates chain them in this order (`shiptemplates/frigates.lua`).
      if (tube.exclusiveFor !== null) {
        calls.push({
          method: "setWeaponTubeExclusiveFor",
          args: [num(tube.index), str(tube.exclusiveFor)],
        });
      }
      for (const weapon of tube.allow) {
        calls.push({ method: "weaponTubeAllowMissle", args: [num(tube.index), str(weapon)] });
      }
      for (const weapon of tube.disallow) {
        calls.push({ method: "weaponTubeDisallowMissle", args: [num(tube.index), str(weapon)] });
      }
    }
  }
  if (changed("weaponStorage")) {
    for (const w of template.weaponStorage) {
      calls.push({ method: "setWeaponStorage", args: [str(w.weapon), num(w.amount)] });
    }
  }
  // `addRoom`/`addDoor` are additive and EE has no way to remove either, so
  // a variant either inherits the base's deck plan whole or is not a
  // variant. Restating an identical plan would duplicate it in place.
  if (base !== null && (changed("rooms") || changed("doors"))) {
    throw new CodegenError(
      `template "${template.name}" copies "${base.name}" but changes its deck plan. ` +
        `addRoom()/addDoor() only ever add, and EE exposes no way to remove an inherited room or door — ` +
        `give the variant the same rooms and doors as its base, or make it a template of its own.`,
    );
  }
  for (const room of base === null ? template.rooms : []) {
    calls.push(
      room.system === null
        ? {
            method: "addRoom",
            args: [num(room.x), num(room.y), num(room.width), num(room.height)],
          }
        : {
            method: "addRoomSystem",
            args: [
              num(room.x),
              num(room.y),
              num(room.width),
              num(room.height),
              str(room.system),
            ],
          },
    );
  }
  for (const door of base === null ? template.doors : []) {
    calls.push({
      method: "addDoor",
      args: [num(door.x), num(door.y), bool(door.horizontal)],
    });
  }
  if (template.longRangeRadarRange !== null && changed("longRangeRadarRange")) {
    calls.push({
      method: "setLongRangeRadarRange",
      args: [num(template.longRangeRadarRange)],
    });
  }
  if (template.shortRangeRadarRange !== null && changed("shortRangeRadarRange")) {
    calls.push({
      method: "setShortRangeRadarRange",
      args: [num(template.shortRangeRadarRange)],
    });
  }
  if (template.defaultAI !== null && changed("defaultAI")) {
    calls.push({ method: "setDefaultAI", args: [str(template.defaultAI)] });
  }
  if (template.impulseSoundFile !== null && changed("impulseSoundFile")) {
    calls.push({ method: "setImpulseSoundFile", args: [str(template.impulseSoundFile)] });
  }
  // Two lists, not three. `setDockClasses` assigns the same
  // `external_dock_classes` member that `setExternalDockClasses` does, so
  // emitting both put the second in charge of a value the author had split
  // across two fields. The newer name is the one written.
  for (const [key, method] of [
    ["externalDockClasses", "setExternalDockClasses"],
    ["internalDockClasses", "setInternalDockClasses"],
  ] as const) {
    const classes = template[key];
    if (classes.length > 0 && changed(key)) {
      calls.push({ method, args: classes.map(str) });
    }
  }
  for (const [key, method] of [
    ["sharesEnergyWithDocked", "setSharesEnergyWithDocked"],
    ["repairDocked", "setRepairDocked"],
    ["restocksScanProbes", "setRestocksScanProbes"],
    ["restocksMissilesDocked", "setRestocksMissilesDocked"],
    ["canScan", "setCanScan"],
    ["canHack", "setCanHack"],
    ["canDock", "setCanDock"],
    ["canCombatManeuver", "setCanCombatManeuver"],
    ["canSelfDestruct", "setCanSelfDestruct"],
    ["canLaunchProbe", "setCanLaunchProbe"],
  ] as const) {
    const value = template[key];
    if (value !== null && changed(key)) {
      calls.push({ method, args: [bool(value)] });
    }
  }
  if (template.hidden && changed("hidden")) calls.push({ method: "hidden", args: [] });

  // A variant that overrides nothing has no second statement to write, and
  // a bare `template_x` on its own line is not a Lua statement at all.
  if (calls.length === 0) return `local ${local} = ${subject}`;
  const rest = renderChain(catalog, "ShipTemplate", raw(local), calls, { indent: "  " });
  return `local ${local} = ${subject}\n${rest}`;
}

export function emitContent(catalog: EECatalog, project: EEProject): string {
  const sections: string[] = [];

  sections.push(`-- Returns an existing FactionInfo by name, or nil.
-- Probed against a live EE-2024.12.08 (2026-08-09, ADR-0034 item 2):
-- getFactionInfo() on an unknown name returns nil and does NOT raise,
-- so a plain call is enough and re-running this file is idempotent.
local function existing_faction(name)
  local found = getFactionInfo(name)
  if found ~= nil and found:isValid() then return found end
  return nil
end`);

  if (project.factions.length > 0) {
    sections.push(
      ["-- === Factions ===", ...project.factions.map((f) => emitFaction(catalog, f))].join(
        "\n\n",
      ),
    );
    const relations = emitFactionRelations(catalog, project);
    if (relations !== "") {
      sections.push(`-- Faction relations (EE reciprocates automatically)\n${relations}`);
    }
  }

  if (sections.length === 1) {
    return `-- (project declares no factions)\n`;
  }
  return `${sections.join("\n\n")}\n`;
}

/**
 * Emits `<project>_templates.lua` — the launch-time half: model data first,
 * then the ship templates that reference it.
 *
 * This file is NOT `require`d by the generated scenario. It belongs in
 * `<EE>/scripts/shiptemplates/` with a matching `require` line in
 * `shipTemplates.lua`.
 */
export function emitTemplates(catalog: EECatalog, project: EEProject): string {
  const sections: string[] = [];

  if (project.models.length > 0) {
    sections.push(
      [
        "-- === Models ===",
        "-- Registered here rather than from the scenario: templates below are",
        "-- evaluated during shipTemplates.lua, long before any scenario runs.",
        ...project.models.map((m) => emitModel(catalog, m)),
      ].join("\n\n"),
    );
  }

  if (project.templates.length > 0) {
    const byName = new Map(project.templates.map((t) => [t.name, t]));
    sections.push(
      [
        "-- === Ship templates ===",
        ...orderTemplates(project.templates).map((t) => emitTemplate(catalog, t, byName)),
      ].join("\n\n"),
    );
  }

  if (sections.length === 0) return "-- (project declares no models or ship templates)\n";
  return `${sections.join("\n\n")}\n`;
}
