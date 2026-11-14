#!/usr/bin/env node
/**
 * Fetch the cover art the automatic seed could not find.
 *
 * `pnpm db:seed` discovers covers from Open Library, TVmaze and Wikipedia. A
 * handful of titles have no data in those APIs (or resolve to the wrong
 * article), so they ended up with generated placeholder art. This script fills
 * that gap from an explicit, reviewed manifest: one public source per title,
 * downloaded once, normalised, and committed to `apps/web/public/covers/`.
 *
 * Rules:
 *  - Sources are public metadata/images only (Wikipedia/Wikimedia, TVmaze).
 *    Nothing is scraped from another rankings app.
 *  - Every download is validated by magic bytes and sharp before it is kept.
 *  - Files are normalised to 720×720 max. Wide logos are padded to a square on
 *    the card surface colour so tiles line up; posters keep their aspect ratio.
 *  - Provenance (provider, page, URL, licence note) is written to
 *    `scripts/covers-manifest.json` next to the images.
 *
 * Usage:
 *   node scripts/fetch-covers.mjs            # skip files that already exist
 *   node scripts/fetch-covers.mjs --force    # re-download everything
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COVERS_DIR = path.join(ROOT, "apps", "web", "public", "covers");
const MANIFEST_PATH = path.join(ROOT, "scripts", "covers-manifest.json");
const USER_AGENT = "AppoloSeed/1.0 (https://github.com/harabirsi2/appolo; dev@local)";
/** Matches `--color-surface-2` so padded logos sit on the same colour as the card. */
const PAD_BACKGROUND = "#17171a";

// sharp ships with @appolo/db (used by the seed), so resolve it from there
// instead of adding a second copy to the workspace root.
const requireFromDb = createRequire(path.join(ROOT, "packages", "db", "package.json"));
const sharp = requireFromDb("sharp");

/**
 * Titles the automatic seed could not resolve.
 *
 * `file` follows the seed's `${kind}-${slugify(title)}` convention so
 * `cachedCoverPath` picks the file up on the next seed run.
 */
const COVERS = [
  {
    kind: "movie",
    title: "Three Women",
    // The demo row is Robert Altman's 1977 film, whose actual title is "3 Women".
    file: "movie-three-women.jpg",
    provider: "Wikipedia (en)",
    page: "3 Women",
    url: "https://upload.wikimedia.org/wikipedia/en/9/96/3_Women_%281977%29.png",
    attribution: "Poster for 3 Women (1977). English Wikipedia, fair use for identification.",
  },
  {
    kind: "tv",
    title: "Money Heist",
    // English title "Money Heist" is the Spanish series "La Casa de Papel";
    // TVmaze's first hit for the English name is the Korean remake.
    file: "tv-money-heist.jpg",
    provider: "TVmaze",
    page: "La Casa de Papel",
    url: "https://static.tvmaze.com/uploads/images/original_untouched/376/940830.jpg",
    attribution: "La Casa de Papel (Money Heist) poster. TVmaze, used for identification.",
  },
  {
    kind: "book",
    title: "The Hour of the Star",
    file: "book-the-hour-of-the-star.jpg",
    provider: "Wikipedia (en)",
    page: "The Hour of the Star",
    url: "https://upload.wikimedia.org/wikipedia/en/8/87/The_hour_of_the_star.jpg",
    attribution: "Cover of The Hour of the Star by Clarice Lispector. English Wikipedia, fair use.",
  },
  {
    kind: "game",
    title: "Dwarf Fortress",
    file: "game-dwarf-fortress.jpg",
    provider: "Wikimedia Commons",
    page: "Dwarf Fortress",
    url: "https://upload.wikimedia.org/wikipedia/commons/c/c9/Dwarf_Fortress.svg",
    attribution: "Dwarf Fortress wordmark. Wikimedia Commons.",
  },
  {
    kind: "game",
    title: "Minecraft",
    file: "game-minecraft.jpg",
    provider: "Wikimedia Commons",
    page: "Minecraft",
    url: "https://upload.wikimedia.org/wikipedia/commons/1/14/Minecraft_Logo.png",
    attribution: "Minecraft logo. Wikimedia Commons.",
  },
  {
    kind: "game",
    title: "RimWorld",
    file: "game-rimworld.jpg",
    provider: "Wikipedia (en)",
    page: "RimWorld",
    url: "https://upload.wikimedia.org/wikipedia/en/a/a4/Rimworld_logo.png",
    attribution: "RimWorld logo. English Wikipedia, fair use for identification.",
  },
  {
    kind: "game",
    title: "Undertale",
    file: "game-undertale.jpg",
    provider: "Wikimedia Commons",
    page: "Undertale",
    url: "https://upload.wikimedia.org/wikipedia/commons/c/cd/Undertale_vector_logo_on_black_borders.svg",
    attribution: "Undertale wordmark. Wikimedia Commons.",
  },
];

