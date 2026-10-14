import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildInventory, filterManifest, modelsUsedByForge } from "../scripts/asset-inventory.mjs";

/** The licence rule for what travels in the installer: positive evidence or nothing. */
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function glb(extras: Record<string, unknown> | null): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0", ...(extras === null ? {} : { extras }) } }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}

function assets(files: Record<string, Buffer | string>): string {
  const root = mkdtempSync(join(tmpdir(), "inv-"));
  dirs.push(root);
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(root, ...path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...path.split("/")), bytes);
  }
  return root;
}
const by = (entries: ReturnType<typeof buildInventory>) => Object.fromEntries(entries.map((e) => [e.path, e]));

describe("the asset inventory", () => {
  const root = assets({
    "ok/by.glb": glb({ license: "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)", author: "Someone (https://example.invalid)", title: "A model", source: "https://example.invalid/m" }),
    "ok/zero.glb": glb({ license: "CC0-1.0" }),
    "no/nc.glb": glb({ license: "CC-BY-NC-4.0 (…)", author: "x" }),
    "no/nd.glb": glb({ license: "CC-BY-ND-4.0" }),
    "no/sa.glb": glb({ license: "CC-BY-SA-4.0" }),
    "no/none.glb": glb(null),
    "ee-ships/hull.glb": glb({ license: "CC-BY-4.0" }),
    "ships/atlantis.glb": glb(null),
    "planets/sun.png": "png",
    "radar/blip.png": "png",
    "README.md": "doc",
    "manifest.json": "{}",
  });
  const inv = by(buildInventory(root));

  it("ships a glTF only when its own metadata carries a CC0 or CC-BY licence", () => {
    expect(inv["ok/by.glb"]).toMatchObject({ distribute: true, license: "CC-BY-4.0", author: "Someone (https://example.invalid)", source: "https://example.invalid/m" });
    expect(inv["ok/zero.glb"]).toMatchObject({ distribute: true, license: "CC0-1.0" });
  });

  it("withholds non-commercial, no-derivatives, share-alike and licence-less files, with the reason", () => {
    for (const p of ["no/nc.glb", "no/nd.glb", "no/sa.glb", "no/none.glb"]) expect(inv[p]!.distribute, p).toBe(false);
    expect(inv["no/nc.glb"]!.reason).toMatch(/non-commercial/);
    expect(inv["no/none.glb"]!.reason).toMatch(/no licence or provenance/);
  });

  it("withholds everything converted from EmptyEpsilon and the stock images, even when a licence string is present", () => {
    expect(inv["ee-ships/hull.glb"]).toMatchObject({ distribute: false });
    expect(inv["ee-ships/hull.glb"]!.reason).toMatch(/EmptyEpsilon|pack/);
    expect(inv["planets/sun.png"]!.distribute).toBe(false);
    expect(inv["radar/blip.png"]!.reason).toMatch(/user's own install/);
  });

  it("knows the Kenney CC0 model by its recorded provenance, and skips documentation files", () => {
    expect(inv["ships/atlantis.glb"]).toMatchObject({ distribute: true, license: "CC0-1.0", author: "Kenney (www.kenney.nl)" });
    expect(inv["README.md"]).toBeUndefined();
    expect(inv["manifest.json"]).toBeUndefined();
  });

  it("does not ship a licensed file the editor never loads, and drops the manifest entries of withheld models", () => {
    const manifest = {
      "CpuShip:A": { model: "ok/by.glb" },
      "CpuShip:B": { model: "ee-ships/hull.glb" },
      "Mine:default": { model: "ok/zero.glb" }, // viewer-only
    };
    const used = modelsUsedByForge(manifest);
    expect([...used]).toEqual(["ok/by.glb", "ee-ships/hull.glb"]);
    const filtered = by(buildInventory(root, used));
    expect(filtered["ok/by.glb"]!.distribute).toBe(true);
    expect(filtered["ok/zero.glb"]!.distribute).toBe(false);
    expect(filtered["ok/zero.glb"]!.reason).toMatch(/never loads/);
    const { manifest: kept, dropped } = filterManifest(manifest, Object.values(filtered));
    expect(Object.keys(kept)).toEqual(["CpuShip:A"]);
    expect(dropped.sort()).toEqual(["CpuShip:B", "Mine:default"]);
  });
});
