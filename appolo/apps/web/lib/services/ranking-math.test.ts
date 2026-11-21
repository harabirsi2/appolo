import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq } from "drizzle-orm";
import { getAdminDb, schema } from "@appolo/db";
import { getRankingModel, refreshRankingModel } from "./ranking-math";

// The test runs through @appolo/db's tsx binary, whose cwd is packages/db.
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

const { catalogItems, itemMatchups, orgs, rankingModels } = schema;
const admin = getAdminDb();

/**
 * A rebuild now reads inside one transaction, fits with no connection held and
 * writes in a second short transaction. That split must not change what lands
 * in `ranking_models`, and the count comparison in `getRankingModel` — the only
 * thing that heals a snapshot lost to a restart — must still see a lagging row.
 */
test("a rebuilt snapshot is written intact and the count check still heals it", async () => {
  const prefix = `Ranking refresh ${randomUUID().slice(0, 8)}`;
  const orgId = randomUUID();
  const itemIds: string[] = [];

  const matchup = (itemId: string, opponentId: string, result: string, outcome: string) => ({
    orgId,
    itemId,
    opponentId,
    result,
    outcome,
    itemEloBefore: 1500,
    itemEloAfter: 1500,
    opponentEloBefore: 1500,
    opponentEloAfter: 1500,
  });

  try {
    await admin.insert(orgs).values({ id: orgId, name: prefix, slug: orgId });

    const items = await admin
      .insert(catalogItems)
      .values([
        { kind: "movie", title: `${prefix} A`, subtitle: "Test" },
        { kind: "movie", title: `${prefix} B`, subtitle: "Test" },
        { kind: "movie", title: `${prefix} C`, subtitle: "Test" },
      ])
      .returning({ id: catalogItems.id });
    assert.equal(items.length, 3);
    itemIds.push(...items.map((item) => item.id));
    const [a, b, c] = items.map((item) => item.id) as [string, string, string];

    await admin
      .insert(itemMatchups)
      .values([
        matchup(a, b, "win", "a"),
        matchup(b, a, "loss", "b"),
        matchup(a, c, "win", "a"),
        matchup(c, a, "loss", "c"),
        matchup(b, c, "win", "a"),
        matchup(c, b, "loss", "b"),
      ]);

    const refreshed = await refreshRankingModel(orgId, "movie");
    assert.equal(refreshed.comparisons, 6, "the rebuild should count every durable matchup");
    assert.equal(refreshed.items.length, 3, "every compared item should be fitted");
    assert.ok(refreshed.converged, "three items with six comparisons should converge");
    assert.ok(refreshed.updatedAt, "the second transaction must stamp the row");

    const [stored] = await admin
      .select({ comparisons: rankingModels.comparisons, state: rankingModels.state })
      .from(rankingModels)
      .where(eq(rankingModels.orgId, orgId));
    assert.equal(stored?.comparisons, 6, "the snapshot row must carry the fitted comparison count");
    assert.ok(stored?.state, "the snapshot must carry the fitted state");

    // Heal 1: the row is gone, as after a reset that kept the matchup log.
    await admin.delete(rankingModels).where(eq(rankingModels.orgId, orgId));
    const healed = await getRankingModel(orgId, "movie");
    assert.equal(healed.comparisons, 6, "a missing snapshot must be rebuilt from the log");
    assert.equal(healed.items.length, 3);
    const [recreated] = await admin
      .select({ comparisons: rankingModels.comparisons })
      .from(rankingModels)
      .where(eq(rankingModels.orgId, orgId));
    assert.equal(recreated?.comparisons, 6, "the heal must persist a fresh row");

    // Heal 2: a vote landed after the fit, so the stored count lags the log.
    await admin.insert(itemMatchups).values(matchup(a, c, "win", "a"));
    const caughtUp = await getRankingModel(orgId, "movie");
    assert.equal(caughtUp.comparisons, 7, "a snapshot behind the durable log must be refitted");
  } finally {
    await admin.delete(orgs).where(eq(orgs.id, orgId));
    for (const itemId of itemIds) {
      await admin.delete(catalogItems).where(eq(catalogItems.id, itemId));
    }
  }
});
