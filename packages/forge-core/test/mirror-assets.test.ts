import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { mirrorInstallAssets } from "../src/scan/assets.js";

/**
 * Indexing an install teaches the editor a texture's *name*; the canvas
 * still needs the file. Missing that second half is what draws a broken
 * thumbnail inside a planet.
 */

let install: string;
let assets: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "mirror-"));
  install = join(root, "ee");
  assets = join(root, "assets");
  mkdirSync(join(install, "resources", "planets"), { recursive: true });
  mkdirSync(join(install, "resources", "radar"), { recursive: true });
  mkdirSync(assets, { recursive: true });
});

describe("mirroring an install's drawable resources", () => {
  it("copies a texture the assets directory has never seen", () => {
    writeFileSync(join(install, "resources", "planets", "ice-planet.png"), "image-bytes");
    const { copied, warnings } = mirrorInstallAssets(install, assets);
    expect(warnings).toEqual([]);
    expect(copied).toEqual(["planets/ice-planet.png"]);
    expect(readFileSync(join(assets, "planets", "ice-planet.png"), "utf8")).toBe("image-bytes");
  });

  it("mirrors the nebula billboards that sit at the root of resources/", () => {
    writeFileSync(join(install, "resources", "Nebula1.png"), "n1");
    writeFileSync(join(install, "resources", "logo_icon.png"), "not-a-nebula");
    const { copied } = mirrorInstallAssets(install, assets);
    expect(copied).toEqual(["nebula/Nebula1.png"]);
    expect(existsSync(join(assets, "nebula", "logo_icon.png"))).toBe(false);
  });

  it("mirrors radar traces too, which fail the same way", () => {
    writeFileSync(join(install, "resources", "radar", "custom.png"), "trace");
    expect(mirrorInstallAssets(install, assets).copied).toEqual(["radar/custom.png"]);
  });

  it("writes nothing when the file is already identical", () => {
    writeFileSync(join(install, "resources", "planets", "moon-1.png"), "same");
    mkdirSync(join(assets, "planets"), { recursive: true });
    writeFileSync(join(assets, "planets", "moon-1.png"), "same");
    // An unchanged file must leave no trace in `git status`, so the report
    // says what actually moved.
    expect(mirrorInstallAssets(install, assets).copied).toEqual([]);
  });

  it("overwrites a stock texture the operator has replaced", () => {
    writeFileSync(join(install, "resources", "planets", "moon-1.png"), "theirs");
    mkdirSync(join(assets, "planets"), { recursive: true });
    writeFileSync(join(assets, "planets", "moon-1.png"), "stock");
    expect(mirrorInstallAssets(install, assets).copied).toEqual(["planets/moon-1.png"]);
    expect(readFileSync(join(assets, "planets", "moon-1.png"), "utf8")).toBe("theirs");
  });

  it("never deletes an asset the install no longer has", () => {
    // A project may still refer to it, and the viewer expects the stock set.
    mkdirSync(join(assets, "planets"), { recursive: true });
    writeFileSync(join(assets, "planets", "retired.png"), "old");
    mirrorInstallAssets(install, assets);
    expect(existsSync(join(assets, "planets", "retired.png"))).toBe(true);
  });

  it("ignores what the canvas cannot draw", () => {
    writeFileSync(join(install, "resources", "planets", "notes.txt"), "text");
    writeFileSync(join(install, "resources", "planets", "model.obj"), "mesh");
    expect(mirrorInstallAssets(install, assets).copied).toEqual([]);
  });

  it("says nothing about an install with no such directory", () => {
    const bare = mkdtempSync(join(tmpdir(), "bare-"));
    expect(mirrorInstallAssets(bare, assets)).toEqual({ copied: [], warnings: [] });
  });
});
