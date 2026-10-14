import { describe, expect, it } from "vitest";
import {
  NEBULA_OPACITY,
  nebulaClipId,
  nebulaTextureFor,
  nebulaTextureUrl,
} from "../src/canvas/nebulae.js";

/**
 * Unlike a planet's, a nebula's texture is not something the project can
 * state — EE picks its billboards itself. What the editor owes the author
 * is therefore stability, not accuracy: the same map must look the same
 * every time it is opened.
 */

describe("which billboard a nebula wears", () => {
  it("is stable for a given object", () => {
    expect(nebulaTextureFor("neb-01")).toBe(nebulaTextureFor("neb-01"));
  });

  it("is always one EE actually ships", () => {
    const shipped = ["Nebula1.png", "Nebula2.png", "Nebula3.png"];
    for (const id of ["a", "b", "c", "neb-01", "veil", "ZZ-99", ""]) {
      expect(shipped, id).toContain(nebulaTextureFor(id));
    }
  });

  it("spreads across the three, so a field is not one repeated cloud", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) seen.add(nebulaTextureFor(`neb-${i}`));
    expect(seen.size).toBe(3);
  });
});

describe("urls and ids", () => {
  it("serves from the Forge service's assets", () => {
    expect(nebulaTextureUrl("Nebula2.png")).toMatch(
      /^\/forge\/assets\/nebula\/Nebula2\.png$/,
    );
  });

  it("derives CSS-safe clip ids", () => {
    expect(nebulaClipId("neb:01/a")).toBe("nebula-neb-01-a");
  });
});

describe("opacity", () => {
  it("leaves the grid readable under the cloud", () => {
    expect(NEBULA_OPACITY).toBeGreaterThan(0);
    expect(NEBULA_OPACITY).toBeLessThanOrEqual(1);
  });
});
