import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { getAdminDb, schema, withOrg } from "@appolo/db";
import { START_ELO } from "@appolo/core";
import { submitVote } from "./rankings";

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

const { catalogItems, itemMatchups, itemRatings, orgs, voteReceipts } = schema;
const admin = getAdminDb();

/**
 * Two connections, one pair.
 *
 * `getOrInitRatings` locks both rating rows inside the transaction, so two
 * simultaneous votes must serialise instead of reading the same "before" Elo
 * and writing over each other. The invariant that catches a lost update is
 * arithmetic: the final rating must equal the start plus every delta the
 * durable log recorded for that item, and `matches` must equal the number of
 * matchup rows touching it.
 */
async function createOrg(prefix: string): Promise<string> {
  const orgId = randomUUID();
  await admin.insert(orgs).values({ id: orgId, name: `${prefix} ${orgId.slice(0, 8)}`, slug: orgId });
  return orgId;
}

async function createPair(prefix: string): Promise<[string, string]> {
  const rows = await admin
    .insert(catalogItems)
    .values([
      { kind: "movie" as const, title: `${prefix} left`, subtitle: "Test" },
      { kind: "movie" as const, title: `${prefix} right`, subtitle: "Test" },
    ])
    .returning({ id: catalogItems.id });
  return [rows[0]!.id, rows[1]!.id];
}

async function cleanup(orgIds: string[], itemIds: string[]): Promise<void> {
  for (const orgId of orgIds) await admin.delete(orgs).where(eq(orgs.id, orgId));
  for (const itemId of itemIds) await admin.delete(catalogItems).where(eq(catalogItems.id, itemId));
}

/** Sum of every delta the log applied to `itemId`, whichever side it was on. */
async function loggedDelta(orgId: string, itemId: string): Promise<number> {
  const rows = await admin
    .select()
    .from(itemMatchups)
    .where(and(eq(itemMatchups.orgId, orgId), inArray(itemMatchups.itemId, [itemId])));
  const asOpponent = await admin
    .select()
    .from(itemMatchups)
    .where(and(eq(itemMatchups.orgId, orgId), eq(itemMatchups.opponentId, itemId)));
  let total = 0;
  for (const row of rows) total += row.itemEloAfter - row.itemEloBefore;
  for (const row of asOpponent) total += row.opponentEloAfter - row.opponentEloBefore;
  return total;
}

async function matchesTouching(orgId: string, itemId: string): Promise<number> {
  const a = await admin
    .select({ id: itemMatchups.id })
    .from(itemMatchups)
    .where(and(eq(itemMatchups.orgId, orgId), eq(itemMatchups.itemId, itemId)));
  const b = await admin
    .select({ id: itemMatchups.id })
    .from(itemMatchups)
    .where(and(eq(itemMatchups.orgId, orgId), eq(itemMatchups.opponentId, itemId)));
  return a.length + b.length;
}

async function ratingFor(orgId: string, itemId: string) {
  const [row] = await admin
    .select()
    .from(itemRatings)
    .where(and(eq(itemRatings.orgId, orgId), eq(itemRatings.itemId, itemId)))
    .limit(1);
  return row;
}

test("two simultaneous votes on the same pair both land exactly once", async () => {
  const prefix = `Pair race ${randomUUID().slice(0, 8)}`;
  const orgIds: string[] = [];
  const itemIds: string[] = [];

  try {
    const orgId = await createOrg(prefix);
    orgIds.push(orgId);
    const [a, b] = await createPair(prefix);
    itemIds.push(a!, b!);

    const settled = await Promise.allSettled([
      submitVote(orgId, a!, b!, "win"),
      submitVote(orgId, b!, a!, "win"),
    ]);
    assert.deepEqual(
      settled.map((entry) => entry.status),
      ["fulfilled", "fulfilled"],
      `a same-pair race must not deadlock or fail: ${settled
        .map((entry) => (entry.status === "rejected" ? String(entry.reason) : "ok"))
        .join(" | ")}`,
    );

    const rows = await admin.select().from(itemMatchups).where(eq(itemMatchups.orgId, orgId));
    assert.equal(rows.length, 2, "each vote must leave exactly one matchup row");

    for (const itemId of [a!, b!]) {
      const rating = await ratingFor(orgId, itemId);
      assert.ok(rating, "both sides must have a rating row");
      assert.equal(rating?.matches, 2, "two votes means two matches on each side");
      assert.equal(rating?.wins + rating?.losses, 2, "no counter may be lost to the race");
      assert.equal(
        rating?.elo,
        START_ELO + (await loggedDelta(orgId, itemId)),
        "the rating must equal the start plus every logged delta",
      );
      assert.equal(rating?.matches, await matchesTouching(orgId, itemId));
    }
  } finally {
    await cleanup(orgIds, itemIds);
  }
});

test("a storm of same-pair votes never loses an update", async () => {
  const prefix = `Pair storm ${randomUUID().slice(0, 8)}`;
  const orgIds: string[] = [];
  const itemIds: string[] = [];
  const rounds = 6;

  try {
    const orgId = await createOrg(prefix);
    orgIds.push(orgId);
    const [a, b] = await createPair(prefix);
    itemIds.push(a!, b!);

    for (let round = 0; round < rounds; round += 1) {
      await Promise.all([
        submitVote(orgId, a!, b!, round % 2 === 0 ? "win" : "tie"),
        submitVote(orgId, b!, a!, round % 2 === 0 ? "win" : "loss"),
      ]);
    }

    const rows = await admin.select().from(itemMatchups).where(eq(itemMatchups.orgId, orgId));
    assert.equal(rows.length, rounds * 2);

    for (const itemId of [a!, b!]) {
      const rating = await ratingFor(orgId, itemId);
      assert.equal(rating?.matches, rounds * 2);
      assert.equal(rating?.wins + rating?.losses + rating?.ties, rounds * 2);
      assert.equal(rating?.elo, START_ELO + (await loggedDelta(orgId, itemId)));
      assert.equal(rating?.matches, await matchesTouching(orgId, itemId));
    }
  } finally {
    await cleanup(orgIds, itemIds);
  }
});

test("one idempotency key delivered twice at once applies once", async () => {
  const prefix = `Key race ${randomUUID().slice(0, 8)}`;
  const orgIds: string[] = [];
  const itemIds: string[] = [];

  try {
    const orgId = await createOrg(prefix);
    orgIds.push(orgId);
    const [a, b] = await createPair(prefix);
    itemIds.push(a!, b!);
    const key = randomUUID();

    const results = await Promise.allSettled([
      submitVote(orgId, a!, b!, "win", { idempotencyKey: key }),
      submitVote(orgId, a!, b!, "win", { idempotencyKey: key }),
    ]);
    const fulfilled = results.filter((entry) => entry.status === "fulfilled");
    assert.equal(fulfilled.length, 2, "both deliveries must answer rather than throw");

    const rows = await admin.select().from(itemMatchups).where(eq(itemMatchups.orgId, orgId));
    assert.equal(rows.length, 1, "the comparison log may only record the vote once");

    const rating = await ratingFor(orgId, a!);
    assert.equal(rating?.matches, 1, "the counter must move once");

    const receipts = await withOrg(orgId, (tx) =>
      tx.select({ key: voteReceipts.idempotencyKey }).from(voteReceipts),
    );
    assert.deepEqual(receipts.map((row) => row.key), [key], "exactly one receipt per key");
  } finally {
    await cleanup(orgIds, itemIds);
  }
});
