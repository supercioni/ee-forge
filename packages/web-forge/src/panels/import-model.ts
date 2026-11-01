import type { EEModelDef } from "@forge/contracts";
import { Box3 } from "three";
import { normaliseObj, readObjNative } from "./model-geometry.js";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function importModelFiles(files: readonly File[]): Promise<EEModelDef> {
  const objects = files.filter(f => /\.obj$/i.test(f.name));
  const images = files.filter(f => /\.(png|jpe?g)$/i.test(f.name));
  if (objects.length !== 1 || images.length === 0 || files.length !== objects.length + images.length) throw new Error("Select one OBJ and one or more PNG/JPG textures together. GLB, glTF and MTL are not imported.");
  if (files.some(f => f.size > 8 * 1024 * 1024) || files.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024) throw new Error("Limit: 8 MiB per file, 20 MiB per model");
  const namespace = crypto.randomUUID();
  const resources: NonNullable<EEModelDef["resources"]> = [];
  const seen = new Set<string>();
  let radius = 1;
  for (const file of files) {
    const name = file.name.toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
    if (seen.has(name)) throw new Error(`Duplicate resource name: ${name}`);
    seen.add(name);
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.obj$/i.test(name)) {
      const text = normaliseObj(new TextDecoder().decode(bytes));
      bytes = new TextEncoder().encode(text);
      const geometry = readObjNative(text);
      const bounds = new Box3().setFromObject(geometry);
      radius = Math.max(.001, Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y))));
      geometry.traverse(child => { if ("geometry" in child) (child.geometry as { dispose: () => void }).dispose(); });
    }
    else {
      const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if ((/\.png$/.test(name) && !png) || (/\.jpe?g$/.test(name) && !jpeg)) throw new Error(`Not a valid PNG/JPG: ${file.name}`);
    }
    resources.push({ path: `forge-models/${namespace}/${name}`, base64: base64(bytes) });
  }
  if (resources.reduce((n, r) => n + r.base64.length, 0) > 27 * 1024 * 1024) throw new Error("Converted model is too large");
  return { id: "imported", name: "Imported model", mesh: resources.find(r => r.path.endsWith(".obj"))!.path,
    texture: resources.find(r => /\.(png|jpe?g)$/.test(r.path))!.path,
    specular: null, illumination: null, scale: 1, radius, renderOffset: null, collisionBox: null,
    beamPositions: [], tubePositions: [], engineEmitters: [], resources };
}