/** Identify a downloaded file from its magic bytes; provider errors are HTML. */
function sniffImage(bytes) {
  if (bytes.length > 8 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG") return "png";
  if (
    bytes.length > 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  // Several wordmarks are SVG. Check the head of the file rather than trusting
  // the Content-Type, which is often generic.
  const head = bytes.toString("utf8", 0, 512).trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return "svg";
  return null;
}

async function download(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1000) throw new Error(`suspiciously small response (${bytes.length} bytes)`);
  const format = sniffImage(bytes);
  if (!format) throw new Error("response is not a JPEG, PNG, WebP, or SVG image");
  return { bytes, format };
}

/** Normalise to a 720 px box; wide logos are padded to a square tile. */
async function normalise(bytes, format) {
  // SVG has no intrinsic pixel size, so rasterise it at a generous density
  // before the resize instead of upscaling a 72 dpi default render.
  const image = format === "svg" ? sharp(bytes, { density: 384 }) : sharp(bytes);
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("could not read image dimensions");
  const aspect = meta.width / meta.height;
  const wide = aspect > 1.2;
  let pipeline = image.rotate();
  pipeline = wide
    ? pipeline.resize(720, 720, {
        fit: "contain",
        background: PAD_BACKGROUND,
        withoutEnlargement: false,
      })
    : pipeline.resize(720, 720, { fit: "inside", withoutEnlargement: true });
  const out = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  if (out.length < 1000) throw new Error("normalised image is empty");
  return { bytes: out, width: meta.width, height: meta.height, padded: wide };
}

async function main() {
  const force = process.argv.includes("--force");
  await mkdir(COVERS_DIR, { recursive: true });

  // Keep recorded dimensions/padding for files we skip.
  let previousCovers = [];
  try {
    const previous = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
    previousCovers = Array.isArray(previous?.covers) ? previous.covers : [];
  } catch {
    // First run: no manifest yet.
  }

  const manifest = [];
  let failures = 0;

  for (const cover of COVERS) {
    const target = path.join(COVERS_DIR, cover.file);
    if (!force && existsSync(target)) {
      const info = await stat(target);
      const previous = previousCovers.find((entry) => entry.file === cover.file && entry.url === cover.url);
      console.log(`skip    ${cover.file} (already present)`);
      manifest.push({
        ...cover,
        bytes: info.size,
        source: previous?.source ?? null,
      });
      continue;
    }
    try {
      const { bytes, format } = await download(cover.url);
      const normalised = await normalise(bytes, format);
      await writeFile(target, normalised.bytes);
      console.log(
        `fetched ${cover.file} — ${normalised.width}×${normalised.height}` +
          `${normalised.padded ? " (padded)" : ""}, ${normalised.bytes.length} bytes`,
      );
      manifest.push({
        ...cover,
        bytes: normalised.bytes.length,
        source: {
          format: "jpeg",
          width: normalised.width,
          height: normalised.height,
          padded: normalised.padded,
        },
      });
    } catch (error) {
      failures += 1;
      console.error(`FAILED  ${cover.file}: ${error.message}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} cover(s) failed; the existing files were left untouched.`);
    process.exitCode = 1;
    return;
  }

  await writeFile(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        description:
          "Provenance for covers added by scripts/fetch-covers.mjs. Sources are public image APIs, not another app.",
        generatedBy: "scripts/fetch-covers.mjs",
        covers: manifest,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\nwrote ${path.relative(ROOT, MANIFEST_PATH)}`);
}

await main();