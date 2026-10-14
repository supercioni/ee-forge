import { describe, expect, it } from "vitest";
import { formatPeriod } from "../src/ui/duration.js";

/**
 * The readout under the orbit field. It exists because an orbital period
 * in raw seconds is unreadable, so the interesting cases are the ones
 * where naive arithmetic would print something a person cannot trust.
 */
describe("formatPeriod", () => {
  it("says a whole hour as a clock reading", () => {
    expect(formatPeriod(3600)).toBe("1h 00m");
  });

  it("keeps the fraction on the pathological short periods", () => {
    // 1.3 is a real value from this repo's own bench, authored when the
    // field was believed to be a rate. Tidying it to "1s" would hide the
    // very thing the readout is there to expose.
    expect(formatPeriod(1.3)).toBe("1.3s");
    expect(formatPeriod(3)).toBe("3s");
  });

  it("drops a zero seconds column but keeps a padded one", () => {
    expect(formatPeriod(600)).toBe("10m");
    expect(formatPeriod(305)).toBe("5m 05s");
  });

  it("never carries a rounded column past its base", () => {
    // The naive version prints "1h 60m" and "1m 60s".
    expect(formatPeriod(3599.9)).toBe("1h 00m");
    expect(formatPeriod(119.6)).toBe("2m");
  });

  it("names the direction of a negative period", () => {
    // EE runs it happily; the planet just goes round the other way.
    expect(formatPeriod(-1800)).toBe("30m, retrograde");
  });

  it("has nothing to say about a period EE cannot use", () => {
    expect(formatPeriod(0)).toBe("—");
    expect(formatPeriod(Number.NaN)).toBe("—");
  });
});
