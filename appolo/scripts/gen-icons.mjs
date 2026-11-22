#!/usr/bin/env node
/**
 * Generate the home-screen icon set from the app mark.
 *
 * Source of truth is the SVG in this file, not a checked-in master PNG, so the
 * set can be regenerated when the brand changes:
 *
 *   node scripts/gen-icons.mjs
 *
 * (sharp is a dependency of @appolo/db, so it is resolved from that package
 * rather than from this script's own location.)
 *
 * Output (apps/web/public/icons):
 *   icon-192.png, icon-512.png            purpose "any"
 *   icon-maskable-512.png                 purpose "maskable" (80% safe zone)
 *   apple-touch-icon.png                  180px, opaque, no transparency
 */
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromDb = createRequire(path.resolve(here, "..", "packages", "db", "package.json"));
const sharp = requireFromDb("sharp");
const outDir = path.resolve(here, "..", "apps", "web", "public", "icons");

const BG = "#07080A";
const BRAND = "#10B981";
const BRAND_DIM = "#0E8F66";

/**
 * A podium: three ascending bars, the middle one tall. Drawn to fill 100% of the
 * canvas, which is what the "any" icons want; the maskable variant is inset.
 */
function markSvg(inset = 0) {
  const size = 512;
  const inner = size - inset * 2;
  const bar = inner * 0.19;
  const gap = inner * 0.075;
  const base = inset + inner * 0.79;
  const heights = [0.34, 0.55, 0.44];
  const colors = [BRAND_DIM, BRAND, BRAND_DIM];
  const total = bar * 3 + gap * 2;
  const startX = inset + (inner - total) / 2;

  const bars = heights
    .map((height, index) => {
      const x = startX + index * (bar + gap);
      const y = base - inner * height;
      const r = bar * 0.22;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bar.toFixed(1)}" height="${(base - y).toFixed(1)}" rx="${r.toFixed(1)}" fill="${colors[index]}" />`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}" />
  ${bars}
  <circle cx="${inset + inner * 0.79}" cy="${inset + inner * 0.24}" r="${(inner * 0.035).toFixed(1)}" fill="${BRAND}" />
</svg>`;
}

await mkdir(outDir, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, inset: 0, alpha: true },
  { file: "icon-512.png", size: 512, inset: 0, alpha: true },
  { file: "icon-maskable-512.png", size: 512, inset: 51, alpha: false },
  { file: "apple-touch-icon.png", size: 180, inset: 8, alpha: false },
];

for (const target of targets) {
  const svg = Buffer.from(markSvg(target.inset));
  await sharp(svg)
    .resize(target.size, target.size)
    .flatten(target.alpha ? undefined : { background: BG })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, target.file));
  console.log(`wrote icons/${target.file} (${target.size}px)`);
}
