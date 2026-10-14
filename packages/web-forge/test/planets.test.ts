import { describe, expect, it } from "vitest";
import {
  CLOUD_OPACITY,
  atmosphereBand,
  atmosphereCss,
  planetClipId,
  planetCloudMaskId,
  planetTextureUrl,
} from "../src/canvas/planets.js";

/**
 * Planets are filled with the very texture the project hands EE, and ringed
 * in their atmosphere colour. These pin both translations.
 */

describe("planet texture urls", () => {
  it("serves a project's resource-relative path from the Forge service's assets", () => {
    expect(planetTextureUrl("planets/moon-1.png")).toMatch(
      /^\/forge\/assets\/planets\/moon-1\.png$/,
    );
  });

  it("assumes a bare filename is a stock planet texture", () => {
    // The inspector only offers `planets/*`, so this is the sane reading.
    expect(planetTextureUrl("sun.png")).toMatch(/\/assets\/planets\/sun\.png$/);
  });

  it("tolerates a leading slash without doubling it", () => {
    expect(planetTextureUrl("/planets/gas-2.png")).toMatch(/\/assets\/planets\/gas-2\.png$/);
    expect(planetTextureUrl("/planets/gas-2.png")).not.toContain("//assets");
  });

  it("escapes characters that would break the url", () => {
    expect(planetTextureUrl("planets/my planet.png")).toMatch(/my%20planet\.png$/);
  });
});

describe("atmosphere colour", () => {
  it("converts EE's 0..1 floats to CSS bytes", () => {
    expect(atmosphereCss([1, 0.5, 0], "#000")).toBe("rgb(255, 128, 0)");
    expect(atmosphereCss([0, 0, 0], "#000")).toBe("rgb(0, 0, 0)");
  });

  it("falls back to the palette tone when a planet has no atmosphere", () => {
    expect(atmosphereCss(null, "#7e9cd8")).toBe("#7e9cd8");
  });

  it("clamps rather than emitting an out-of-gamut colour", () => {
    // The schema bounds the document, but a hand-edited project.json is
    // still a plausible source and must not produce `rgb(510, ...)`.
    expect(atmosphereCss([2, -1, 0.25], "#000")).toBe("rgb(255, 0, 64)");
  });
});

describe("the cloud layer", () => {
  it("is sheer enough to keep the surface identifiable", () => {
    expect(CLOUD_OPACITY).toBeGreaterThan(0);
    expect(CLOUD_OPACITY).toBeLessThan(1);
  });

  it("resolves a cloud map through the same asset mount as the surface", () => {
    expect(planetTextureUrl("planets/clouds-1.png")).toMatch(
      /\/assets\/planets\/clouds-1\.png$/,
    );
  });
});

describe("the atmosphere band", () => {
  it("scales with the body so it reads at any size", () => {
    // A stroke width, so exactness past the pixel is not the point.
    expect(atmosphereBand(50)).toBeCloseTo(7);
    expect(atmosphereBand(100)).toBeCloseTo(14);
  });

  it("stays visible when the planet is barely a dot", () => {
    expect(atmosphereBand(6)).toBe(1.5);
  });

  it("caps, so a gas giant stays a body rather than a ring", () => {
    expect(atmosphereBand(1000)).toBe(16);
  });

  it("never eats more than a third of the disc", () => {
    for (const radius of [0.5, 1, 2, 4, 8, 20, 60, 200, 900]) {
      expect(atmosphereBand(radius), `r=${radius}`).toBeLessThanOrEqual(radius * 0.35);
    }
  });
});

describe("clip and mask ids", () => {
  it("derives CSS-safe ids per planet", () => {
    expect(planetClipId("planet-01")).toBe("planet-planet-01");
    expect(planetClipId("obj:a/b")).toBe("planet-obj-a-b");
    expect(planetCloudMaskId("obj:a/b")).toBe("planet-cloud-obj-a-b");
  });

  it("never collides with the surface clip of the same planet", () => {
    expect(planetCloudMaskId("earth")).not.toBe(planetClipId("earth"));
  });
});
