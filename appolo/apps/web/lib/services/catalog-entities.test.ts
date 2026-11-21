import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq, like, sql } from "drizzle-orm";
import { getAdminDb, schema } from "@appolo/db";
import { materializeEntities, seasonsFromDetails } from "./catalog-entities";

const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  for (const candidate of [path.resolve(here, "../../../../.env"), path.resolve(process.cwd(), ".env")]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      break;
    }
  }
}

const { catalogItems, artists, seasons, episodes, itemArtists, itemRatings, orgs } = schema;
const admin = getAdminDb();

const stamp = randomUUID().slice(0, 8);
const prefix = `Entity Proof ${stamp}`;

async function cleanup(): Promise<void> {
  await admin.delete(catalogItems).where(like(catalogItems.title, `%${prefix}%`));
  await admin.delete(orgs).where(like(orgs.slug, `entity-proof-${stamp}%`));
}

test("seasonsFromDetails prefers the provider list and falls back to a count", () => {
  const fromList = seasonsFromDetails({
    metadata: {
      seasonList: [
        { seasonNumber: 1, name: "Season One", year: 2020, imageUrl: "https://example.test/s1.jpg" },
        { seasonNumber: 0, name: "Specials" },
        { seasonNumber: 2, name: null, year: 2022 },
      ],
    },
  });
  assert.deepEqual(
    fromList.map((season) => season.seasonNumber),
    [1, 2],
    "season 0 (specials) is skipped",
  );

  const fromCount = seasonsFromDetails({ metadata: { seasons: 3 } });
  assert.deepEqual(
    fromCount.map((season) => season.seasonNumber),
    [1, 2, 3],
  );

  assert.equal(seasonsFromDetails({ metadata: {} }).length, 0);
});

test("materialising an item creates rateable artist, season and episode rows", async () => {
  const [parent] = await admin
    .insert(catalogItems)
    .values({ kind: "tv", title: `${prefix} Series`, subtitle: "", year: 2019 })
    .returning({ id: catalogItems.id });

  try {
    const result = await materializeEntities(admin, {
      itemId: parent!.id,
      kind: "tv",
      title: `${prefix} Series`,
      year: 2019,
      source: "tmdb",
      details: {
        credits: [
          { name: `${prefix} Director`, slug: `entity-director-${stamp}`, role: "director", character: null },
          { name: `${prefix} Actor`, slug: `entity-actor-${stamp}`, role: "actor", character: "Hero" },
        ],
        metadata: {
          seasonList: [
            { seasonNumber: 1, name: "Season One", year: 2019, imageUrl: null },
            { seasonNumber: 2, name: null, year: 2021, imageUrl: null },
          ],
        },
        episodes: [{ seasonNumber: 1, episodeNumber: 1, title: "Pilot" }],
      },
    });

    assert.deepEqual(result, { artists: 2, seasons: 2, episodes: 1 });

    const artistRows = await admin
      .select({ name: artists.name, catalogItemId: artists.catalogItemId })
      .from(artists)
      .where(like(artists.name, `${prefix}%`));
    assert.equal(artistRows.length, 2);

    const credits = await admin
      .select({ role: itemArtists.role })
      .from(itemArtists)
      .where(eq(itemArtists.itemId, parent!.id));
    assert.deepEqual(credits.map((row) => row.role).sort(), ["featured", "primary"]);

    const seasonRows = await admin
      .select({ seasonNumber: seasons.seasonNumber, catalogItemId: seasons.catalogItemId })
      .from(seasons)
      .where(eq(seasons.parentItemId, parent!.id));
    assert.deepEqual(seasonRows.map((row) => row.seasonNumber).sort(), [1, 2]);

    // Season titles carry the show name, because "Season 1" is not unique.
    const seasonItems = await admin
      .select({ title: catalogItems.title, entityType: catalogItems.entityType })
      .from(catalogItems)
      .where(like(catalogItems.title, `${prefix} Series — %`));
    assert.equal(seasonItems.length, 3, "two seasons and one episode");
    assert.ok(seasonItems.every((row) => row.entityType === "season" || row.entityType === "episode"));

    const episodeRows = await admin
      .select({ episodeNumber: episodes.episodeNumber, seasonId: episodes.seasonId })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(eq(seasons.parentItemId, parent!.id));
    assert.equal(episodeRows.length, 1);
    assert.equal(episodeRows[0]!.episodeNumber, 1);

    // The whole point: these rows can be rated through the existing tables.
    const orgId = randomUUID();
    await admin.insert(orgs).values({ id: orgId, name: `${prefix} Org`, slug: `entity-proof-${stamp}` });
    await admin.insert(itemRatings).values([
      { orgId, itemId: artistRows[0]!.catalogItemId, elo: 1600 },
      { orgId, itemId: seasonRows[0]!.catalogItemId, elo: 1590 },
    ]);
    const rated = await admin
      .select({ id: itemRatings.id })
      .from(itemRatings)
      .where(eq(itemRatings.orgId, orgId));
    assert.equal(rated.length, 2);

    const view = await admin.execute(sql`
      select entity_type from public.rateable_entities
       where id in (${artistRows[0]!.catalogItemId}, ${seasonRows[0]!.catalogItemId})`);
    const types = (view as unknown as Array<{ entity_type: string }>).map((row) => row.entity_type).sort();
    assert.deepEqual(types, ["artist", "season"]);

    // A second pass adds nothing.
    const again = await materializeEntities(admin, {
      itemId: parent!.id,
      kind: "tv",
      title: `${prefix} Series`,
      year: 2019,
      source: "tmdb",
      details: {
        credits: [
          { name: `${prefix} Director`, slug: `entity-director-${stamp}`, role: "director", character: null },
          { name: `${prefix} Actor`, slug: `entity-actor-${stamp}`, role: "actor", character: "Hero" },
        ],
        metadata: {
          seasonList: [
            { seasonNumber: 1, name: "Season One", year: 2019, imageUrl: null },
            { seasonNumber: 2, name: null, year: 2021, imageUrl: null },
          ],
        },
        episodes: [{ seasonNumber: 1, episodeNumber: 1, title: "Pilot" }],
      },
    });
    assert.deepEqual(again, { artists: 0, seasons: 0, episodes: 0 });
  } finally {
    await cleanup();
  }
});
