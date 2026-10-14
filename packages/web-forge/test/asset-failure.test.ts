import { describe, expect, it } from "vitest";
import { assetPathOf, describeAssetFailure } from "../src/ui/asset-failure.js";

/**
 * What the ship preview says when a mesh will not load.
 *
 * This exists because a missing `.glb` used to blank the editor: `useGLTF`
 * throws, `<Suspense>` catches suspensions rather than throws, and nothing
 * stopped the unmount. The boundary is the fix; the message is what makes
 * the fix useful, and the one thing an author needs from a three.js error
 * is which file to go and produce.
 */
describe("describeAssetFailure", () => {
  const url = "http://host/forge/assets/ee-ships/galactica.glb";

  it("names the file, as a path under assets/", () => {
    expect(assetPathOf(url)).toBe("ee-ships/galactica.glb");
    // A URL from somewhere unexpected is passed through rather than
    // mangled — a wrong path in the message would be worse than a long one.
    expect(assetPathOf("blob:whatever")).toBe("blob:whatever");
  });

  it("calls a 404 what it is: the manifest promised a file the repo lacks", () => {
    const message = describeAssetFailure(
      new Error('fetch for "http://host/forge/assets/ee-ships/galactica.glb" responded with 404: Not Found'),
      url,
    );
    expect(message).toContain("assets/ee-ships/galactica.glb");
    expect(message).toContain("missing");
    expect(message).toContain("manifest");
  });

  it("keeps another HTTP status verbatim — it is not a content gap", () => {
    const message = describeAssetFailure(new Error("responded with 500: Internal Error"), url);
    expect(message).toContain("could not be fetched");
    expect(message).toContain("500");
  });

  it("distinguishes a file that is there but is not glTF", () => {
    const message = describeAssetFailure(new Error("Unexpected token < in JSON"), url);
    expect(message).toContain("could not be read as glTF");
    expect(message).not.toContain("missing");
  });

  it("survives a thrown non-Error, which loaders do produce", () => {
    expect(describeAssetFailure("boom", url)).toContain("assets/ee-ships/galactica.glb");
    expect(describeAssetFailure(undefined, url)).toContain("assets/ee-ships/galactica.glb");
  });
});

describe("the path an author is told about", () => {
  it("leaves out the engine and cache parameters of the URL", () => {
    expect(assetPathOf("forge-app://x/forge/assets/ee-ships/a.glb?target=EE-2026.09.22PR&v=3")).toBe("ee-ships/a.glb");
  });
});
