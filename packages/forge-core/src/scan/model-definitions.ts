import { expandModelStringLoops } from "./expand-model-loops.js";
import type { EEModelDef } from "@forge/contracts";
import { parseDataScript, type LuaCall } from "./lua-data.js";

export interface ScannedModelDefinition {
  readonly definition: EEModelDef;
  readonly warnings: readonly string[];
}

/** Read ModelData literals without executing installation-owned Lua. */
export function readModelDefinitions(source: string): Map<string, ScannedModelDefinition> {
  const records: Array<{ definition: EEModelDef; warnings: string[] }> = [];
  const variables = new Map<string, (typeof records)[number]>();
  // Space concatenation outside quoted strings: the numeric unroller must not mistake `..index` for field access.
  const spaced = source.replace(/--[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\.\./g, token => token === ".." ? " .. " : token);
  const parsed = parseDataScript(expandModelStringLoops(spaced));
  for (const statement of parsed.statements) {
    let record = statement.subject === null ? undefined : variables.get(statement.subject);
    if (statement.constructs === "ModelData") {
      record = { definition: { id: `model_${records.length + 1}`, name: "", mesh: "", texture: null, specular: null,
        illumination: null, normalMap: null, scale: null, radius: null, collisionBox: null, renderOffset: null,
        beamPositions: [], tubePositions: [], engineEmitters: [] }, warnings: [...parsed.warnings] };
      records.push(record);
      if (statement.assignsTo !== null) variables.set(statement.assignsTo, record);
    }
    if (record === undefined) continue;
    for (const call of statement.calls) {
      const d = record.definition;
      const numbers = (count: number): number[] | null => literalNumbers(call, count);
      const text = (): string | null => call.literal[0] === true && typeof call.args[0] === "string" ? call.args[0] : null;
      let understood = true;
      switch (call.method) {
        case "setName": case "setMesh": case "setTexture": case "setSpecular": case "setIllumination": case "setNormalMap": {
          const keys = { setName: "name", setMesh: "mesh", setTexture: "texture", setSpecular: "specular", setIllumination: "illumination", setNormalMap: "normalMap" } as const;
          const value = text(); if (value === null) understood = false; else record.definition = { ...d, [keys[call.method]]: value }; break;
        }
        case "setScale": case "setRadius": {
          const ns = numbers(1); if (ns === null || ns[0]! <= 0) understood = false;
          else record.definition = { ...d, [call.method === "setScale" ? "scale" : "radius"]: ns[0] }; break;
        }
        case "setCollisionBox": {
          const ns = numbers(2); if (ns === null) understood = false; else d.collisionBox = [ns[0]!, ns[1]!]; break;
        }
        case "setRenderOffset": case "addBeamPosition": case "addTubePosition": {
          const ns = numbers(3); if (ns === null) { understood = false; break; }
          const position: [number, number, number] = [ns[0]!, ns[1]!, ns[2]!];
          if (call.method === "setRenderOffset") d.renderOffset = position;
          else if (call.method === "addBeamPosition") d.beamPositions.push(position);
          else d.tubePositions.push(position);
          break;
        }
        case "addEngineEmitter": case "addEngineEmitor": {
          const ns = numbers(7);
          if (ns === null || ns[6]! <= 0 || ns.slice(3, 6).some(n => n < 0)) { understood = false; break; }
          d.engineEmitters.push({ position: [ns[0]!, ns[1]!, ns[2]!], color: [ns[3]!, ns[4]!, ns[5]!], scale: ns[6]! }); break;
        }
        default: understood = false;
      }
      if (!understood) record.warnings.push(`${call.method}: not a supported literal definition; inspect the source before copying this model.`);
    }
  }
  return new Map(records.filter(r => r.definition.name !== "").map(r => [r.definition.name, r]));
}

function literalNumbers(call: LuaCall, count: number): number[] | null {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = call.args[i];
    if (call.literal[i] !== true || typeof v !== "number" || !Number.isFinite(v)) return null;
    values.push(v);
  }
  return values;
}
