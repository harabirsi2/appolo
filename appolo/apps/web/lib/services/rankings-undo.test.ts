import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getAdminDb, schema } from "@appolo/db";
import { submitVote, undoLastComparison } from "./rankings";

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

const { catalogItems, itemMatchups, itemRatings, orgs, ratingEvents } = schema;
const admin = getAdminDb();

async function createOrg(prefix: string): Promise<string> {
  const orgId = randomUUID();
  await admin.insert(orgs).values({ id: orgId, name: `${prefix} ${orgId.slice(0, 8)}`, slug: orgId });
  return orgId;
}

async function createItems(prefix: string, titles: string[]): Promise<string[]> {
  const rows = await admin
    .insert(catalogItems)
    .values(titles.map((title) => ({ kind: "movie" as const, title: `${prefix} ${title}`, subtitle: "Test" })))
    .returning({ id: catalogItems.id });
  return rows.map((row) => row.id);
}

async function ratingFor(orgId: string, itemId: string) {
  const [row] = await admin
    .select()
    .from(itemRatings)
    .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, itemId)))
    .limit(1);
  return row;
}

async function matchupsFor(orgId: string) {
  return admin.select().from(itemMatchups).where(eq(itemMatchups.orgId, orgId));
}

async function cleanup(orgIds: string[], itemIds: string[]): Promise<void> {
  for (const orgId of orgIds) await admin.delete(orgs).where(eq(orgs.id, orgId));
  for (const itemId of itemIds) await admin.delete(catalogItems).where(eq(catalogItems.id, itemId));
}

/**
 * The reported failure: vote(A vs B), vote(A vs C), then undo from B's side.
 * The old code took "the newest rated event for A" — which was A-vs-C — so it
 * deleted the wrong timeline entry and left A-vs-B orphaned, while also
 * restoring B's Elo from a row it had read without a lock.
 */
test("undoing from the opponent side restores both ratings and removes its own event", async () => {
  const prefix = `Undo identity ${randomUUID().slice(0, 8)}`;
  const orgIds: string[] = [];
  const itemIds: string[] = [];

  try {
    const orgId = await createOrg(prefix);
    orgIds.push(orgId);
    const [a, b, c] = await createItems(prefix, ["A", "B", "C"]);
    itemIds.push(a!, b!, c!);

    await submitVote(orgId, a!, b!, "win");
    await submitVote(orgId, a!, c!, "win");

    const matchupsBefore = await matchupsFor(orgId);
    assert.equal(matchupsBefore.length, 2, "both votes should be durable");
    const abRow = matchupsBefore.find((row) => row.opponentId === b)!;
    const acRow = matchupsBefore.find((row) => row.opponentId === c)!;
    assert.ok(abRow?.eventId, "the A-vs-B matchup must carry its timeline event id");
    assert.ok(acRow?.eventId, "the A-vs-C matchup must carry its timeline event id");
    assert.notEqual(abRow.eventId, acRow.eventId, "each comparison needs its own event");

    const undo = await undoLastComparison(orgId, b!);
    assert.equal(undo.undone, true);
    assert.equal(undo.itemId, a);
    assert.equal(undo.opponentId, b, "the undocumented A-vs-B row was the one to undo");

    // A is back to the state before A-vs-B, with the A-vs-C vote intact.
    const aAfter = await ratingFor(orgId, a!);
    assert.equal(aAfter?.elo, abRow.itemEloBefore, "initiator Elo must be restored exactly");
    assert.equal(aAfter?.matches, 1, "only the A-vs-B match may be removed");
    assert.equal(aAfter?.wins, 1, "A-vs-C win must survive");
    assert.equal(aAfter?.losses, 0);
    assert.equal(aAfter?.ties, 0);
    assert.equal(aAfter?.skips, 0);

    // B was the opponent side and is back to its pre-vote defaults.
    const bAfter = await ratingFor(orgId, b!);
    assert.equal(bAfter?.elo, abRow.opponentEloBefore, "opponent Elo must be restored exactly");
    assert.equal(bAfter?.matches, 0);
    assert.equal(bAfter?.wins, 0);
    assert.equal(bAfter?.losses, 0);
    assert.equal(bAfter?.ties, 0);
    assert.equal(bAfter?.skips, 0);

    // The A-vs-B row and its event are gone; A-vs-C and its event are not.
    const matchupsAfter = await matchupsFor(orgId);
    assert.equal(matchupsAfter.length, 1);
    assert.equal(matchupsAfter[0]?.eventId, acRow.eventId, "the surviving matchup must be A-vs-C");

    const events = await admin
      .select({ id: ratingEvents.id })
      .from(ratingEvents)
      .where(
        and(
          eq(ratingEvents.orgId, orgId),
          eq(ratingEvents.kind, "rated"),
          inArray(ratingEvents.id, [abRow.eventId!, acRow.eventId!]),
        ),
      );
    assert.deepEqual(
      events.map((row) => row.id),
      [acRow.eventId],
      "undo deleted the wrong timeline event",
    );
  } finally {
    await cleanup(orgIds, itemIds);
  }
});

/**
 * A vote and an undo landing on the same pair at the same time previously read
 * the rating rows without a lock, so the second writer clobbered the first and
 * `matches` silently disagreed with the durable comparison log.
 *
 * `matches` is incremented once per vote and decremented once per undo, so it
 * must always equal the number of matchup rows that touch the item: that
 * invariant is exactly what a lost update breaks.
 */
test("a concurrent vote and undo neither lose an update nor deadlock", async () => {
  const prefix = `Undo race ${randomUUID().slice(0, 8)}`;
  const orgIds: string[] = [];
  const itemIds: string[] = [];

  try {
    const orgId = await createOrg(prefix);
    orgIds.push(orgId);
    const [d, e] = await createItems(prefix, ["D", "E"]);
    itemIds.push(d!, e!);

    for (let round = 0; round < 10; round += 1) {
      // Both calls run on their own pooled connection inside their own
      // transaction; neither may surface a serialization/deadlock error.
      await Promise.all([
        submitVote(orgId, d!, e!, "win"),
        undoLastComparison(orgId, e!),
      ]);
    }

    for (const itemId of [d!, e!]) {
      const rating = await ratingFor(orgId, itemId);
      const [counted] = await admin
        .select({ n: sql<number>`count(*)::int` })
        .from(itemMatchups)
        .where(
          and(
            eq(itemMatchups.orgId, orgId),
            or(eq(itemMatchups.itemId, itemId), eq(itemMatchups.opponentId, itemId)),
          ),
        );
      assert.equal(
        rating?.matches,
        counted?.n ?? 0,
        "the match counter must agree with the durable comparison log",
      );
      assert.ok((rating?.matches ?? 0) >= 0);
    }
  } finally {
    await cleanup(orgIds, itemIds);
  }
});
