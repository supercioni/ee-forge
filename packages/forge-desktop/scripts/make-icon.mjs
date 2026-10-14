#!/usr/bin/env node
/**
 * Draws the EE FORGE icon from scratch (no third-party artwork, so no provenance question) and writes
 * build/icon.png (512 px) and build/icon.ico (16–256 px, PNG-compressed entries).
 *
 * Deterministic: the same script always writes the same bytes. Pure Node — a tiny anti-aliased rasteriser over
 * signed-distance shapes, a PNG encoder on zlib, an ICO container.
 *
 * The mark: a dark rounded square, an amber ring (the forge's crucible / a radar sweep) and a white "F" whose
 * upper bar ends in a spark.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "build");

// --- signed distances (unit square, 0..1) ---
const roundedBox = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const box = (x, y, x0, y0, x1, y1) => roundedBox(x, y, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0.012);
const ring = (x, y, cx, cy, radius, half) => Math.abs(Math.hypot(x - cx, y - cy) - radius) - half;
const disc = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Colour of the scene at (x, y) as [r, g, b, a] in 0..1. */
function scene(x, y) {
  let color = [0, 0, 0, 0];
  const over = (c, cover) => {
    const a = c[3] * cover;
    const base = color;
    const outA = a + base[3] * (1 - a);
    color = outA === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (c[i] * a + base[i] * base[3] * (1 - a)) / outA).concat(outA);
  };
  const cov = (d) => Math.min(1, Math.max(0, 0.5 - d * SCALE));
  // body
  const body = roundedBox(x, y, 0.5, 0.5, 0.47, 0.47, 0.18);
  over(mix([0.055, 0.09, 0.15, 1], [0.1, 0.16, 0.26, 1], y), cov(body));
  // ring
  over([0.96, 0.62, 0.12, 1], cov(ring(x, y, 0.5, 0.5, 0.36, 0.028)));
  over([0.96, 0.62, 0.12, 0.35], cov(ring(x, y, 0.5, 0.5, 0.29, 0.008)));
  // F: stem, upper bar, middle bar
  const f = Math.min(box(x, y, 0.36, 0.27, 0.46, 0.73), box(x, y, 0.36, 0.27, 0.66, 0.37), box(x, y, 0.36, 0.45, 0.6, 0.54));
  over([0.97, 0.98, 1, 1], cov(f));
  // spark at the end of the upper bar
  over([1, 0.78, 0.3, 1], cov(disc(x, y, 0.7, 0.32, 0.035)));
  return color;
}
let SCALE = 512;

function render(size) {
  SCALE = size;
  const n = 4; // 4x4 samples per pixel
  const data = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < n; sy += 1) {
        for (let sx = 0; sx < n; sx += 1) {
          const c = scene((px + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const o = (py * size + px) * 4;
      const total = n * n;
      data[o] = a === 0 ? 0 : Math.round((r / a) * 255);
      data[o + 1] = a === 0 ? 0 : Math.round((g / a) * 255);
      data[o + 2] = a === 0 ? 0 : Math.round((b / a) * 255);
      data[o + 3] = Math.round((a / total) * 255);
    }
  }
  return data;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync(out, { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((s) => ({ size: s, bytes: png(s, render(s)) }));
writeFileSync(join(out, "icon.png"), png(512, render(512)));

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
const dir = Buffer.alloc(16 * images.length);
let offset = 6 + dir.length;
images.forEach((image, i) => {
  const o = i * 16;
  dir[o] = image.size === 256 ? 0 : image.size;
  dir[o + 1] = image.size === 256 ? 0 : image.size;
  dir.writeUInt16LE(1, o + 4); // planes
  dir.writeUInt16LE(32, o + 6); // bits per pixel
  dir.writeUInt32LE(image.bytes.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += image.bytes.length;
});
writeFileSync(join(out, "icon.ico"), Buffer.concat([header, dir, ...images.map((i) => i.bytes)]));
console.log(`wrote ${join(out, "icon.png")} and ${join(out, "icon.ico")} (${sizes.join(", ")} px)`);
