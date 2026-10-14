import { describe, expect, it } from "vitest";
import css from "../src/index.css?raw";

/**
 * The colours the stylesheet actually declares, checked against WCAG AA (4.5:1 for text). Read from index.css so
 * a token changed there is caught here — GUI-1 found secondary text at 3.55:1 on the selected-row blue.
 */
const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (m === null) throw new Error(`token --${name} not found`);
  return m[1] as string;
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("text contrast on the surfaces it sits on", () => {
  const surfaces = ["bg", "panel", "panel-2", "select", "select-strong"];
  for (const fg of ["text", "muted", "accent"]) {
    for (const bg of surfaces) {
      it(`--${fg} on --${bg} is at least 4.5:1`, () => {
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  for (const bg of ["bg", "panel", "panel-2"]) {
    it(`--danger-text on --${bg} is at least 4.5:1`, () => {
      expect(contrast(token("danger-text"), token(bg))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("no selected-row background is hard-coded outside the tokens", () => {
    expect(css).not.toMatch(/background:\s*#24405a/);
    expect(css).not.toMatch(/background:\s*#2d5273/);
  });
});
