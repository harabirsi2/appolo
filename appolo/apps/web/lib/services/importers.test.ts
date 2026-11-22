import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq, like, sql } from "drizzle-orm";
import { getAdminDb, withOrg, schema } from "@appolo/db";
import { importGoodreads, importSpotifyTopTracks, parseCsv } from "./importers";
import { rankedRatings, setManualRating, watchlistFor } from "./rankings";
import { ensureProfile, getProfileByOrgId, recordSpotifyConnection } from "./social";

// The test runs through @appolo/db's tsx binary, whose cwd is packages/db.
// Load the repository .env before any database client is created.
const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL || !process.env.MIGRATE_DATABASE_URL) {
  for (const candidate of [
    path.resolve(here, "../../../../.env"),
    path.resolve(process.cwd(), ".env"),
  ]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      break;
    }
  }
}

const { catalogItems, itemRatings, orgs, ratingEvents } = schema;
const admin = getAdminDb();

async function createOrg(): Promise<string> {
  const orgId = randomUUID();
  await admin.insert(orgs).values({
    id: orgId,
    name: `Import integrity ${orgId.slice(0, 8)}`,
    slug: `import-integrity-${orgId}`,
  });
  return orgId;
}

async function cleanup(orgId: string, prefix: string): Promise<void> {
  await admin.delete(orgs).where(eq(orgs.id, orgId));
  await admin.delete(catalogItems).where(like(catalogItems.title, `${prefix}%`));
}

