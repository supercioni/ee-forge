import { join } from "node:path";
import type { EEProject } from "@forge/contracts";
import { EEModelResourceSchema } from "@forge/contracts";
import type { BuildFile } from "./codegen/build.js";

/** Canonical bytes used by export, install, hashes and preflight alike. */
export function buildFileBytes(file: Pick<BuildFile, "contents" | "encoding">): Buffer {
  if (file.encoding !== "base64") return Buffer.from(file.contents, "utf8");
  const bytes = Buffer.from(file.contents, "base64");
  if (bytes.toString("base64") !== file.contents) throw new Error("Invalid base64 resource");
  return bytes;
}
function safeName(file: Pick<BuildFile, "name" | "install">): string {
  if (file.install === "resources") {
    if (!/^forge-models\/[a-z0-9_-]+\/[a-z0-9_.-]+\.(obj|png|jpg|jpeg)$/.test(file.name)) throw new Error(`Unsafe resource destination: ${file.name}`);
  } else if (!/^[a-zA-Z0-9_.-]+\.lua$/.test(file.name) || file.name.includes("..")) throw new Error(`Unsafe script destination: ${file.name}`);
  return file.name;
}
export function installFilePath(root: string, file: Pick<BuildFile, "name" | "install">): string {
  const name = safeName(file);
  return file.install === "resources" ? join(root, "resources", name) : file.install === "shiptemplates" ? join(root, "scripts", "shiptemplates", name) : join(root, "scripts", name);
}
/** Preserve historic ledger keys for scripts; resource backups never escape the backup directory. */
export function installFileKey(file: Pick<BuildFile, "name" | "install">): string {
  const name = safeName(file);
  return file.install === "resources" ? `resources/${name}` : file.install === "shiptemplates" ? `shiptemplates/${name}` : name;
}
export function buildOutputPath(root: string, file: Pick<BuildFile, "name" | "install">): string {
  return file.install === "resources" ? join(root, "resources", safeName(file)) : join(root, safeName(file));
}
export function modelResourceFiles(project: EEProject): BuildFile[] {
  const files = new Map<string, BuildFile>();
  const names = new Set<string>(), ids = new Set<string>();
  let total = 0;
  for (const model of project.models) {
    if (names.has(model.name) || ids.has(model.id)) throw new Error(`Duplicate model name or id: ${model.name}`);
    names.add(model.name); ids.add(model.id);
    for (const input of model.resources ?? []) {
      const resource = EEModelResourceSchema.parse(input);
      const file: BuildFile = { name: resource.path, contents: resource.base64, encoding: "base64", install: "resources" };
      const previous = files.get(file.name);
      if (previous !== undefined && previous.contents !== file.contents) throw new Error(`Conflicting model resource: ${file.name}`);
      if (previous === undefined) total += buildFileBytes(file).length;
      files.set(file.name, file);
    }
  }
  if (total > 20 * 1024 * 1024) throw new Error("Imported model resources exceed 20 MiB per project");
  for (const model of project.models) {
    for (const path of [model.mesh, model.texture, model.specular, model.illumination, model.normalMap]) {
      if (path?.startsWith("forge-models/") && !files.has(path)) throw new Error(`Missing imported resource: ${path}`);
    }
  }
  return [...files.values()];
}
