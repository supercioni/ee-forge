import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Reads model resources straight from an EmptyEpsilon installation, the way the engine finds them.
 *
 * EE looks a resource up in `resources/` first and then in every `packs/*.pack` (ADR-0060). Nothing is
 * extracted or copied: an archive contributes only its index (cached while the file is unchanged) and the
 * byte range of the resource being asked for. A resource that disappears from the installation is therefore
 * missing on the next request — there is no stale copy to present as available.
 */

export type ModelResourceState = "ok" | "missing" | "unsupported-format" | "refused" | "archive-unreadable";

export type ModelResourceOrigin =
  | { readonly kind: "file"; readonly file: string }
  | { readonly kind: "pack"; readonly pack: string; readonly offset: number; readonly length: number };

export interface ModelResourceStatus {
  readonly path: string;
  readonly state: ModelResourceState;
  /** Where the bytes come from when `state` is `ok` (or `unsupported-format`: found, but not previewable). */
  readonly origin: ModelResourceOrigin | null;
  readonly bytes: number | null;
  /** Human-readable reason for any state other than `ok`; also notes a resource that exists in more than one place. */
  readonly detail: string | null;
}

const MESH_EXT = [".model", ".obj"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg"];
/** A single resource larger than this is refused rather than loaded into memory. */
export const MAX_MODEL_RESOURCE_BYTES = 128 * 1024 * 1024;

export interface PackEntry { readonly offset: number; readonly length: number }

/** EmptyEpsilon pack_gen format: big-endian version and count, byte-length names, offset and length. */
function parsePackIndex(bytes: Buffer, fileSize: number): Map<string, PackEntry> {
  if (bytes.length < 8) throw new Error("Truncated resource pack");
  if (bytes.readUInt32BE(0) !== 0) throw new Error("Unsupported resource pack version");
  const count = bytes.readUInt32BE(4);
  if (count > 1000000) throw new Error("Invalid resource pack entry count");
  const entries = new Map<string, PackEntry>();
  let cursor = 8;
  for (let i = 0; i < count; i++) {
    if (cursor >= bytes.length) throw new Error("Truncated resource pack index");
    const size = bytes[cursor++]!;
    if (cursor + size + 8 > bytes.length) throw new Error("Truncated resource pack entry");
    const name = bytes.toString("utf8", cursor, cursor + size); cursor += size;
    const offset = bytes.readUInt32BE(cursor), length = bytes.readUInt32BE(cursor + 4); cursor += 8;
    if (offset + length > fileSize) throw new Error(`Invalid resource bounds: ${name}`);
    entries.set(name, { offset, length });
  }
  for (const [name, r] of entries) if (r.offset < cursor) throw new Error(`Resource overlaps its index: ${name}`);
  return entries;
}

/** Index of an in-memory pack (kept for tests and small archives). */
export function packResourceRanges(bytes: Buffer): Map<string, PackEntry> {
  return parsePackIndex(bytes, bytes.length);
}

const indexCache = new Map<string, Map<string, PackEntry> | Error>();

/** Read an archive's index only: the header chunk grows until the whole index parses; resource bytes are never read. */
function readPackIndex(file: string): Map<string, PackEntry> {
  const stat = statSync(file);
  const key = `${file}|${stat.size}|${stat.mtimeMs}`;
  const cached = indexCache.get(key);
  if (cached instanceof Error) throw cached;
  if (cached !== undefined) return cached;
  for (const known of [...indexCache.keys()]) if (known.startsWith(`${file}|`)) indexCache.delete(known);
  const fd = openSync(file, "r");
  try {
    let chunk = 64 * 1024;
    for (;;) {
      const size = Math.min(chunk, stat.size);
      const buffer = Buffer.alloc(size);
      const got = readSync(fd, buffer, 0, size, 0);
      try {
        const entries = parsePackIndex(buffer.subarray(0, got), stat.size);
        indexCache.set(key, entries);
        return entries;
      } catch (error) {
        const truncatedIndex = error instanceof Error && /^Truncated resource pack (index|entry)$/.test(error.message);
        if (truncatedIndex && size < stat.size) { chunk *= 4; continue; }
        const failure = error instanceof Error ? error : new Error(String(error));
        indexCache.set(key, failure);
        throw failure;
      }
    }
  } finally {
    closeSync(fd);
  }
}

function safeName(path: string): string | null {
  if (path === "" || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  if (path.split("/").some(part => part === "" || part === "." || part === "..")) return null;
  return path;
}

function formatState(path: string): { ok: boolean; detail: string | null } {
  const lower = path.toLowerCase();
  if ([...MESH_EXT, ...IMAGE_EXT].some(ext => lower.endsWith(ext))) return { ok: true, detail: null };
  return { ok: false, detail: `Unsupported format for preview (${lower.slice(lower.lastIndexOf(".")) || "no extension"}); supported: ${[...MESH_EXT, ...IMAGE_EXT].join(", ")}` };
}

export interface ModelResourceReader {
  readonly install: string;
  /** Find a resource now. Never throws: every failure is a state. */
  resolve(path: string): ModelResourceStatus;
  /** The bytes of a resource that resolved; throws if it changed or was truncated since. */
  read(status: ModelResourceStatus): Buffer;
  /** SHA-256 of the resource, or null when it does not resolve to `ok`. */
  hash(path: string): string | null;
}

/** A reader bound to one installation folder. Cheap to create; archive indexes are cached by file size and mtime. */
export function modelResourceReader(install: string): ModelResourceReader {
  const root = resolve(install);
  const resources = join(root, "resources");
  const packsDir = join(root, "packs");
  const packNames = (): string[] => {
    try { return readdirSync(packsDir).filter(n => n.toLowerCase().endsWith(".pack")).sort(); } catch { return []; }
  };
  const status = (path: string, state: ModelResourceState, origin: ModelResourceOrigin | null, bytes: number | null, detail: string | null): ModelResourceStatus => ({ path, state, origin, bytes, detail });

  const resolveResource = (path: string): ModelResourceStatus => {
    const name = safeName(path);
    if (name === null) return status(path, "refused", null, null, "Resource path refused: it must be a relative path with forward slashes and no '..'");
    const loose = resolve(resources, name);
    if (!loose.startsWith(resources + sep)) return status(path, "refused", null, null, "Resource path refused: outside the installation's resources folder");
    const where: ModelResourceStatus[] = [];
    const notes: string[] = [];
    try {
      if (existsSync(loose) && statSync(loose).isFile()) where.push(status(path, "ok", { kind: "file", file: `resources/${name}` }, statSync(loose).size, null));
    } catch (error) {
      return status(path, "refused", null, null, `Cannot read resources/${name}: ${String(error)}`);
    }
    const unreadable: string[] = [];
    for (const pack of packNames()) {
      try {
        const entry = readPackIndex(join(packsDir, pack)).get(name);
        if (entry !== undefined) where.push(status(path, "ok", { kind: "pack", pack: `packs/${pack}`, offset: entry.offset, length: entry.length }, entry.length, null));
      } catch (error) {
        unreadable.push(`packs/${pack}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const first = where[0];
    if (first === undefined) {
      if (unreadable.length > 0) return status(path, "archive-unreadable", null, null, `Not found in readable sources; unreadable archive(s): ${unreadable.join("; ")}`);
      return status(path, "missing", null, null, "Not found in resources/ or any packs/*.pack of this installation");
    }
    if (where.length > 1) notes.push(`Also present in ${where.slice(1).map(w => w.origin!.kind === "file" ? w.origin!.file : (w.origin as { pack: string }).pack).join(", ")}; the first source wins, as in EmptyEpsilon.`);
    if (first.bytes! > MAX_MODEL_RESOURCE_BYTES) return status(path, "refused", first.origin, first.bytes, `Resource is larger than ${MAX_MODEL_RESOURCE_BYTES / 1024 / 1024} MiB`);
    const format = formatState(name);
    return status(path, format.ok ? "ok" : "unsupported-format", first.origin, first.bytes, [format.detail, ...notes].filter(Boolean).join(" ") || null);
  };

  const read = (found: ModelResourceStatus): Buffer => {
    if (found.origin === null) throw new Error(`Resource ${found.path} did not resolve`);
    if (found.origin.kind === "file") return readRange(join(root, found.origin.file), 0, found.bytes!, true);
    const pack = join(root, found.origin.pack);
    // Re-read the live index: if the archive changed since the status was made, the range may no longer be the resource.
    const entry = readPackIndex(pack).get(found.path);
    if (entry === undefined) throw new Error(`${found.path} is no longer in ${found.origin.pack}`);
    return readRange(pack, entry.offset, entry.length, false);
  };

  return {
    install: root,
    resolve: resolveResource,
    read,
    hash(path) {
      const found = resolveResource(path);
      if (found.state !== "ok") return null;
      try { return createHash("sha256").update(read(found)).digest("hex"); } catch { return null; }
    },
  };
}

function readRange(file: string, offset: number, length: number, whole: boolean): Buffer {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    if (whole) length = size;
    if (offset + length > size) throw new Error(`${file} is truncated: needs ${offset + length} bytes, has ${size}`);
    const out = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const got = readSync(fd, out, done, length - done, offset + done);
      if (got === 0) throw new Error(`${file} ended early`);
      done += got;
    }
    return out;
  } finally {
    closeSync(fd);
  }
}
