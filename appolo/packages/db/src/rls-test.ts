import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
for (const candidate of [path.join(pkgRoot, ".env"), path.join(pkgRoot, "..", "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

import { getDb, withOrg, getAdminDb } from "./client";
import { assertAppDatabaseEnforcesRls } from "./rls-guard";
import * as schema from "./schema";
const {
  orgs,
  locations,
  contacts,
  catalogItems,
  itemRatings,
  pods,
  reviews,
  reviewPlatforms,
  socialNotifications,
  itemMatchups,
  rankingModels,
} = schema;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}`);
  }
}

async function main(): Promise<void> {
  // The guard is the point of this suite: a role that bypasses RLS would make
  // every check below pass trivially, so refuse to run instead of skipping.
  try {
    const status = await assertAppDatabaseEnforcesRls();
    check(`app role "${status.currentUser}" cannot bypass row-level security`, true);
  } catch (error) {
    check(`app role enforces row-level security: ${error instanceof Error ? error.message : String(error)}`, false);
    console.log("---");
    console.log(`RESULT: pass=${pass} fail=${fail}`);
    process.exit(1);
  }

  const admin = getAdminDb();
  const A = randomUUID();
  const B = randomUUID();
  const stamp = randomUUID().slice(0, 8);
  const itemId = randomUUID();
  // A second title so the matchup fixture can be a real pair (item <> opponent).
  const opponentId = randomUUID();
  let bPrivatePodId = "";
  let bPublicPodId = "";
  let bMatchupId = "";
  let bModelId = "";

  try {
    await admin.insert(catalogItems).values([
      {
        id: itemId,
        kind: "movie",
        title: `Isolation fixture ${stamp}`,
        subtitle: "rls-test",
        year: 2020,
      },
      {
        id: opponentId,
        kind: "movie",
        title: `Isolation fixture opponent ${stamp}`,
        subtitle: "rls-test",
        year: 2021,
      },
    ]);
    await withOrg(A, async (tx) => {
      await tx.insert(orgs).values({ id: A, name: `Org A ${stamp}`, slug: `org-a-${stamp}` });
      await tx.insert(locations).values({ orgId: A, name: "A Main", timezone: "UTC" });
      await tx.insert(contacts).values({ orgId: A, name: "A Contact", source: "test" });
    });
    await withOrg(B, async (tx) => {
      await tx.insert(orgs).values({ id: B, name: `Org B ${stamp}`, slug: `org-b-${stamp}` });
      const [bLocation] = await tx
        .insert(locations)
        .values({ orgId: B, name: "B Main", timezone: "UTC" })
        .returning();
      await tx.insert(contacts).values({ orgId: B, name: "B Contact", source: "test" });
      const [bPlatform] = await tx
        .insert(reviewPlatforms)
        .values({ orgId: B, kind: "google", displayName: "Google" })
        .returning();
      await tx.insert(itemRatings).values({
        orgId: B,
        itemId,
        elo: 1700,
        matches: 1,
        wins: 1,
        reviewText: "Org B private review",
      });
      const [bPrivatePod] = await tx
        .insert(pods)
        .values({
          orgId: B,
          title: "Org B private pod",
          slug: `org-b-private-${stamp}`,
          visibility: "private",
        })
        .returning();
      bPrivatePodId = bPrivatePod!.id;
      // Public pods are intentionally world-readable (sql/0011_collab_pods.sql)
      // so people can add titles to someone else's public pod. Everything else
      // on a pod stays tenant-scoped.
      const [bPublicPod] = await tx
        .insert(pods)
        .values({
          orgId: B,
          title: "Org B public pod",
          slug: `org-b-public-${stamp}`,
          visibility: "public",
        })
        .returning();
      bPublicPodId = bPublicPod!.id;
      await tx.insert(socialNotifications).values({
        orgId: B,
        kind: "follow",
        body: "Org B private notification",
      });
      await tx.insert(reviews).values({
        orgId: B,
        locationId: bLocation!.id,
        platformId: bPlatform!.id,
        externalId: `rls-${stamp}`,
        authorName: "B Reviewer",
        rating: 5,
        body: "Org B private review",
        reviewedAt: new Date(),
      });
      // The comparison log and the fitted model are the ranking pipeline's own
      // tables and were never probed: reading either across tenants would leak
      // who someone compared and how strongly the model believes it.
      const [bMatchup] = await tx
        .insert(itemMatchups)
        .values({
          orgId: B,
          itemId,
          opponentId,
          result: "win",
          outcome: "a",
          itemEloBefore: 1500,
          itemEloAfter: 1516,
          opponentEloBefore: 1500,
          opponentEloAfter: 1484,
        })
        .returning();
      bMatchupId = bMatchup!.id;
      const [bModel] = await tx
        .insert(rankingModels)
        .values({ orgId: B, kind: "movie", state: { items: [] }, comparisons: 1 })
        .returning();
      bModelId = bModel!.id;
    });

    const aLocations = await withOrg(A, (tx) => tx.select().from(locations));
    check("org A sees only its own location", aLocations.length === 1 && aLocations[0]!.orgId === A);

    const bLocations = await withOrg(B, (tx) => tx.select().from(locations));
    check("org B sees only its own location", bLocations.length === 1 && bLocations[0]!.orgId === B);

    const crossRead = await withOrg(A, (tx) =>
      tx.select().from(locations).where(eq(locations.id, bLocations[0]!.id)),
    );
    check("cross-org read by id returns nothing", crossRead.length === 0);

    const aContacts = await withOrg(A, (tx) => tx.select().from(contacts));
    check("contacts are isolated per org", aContacts.length === 1 && aContacts[0]!.name === "A Contact");

    let writeBlocked = false;
    try {
      await withOrg(A, (tx) => tx.insert(locations).values({ orgId: B, name: "Smuggled", timezone: "UTC" }));
    } catch {
      writeBlocked = true;
    }
    check("cross-org insert is rejected by WITH CHECK", writeBlocked);

    let orgsVisible = 0;
    await withOrg(A, async (tx) => {
      const all = await tx.select().from(orgs);
      orgsVisible = all.length;
    });
    check("orgs table is scoped to the active org", orgsVisible === 1);

    // No org context at all -> no tenant rows.
    const noContext = await getDb().select().from(locations).where(eq(locations.orgId, A));
    check("no org context yields no rows", noContext.length === 0);

    // The four social surfaces the product reads on every screen. Each is
    // queried through withOrg(), the same wrapper the services use.
    const crossTenant = await withOrg(A, async (tx) => ({
      ratings: await tx.select().from(itemRatings).where(eq(itemRatings.orgId, B)),
      notifications: await tx.select().from(socialNotifications).where(eq(socialNotifications.orgId, B)),
      reviews: await tx.select().from(reviews).where(eq(reviews.orgId, B)),
    }));
    check("org A cannot read org B's ratings", crossTenant.ratings.length === 0);
    check("org A cannot read org B's written reviews", crossTenant.ratings.every((row) => !row.reviewText));
    const crossPrivatePod = await withOrg(A, (tx) =>
      tx.select().from(pods).where(eq(pods.id, bPrivatePodId)),
    );
    check("org A cannot read org B's private pods", crossPrivatePod.length === 0);
    const crossPublicPod = await withOrg(A, (tx) =>
      tx.select().from(pods).where(eq(pods.id, bPublicPodId)),
    );
    check(
      "public pods stay readable by design, the documented cross-org exception",
      crossPublicPod.length === 1,
    );
    check("org A cannot read org B's notifications", crossTenant.notifications.length === 0);
    check("org A cannot read org B's reviews", crossTenant.reviews.length === 0);

    // --- the two ranking-pipeline tables, cross-tenant ---
    const crossRanking = await withOrg(A, async (tx) => ({
      matchups: await tx.select().from(itemMatchups).where(eq(itemMatchups.orgId, B)),
      models: await tx.select().from(rankingModels).where(eq(rankingModels.orgId, B)),
    }));
    check("org A cannot read org B's comparison log", crossRanking.matchups.length === 0);
    check("org A cannot read org B's fitted ranking model", crossRanking.models.length === 0);

    const matchupById = await withOrg(A, (tx) =>
      tx.select().from(itemMatchups).where(eq(itemMatchups.id, bMatchupId)),
    );
    check("cross-org matchup read by id returns nothing", matchupById.length === 0);
    const modelById = await withOrg(A, (tx) =>
      tx.select().from(rankingModels).where(eq(rankingModels.id, bModelId)),
    );
    check("cross-org ranking model read by id returns nothing", modelById.length === 0);

    // RLS must also refuse a write that names another tenant, not just hide reads.
    let crossWriteBlocked = false;
    try {
      await withOrg(A, (tx) =>
        tx.insert(rankingModels).values({ orgId: B, kind: "tv", state: { items: [] }, comparisons: 0 }),
      );
    } catch {
      crossWriteBlocked = true;
    }
    check("org A cannot write a ranking model for org B", crossWriteBlocked);

    const ownRanking = await withOrg(B, async (tx) => ({
      matchups: await tx.select().from(itemMatchups).where(eq(itemMatchups.orgId, B)),
      models: await tx.select().from(rankingModels).where(eq(rankingModels.orgId, B)),
    }));
    check(
      "org B still reads its own comparison log and model",
      ownRanking.matchups.length === 1 && ownRanking.models.length === 1,
    );

    const ownTenant = await withOrg(B, async (tx) => ({
      ratings: await tx.select().from(itemRatings).where(eq(itemRatings.orgId, B)),
      pods: await tx.select().from(pods).where(eq(pods.orgId, B)),
      notifications: await tx.select().from(socialNotifications).where(eq(socialNotifications.orgId, B)),
      reviews: await tx.select().from(reviews).where(eq(reviews.orgId, B)),
    }));
    check(
      "org B still sees its own ratings, pods, notifications and reviews",
      ownTenant.ratings.length === 1 &&
        ownTenant.pods.length === 2 &&
        ownTenant.notifications.length === 1 &&
        ownTenant.reviews.length === 1,
    );

    const crossByRatingId = await withOrg(A, (tx) =>
      tx.select().from(itemRatings).where(eq(itemRatings.id, ownTenant.ratings[0]!.id)),
    );
    check("cross-org rating read by id returns nothing", crossByRatingId.length === 0);
  } finally {
    await admin.delete(orgs).where(inArray(orgs.id, [A, B]));
    await admin.delete(catalogItems).where(inArray(catalogItems.id, [itemId, opponentId]));
  }

  console.log("---");
  console.log(`RESULT: pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("rls-test failed:", err);
  process.exit(1);
});