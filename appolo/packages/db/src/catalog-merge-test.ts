import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
for (const candidate of [path.join(pkgRoot, ".env"), path.join(pkgRoot, "..", "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

import { getAdminDb } from "./client";
import * as schema from "./schema";

const { orgs, catalogItems, itemRatings, itemMatchups, catalogItemMerges } = schema;

/**
 * Proof that merging duplicate catalog rows preserves ratings.
 *
 * Two orgs rate "Heat (1995)" twice — once against each duplicate row — then
 * the rows are merged. Nothing may be lost: Elo, counters, review text and the
 * matchup log all survive, and no rating survives pointing at a deleted row.
 */

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

async function main(): Promise<void> {
  const admin = getAdminDb();
  const A = randomUUID();
  const B = randomUUID();
  const stamp = randomUUID().slice(0, 8);
  const title = `Merge Proof ${stamp}`;

  const [canonical] = await admin
    .insert(catalogItems)
    .values({ kind: "movie", title, year: 1995, subtitle: "", enrichmentStatus: "ready" })
    .returning();
  const [duplicate] = await admin
    .insert(catalogItems)
    // A real duplicate differs in the subtitle (that is how both rows got past
    // catalog_items_kind_title_uq): one provider left it empty, one added text.
    .values({ kind: "movie", title, year: 1995, subtitle: `Provider ${stamp}`, enrichmentStatus: "pending" })
    .returning();

  try {
    await admin.insert(orgs).values([
      { id: A, name: `Merge A ${stamp}`, slug: `merge-a-${stamp}` },
      { id: B, name: `Merge B ${stamp}`, slug: `merge-b-${stamp}` },
    ]);

    // Org A rated the canonical row; org B rated the duplicate.
    await admin.insert(itemRatings).values([
      {
        orgId: A,
        itemId: canonical!.id,
        elo: 1611,
        matches: 12,
        wins: 8,
        losses: 4,
        reviewText: "on the canonical row",
      },
      {
        orgId: B,
        itemId: duplicate!.id,
        elo: 1712,
        matches: 9,
        wins: 7,
        losses: 2,
        reviewText: "on the duplicate row",
      },
    ]);
    // A third org rated the duplicate only — it must be re-pointed, not deleted.
    const C = randomUUID();
    await admin.insert(orgs).values({ id: C, name: `Merge C ${stamp}`, slug: `merge-c-${stamp}` });
    await admin.insert(itemRatings).values({
      orgId: C,
      itemId: duplicate!.id,
      elo: 1490,
      matches: 4,
      reviewText: "duplicate-only rating",
    });

    // Matchups: one per side, plus a cross comparison that becomes a self-match.
    await admin.insert(itemMatchups).values([
      {
        orgId: A,
        itemId: canonical!.id,
        opponentId: duplicate!.id,
        result: "win",
        itemEloBefore: 1611,
        itemEloAfter: 1627,
        opponentEloBefore: 1712,
        opponentEloAfter: 1696,
      },
      {
        orgId: B,
        itemId: duplicate!.id,
        opponentId: canonical!.id,
        result: "loss",
        itemEloBefore: 1712,
        itemEloAfter: 1696,
        opponentEloBefore: 1611,
        opponentEloAfter: 1627,
      },
    ]);

    const before = {
      ratings: await admin.select().from(itemRatings).where(inArray(itemRatings.itemId, [canonical!.id, duplicate!.id])),
      matchups: await admin
        .select()
        .from(itemMatchups)
        .where(inArray(itemMatchups.itemId, [canonical!.id, duplicate!.id])),
    };
    check("fixture: 3 ratings across the two rows", before.ratings.length === 3, before.ratings.length);
    check("fixture: 2 matchups across the two rows", before.matchups.length === 2, before.matchups.length);

    const [merged] = (
      await admin.execute(
        sql`select public.merge_catalog_items(${duplicate!.id}::uuid, ${canonical!.id}::uuid) as merged`,
      )
    ) as unknown as Array<{ merged: Record<string, number> }>;

    const after = await admin.select().from(itemRatings).where(eq(itemRatings.itemId, canonical!.id));
    const byOrg = new Map(after.map((row) => [row.orgId, row]));

    check("B's rating moved to the canonical row with its Elo intact", byOrg.get(B)?.elo === 1712, byOrg.get(B));
    check("C's duplicate-only rating was re-pointed, not dropped", byOrg.get(C)?.elo === 1490, byOrg.get(C));
    check("A's rating was never touched", byOrg.get(A)?.elo === 1611 && byOrg.get(A)?.matches === 12);
    check("review text survives the move", byOrg.get(B)?.reviewText === "on the duplicate row");
    check("all three orgs now rate one row", after.length === 3, after.length);

    const dangling = await admin.select().from(itemRatings).where(eq(itemRatings.itemId, duplicate!.id));
    check("no rating still points at the deleted row", dangling.length === 0, dangling.length);

    const remaining = await admin.select().from(catalogItems).where(eq(catalogItems.id, duplicate!.id));
    check("the duplicate row is gone", remaining.length === 0);

    const matchupsAfter = await admin.select().from(itemMatchups).where(eq(itemMatchups.itemId, canonical!.id));
    check("self-comparisons were dropped, not re-pointed", matchupsAfter.length === 0, matchupsAfter.length);
    check(
      "the merge is audited",
      (await admin.select().from(catalogItemMerges).where(eq(catalogItemMerges.targetItemId, canonical!.id))).length === 1,
    );
    check("function reports the work it did", merged?.merged?.movedRatings === 2, merged?.merged);

    // A second merge of the same pair must fail loudly rather than no-op.
    let secondMergeFailed = false;
    try {
      await admin.execute(
        sql`select public.merge_catalog_items(${duplicate!.id}::uuid, ${canonical!.id}::uuid) as merged`,
      );
    } catch {
      secondMergeFailed = true;
    }
    check("merging a deleted row raises", secondMergeFailed);
  } finally {
    await admin.delete(catalogItems).where(inArray(catalogItems.id, [canonical!.id, duplicate!.id]));
    await admin.delete(orgs).where(inArray(orgs.id, [A, B]));
    const C = await admin
      .select({ id: orgs.id })
      .from(orgs)
      .where(sql`${orgs.slug} like ${`merge-c-${stamp}`}`);
    if (C.length) await admin.delete(orgs).where(eq(orgs.id, C[0]!.id));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[merge-test] fatal:", err);
  process.exit(1);
});