function spotifyFetch(tracks: Array<{ title: string; artist: string }>): void {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        items: tracks.map((track) => ({
          name: track.title,
          artists: [{ name: track.artist }],
          album: {
            name: "Import test album",
            release_date: "2024-01-01",
            images: [{ url: "https://example.com/cover.jpg" }],
          },
        })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
}

test("Spotify top tracks are saved unrated and never become rankings", async () => {
  const orgId = await createOrg();
  const prefix = `Integrity track ${orgId.slice(0, 8)}`;
  const originalFetch = globalThis.fetch;
  try {
    spotifyFetch([
      { title: `${prefix} One`, artist: "Test Artist" },
      { title: `${prefix} Two`, artist: "Test Artist" },
    ]);

    const stats = await importSpotifyTopTracks(orgId, "test-token");

    assert.equal(stats.imported, 2);
    assert.equal(stats.unrated, 2);
    assert.equal(stats.created, 2, "both tracks should be newly watchlisted");

    const ratings = await withOrg(orgId, (tx) =>
      tx.select().from(itemRatings).where(eq(itemRatings.orgId, orgId)),
    );
    assert.equal(ratings.length, 0, "Spotify listening order must not create ratings");

    const events = await withOrg(orgId, (tx) =>
      tx.select().from(ratingEvents).where(eq(ratingEvents.orgId, orgId)),
    );
    assert.equal(events.length, 0, "an unrated import must not write rating history");

    const saved = await watchlistFor(orgId);
    assert.equal(saved.length, 2, "tracks should still be available on the watchlist");
    assert.ok(saved.every((item) => item.kind === "music"));
    assert.equal((await rankedRatings(orgId)).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup(orgId, prefix);
  }
});

test("an explicit score on an imported track still ranks normally", async () => {
  const orgId = await createOrg();
  const prefix = `Integrity explicit ${orgId.slice(0, 8)}`;
  const originalFetch = globalThis.fetch;
  try {
    spotifyFetch([{ title: `${prefix} Track`, artist: "Test Artist" }]);
    await importSpotifyTopTracks(orgId, "test-token");

    const [item] = await admin
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(eq(catalogItems.title, `${prefix} Track`))
      .limit(1);
    assert.ok(item, "the imported track should exist in the catalog");

    const rated = await setManualRating(orgId, item.id, 9);
    assert.equal(rated.score, 9);

    const rankings = await rankedRatings(orgId);
    assert.equal(rankings.length, 1);
    assert.equal(rankings[0]!.id, item.id);
    assert.equal(rankings[0]!.score, 9);

    const [saved] = await withOrg(orgId, (tx) =>
      tx.select().from(itemRatings).where(eq(itemRatings.itemId, item.id)),
    );
    assert.equal(saved?.source, "user", "an explicit score must be attributed to the user");
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup(orgId, prefix);
  }
});

test("legacy import candidates are identified without deleting or hiding the row", async () => {
  const orgId = await createOrg();
  const prefix = `Integrity legacy ${orgId.slice(0, 8)}`;
  try {
    const [item] = await admin
      .insert(catalogItems)
      .values({ kind: "music", title: `${prefix} Track`, subtitle: "Test Artist" })
      .returning({ id: catalogItems.id });
    assert.ok(item);

    await admin.insert(itemRatings).values({
      orgId,
      itemId: item.id,
      elo: 1800,
      manualScore: "10.0",
      source: null,
    });
    await admin.insert(ratingEvents).values({
      orgId,
      itemId: item.id,
      kind: "manual",
      detail: "Imported: 10.0",
    });

    const candidates = await withOrg(orgId, (tx) =>
      tx.execute(sql`select rating_id from legacy_spotify_import_candidates where org_id = ${orgId}`),
    );
    assert.equal(candidates.length, 1, "the old Spotify row should be visible to its owner");

    const kept = await admin
      .select({ id: itemRatings.id })
      .from(itemRatings)
      .where(eq(itemRatings.itemId, item.id));
    assert.equal(kept.length, 1, "candidate detection must not delete the rating");

    const rankings = await rankedRatings(orgId);
    assert.equal(rankings.length, 1, "legacy data remains usable until it is explicitly re-rated");
  } finally {
    await cleanup(orgId, prefix);
  }
});

test("Spotify connection state comes from the OAuth record path", async () => {
  const orgId = await createOrg();
  try {
    const profile = await ensureProfile(
      orgId,
      `Import OAuth ${orgId.slice(0, 8)}`,
      `import-oauth-${orgId.slice(0, 8)}`,
    );
    assert.equal(profile.spotifyConnected, false, "a new profile is not connected");

    await recordSpotifyConnection(orgId);

    const updated = await getProfileByOrgId(orgId);
    assert.equal(updated?.spotifyConnected, true);
  } finally {
    await admin.delete(orgs).where(eq(orgs.id, orgId));
  }
});

test("CSV imports record provenance for their explicit ratings", async () => {
  const orgId = await createOrg();
  const prefix = `Integrity book ${orgId.slice(0, 8)}`;
  try {
    const stats = await importGoodreads(
      orgId,
      `Title,Author,My Rating\n${prefix},Test Author,4\n`,
    );
    assert.equal(stats.imported, 1);

    const [item] = await admin
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(eq(catalogItems.title, prefix))
      .limit(1);
    assert.ok(item);

    const [saved] = await withOrg(orgId, (tx) =>
      tx.select().from(itemRatings).where(eq(itemRatings.itemId, item.id)),
    );
    assert.equal(saved?.source, "goodreads");
    assert.equal((await rankedRatings(orgId)).length, 1);
  } finally {
    await cleanup(orgId, prefix);
  }
});

test("parses simple csv rows keyed by lowercased headers", () => {
  const rows = parseCsv("Name,Year\nAlien,1979\nArrival,2016");
  assert.deepEqual(rows, [
    { name: "Alien", year: "1979" },
    { name: "Arrival", year: "2016" },
  ]);
});

test("keeps commas inside quoted cells", () => {
  const rows = parseCsv('Title,Note\n"Requiem, for a Dream","two, commas"');
  assert.equal(rows[0]?.title, "Requiem, for a Dream");
  assert.equal(rows[0]?.note, "two, commas");
});

test("unescapes doubled quotes and handles crlf line endings", () => {
  const rows = parseCsv('Quote\r\n"He said ""hello"" there"\r\n');
  assert.equal(rows[0]?.quote, 'He said "hello" there');
});

