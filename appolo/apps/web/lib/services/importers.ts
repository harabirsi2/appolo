import { eq, and } from "drizzle-orm";
import { getDb, withOrg, schema } from "@/lib/db";
import { DomainError } from "./errors";
import { mapCatalogItem, type CatalogItem } from "./catalog-item";

const { catalogItems, itemRatings, ratingEvents } = schema;

/** Parse a CSV into rows keyed by header. Handles quoted fields. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (current.trim() !== "" || lines.length === 0) lines.push(current);
      current = "";
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else {
      current += char;
    }
  }
  if (current.trim() !== "") lines.push(current);

  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]!).map((value) => value.trim().toLowerCase());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    if (cells.every((cell) => cell.trim() === "")) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (header) row[header] = (cells[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function get(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = row[name.toLowerCase()];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

function parseYear(value: string): number | null {
  const match = value.match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  return Number(match[0]);
}

function parseRating(value: string): number | null {
  const n = Number(value.replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function findOrCreateCatalogItem(
  _orgId: string,
  input: { kind: "movie" | "book" | "music"; title: string; subtitle: string; year: number | null },
): Promise<CatalogItem> {
  const db = getDb();
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new DomainError("INVALID_TITLE", "A title is required.", 400);
  const existing = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.kind, input.kind), eq(catalogItems.title, title)))
    .limit(1);
  const row = existing[0];
  if (row) return mapCatalogItem(row);

  const [inserted] = await db
    .insert(catalogItems)
    .values({
      kind: input.kind,
      title,
      subtitle: input.subtitle.trim().slice(0, 200) || (input.kind === "movie" ? "Film" : input.kind === "music" ? "Track" : "Book"),
      year: input.year,
      imageUrl: null,
      backdropUrl: null,
      description: null,
      links: {},
      genres: [],
      trailerUrl: null,
      tags: [],
      externalRef: null,
      externalId: null,
      source: null,
      metadata: {},
    })
    .returning();
  if (!inserted) throw new DomainError("CATALOG_FAILED", "Could not create a catalog item.", 500);
  return mapCatalogItem(inserted);
}

export interface ImportStats {
  imported: number;
  skipped: number;
  created: number;
  updated: number;
}

async function upsertRating(
  orgId: string,
  itemId: string,
  score: number,
): Promise<"created" | "updated"> {
  const clamped = Math.min(10, Math.max(0, score));
  const elo = Math.round(1200 + clamped * 60);
  const existing = await withOrg(orgId, (tx) =>
    tx.select({ id: itemRatings.id }).from(itemRatings).where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, itemId))).limit(1),
  );
  await withOrg(orgId, async (tx) => {
    await tx
      .insert(itemRatings)
      .values({ orgId, itemId, elo, manualScore: clamped.toFixed(1) })
      .onConflictDoUpdate({
        target: [itemRatings.orgId, itemRatings.itemId],
        set: { elo, manualScore: clamped.toFixed(1), updatedAt: new Date() },
      });
    await tx.insert(ratingEvents).values({
      orgId,
      itemId,
      kind: "manual",
      detail: `Imported: ${clamped.toFixed(1)}`,
    });
  });
  return existing.length > 0 ? "updated" : "created";
}

const MAX_ROWS = 5000;

export async function importLetterboxd(orgId: string, csv: string): Promise<ImportStats> {
  const rows = parseCsv(csv).slice(0, MAX_ROWS);
  const stats: ImportStats = { imported: 0, skipped: 0, created: 0, updated: 0 };
  for (const row of rows) {
    const title = get(row, "name", "title");
    if (!title) {
      stats.skipped++;
      continue;
    }
    const year = parseYear(get(row, "year"));
    const rating = parseRating(get(row, "rating"));
    if (rating === null) {
      stats.skipped++;
      continue;
    }
    const item = await findOrCreateCatalogItem(orgId, {
      kind: "movie",
      title,
      subtitle: "Film",
      year,
    });
    const score = rating * 2; // 0.5–5 → 0–10
    const outcome = await upsertRating(orgId, item.id, score);
    if (outcome === "created") stats.created++;
    else stats.updated++;
    stats.imported++;
  }
  return stats;
}

export async function importGoodreads(orgId: string, csv: string): Promise<ImportStats> {
  const rows = parseCsv(csv).slice(0, MAX_ROWS);
  const stats: ImportStats = { imported: 0, skipped: 0, created: 0, updated: 0 };
  for (const row of rows) {
    const title = get(row, "title");
    if (!title) { stats.skipped++; continue; }
    const author = get(row, "author");
    const year = parseYear(get(row, "original publication year", "year published"));
    const rating = parseRating(get(row, "my rating"));
    if (rating === null) { stats.skipped++; continue; }
    const item = await findOrCreateCatalogItem(orgId, { kind: "book", title: title, subtitle: author || "Book", year: year });
    const score = rating * 2;
    const outcome = await upsertRating(orgId, item.id, score);
    if (outcome === "created") stats.created++; else stats.updated++;
    stats.imported++;
  }
  return stats;
}

export async function importSpotifyTopTracks(orgId: string, accessToken: string): Promise<ImportStats> {
  const stats: ImportStats = { imported: 0, skipped: 0, created: 0, updated: 0 };
  const response = await fetch("https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term", {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new DomainError("SPOTIFY_FAILED", "Could not load your Spotify top tracks.", 502);
  const payload = (await response.json()) as {
    items?: Array<{
      name?: string;
      id?: string;
      artists?: Array<{ name?: string }>;
      album?: { name?: string; release_date?: string; images?: Array<{ url?: string }> };
    }>;
  };
  const items = payload.items ?? [];
  for (let index = 0; index < items.length; index++) {
    const track = items[index]!;
    const title = (track.name ?? "").trim();
    if (!title) {
      stats.skipped++;
      continue;
    }
    const artists = (track.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", ");
    const year = parseYear(track.album?.release_date ?? "");
    const imageUrl = track.album?.images?.[0]?.url ?? null;
    const catalogItem = await findOrCreateCatalogItem(orgId, {
      kind: "music",
      title,
      subtitle: artists || "Track",
      year,
    });
    // Store artwork on the catalog row when we have it.
    if (imageUrl) {
      await getDb().update(catalogItems).set({ imageUrl, backdropUrl: imageUrl }).where(eq(catalogItems.id, catalogItem.id));
    }
    const score = Math.max(6, 10 - index * 0.12);
    const outcome = await upsertRating(orgId, catalogItem.id, score);
    if (outcome === "created") stats.created++;
    else stats.updated++;
    stats.imported++;
  }
  return stats;
}
