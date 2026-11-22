import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq } from "drizzle-orm";
import { getAdminDb, schema } from "@appolo/db";
import {
  moderationQueue,
  moderateReport,
  reportContent,
} from "./moderation";
import {
  commentsFor,
  feedFollowing,
  itemCommunity,
  reviewById,
} from "./social";
import { getProfileByUsername, searchProfiles } from "./social-graph";
import { rankedRatings } from "./rankings";
import { getCatalogItem } from "./catalog-item";

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

const { abuseReports, catalogItems, follows, itemRatings, orgs, profiles, ratingComments, users } = schema;
const admin = getAdminDb();

interface Fixture {
  orgIds: string[];
  userIds: string[];
  itemIds: string[];
}

async function createOrg(prefix: string): Promise<string> {
  const orgId = randomUUID();
  await admin.insert(orgs).values({
    id: orgId,
    name: `${prefix} ${orgId.slice(0, 8)}`,
    slug: `${prefix}-${orgId}`,
  });
  return orgId;
}

async function createProfile(orgId: string, prefix: string): Promise<string> {
  const username = `${prefix}-${orgId.slice(0, 8)}`;
  await admin.insert(profiles).values({
    orgId,
    username,
    displayName: `${prefix} ${orgId.slice(0, 8)}`,
  });
  return username;
}

async function cleanup(fixture: Fixture): Promise<void> {
  for (const orgId of fixture.orgIds) {
    await admin.delete(orgs).where(eq(orgs.id, orgId));
  }
  for (const itemId of fixture.itemIds) {
    await admin.delete(catalogItems).where(eq(catalogItems.id, itemId));
  }
  for (const userId of fixture.userIds) {
    await admin.delete(users).where(eq(users.id, userId));
  }
}

test("reported content leaves public feeds and moderation actions are idempotent", async () => {
  const fixture: Fixture = { orgIds: [], userIds: [], itemIds: [] };
  const prefix = `Moderation integrity ${randomUUID().slice(0, 8)}`;

  try {
    const authorOrgId = await createOrg("moderation-author");
    const reporterOrgId = await createOrg("moderation-reporter");
    const otherOrgId = await createOrg("moderation-other");
    fixture.orgIds.push(authorOrgId, reporterOrgId, otherOrgId);

    const authorUsername = await createProfile(authorOrgId, "author");
    await createProfile(reporterOrgId, "reporter");
    await createProfile(otherOrgId, "other");

    const [moderator] = await admin
      .insert(users)
      .values({
        email: `${prefix.replace(/\s+/g, "-").toLowerCase()}@example.com`,
        name: "Moderator",
        passwordHash: "not-used-in-tests",
        isModerator: true,
      })
      .returning({ id: users.id });
    assert.ok(moderator);
    fixture.userIds.push(moderator.id);

    const [item] = await admin
      .insert(catalogItems)
      .values({ kind: "movie", title: `${prefix} Film`, subtitle: "Test" })
      .returning({ id: catalogItems.id });
    assert.ok(item);
    fixture.itemIds.push(item.id);

    const [rating] = await admin
      .insert(itemRatings)
      .values({
        orgId: authorOrgId,
        itemId: item.id,
        elo: 1700,
        reviewText: "A review that should disappear when reported.",
      })
      .returning({ id: itemRatings.id });
    assert.ok(rating);

    const [comment] = await admin
      .insert(ratingComments)
      .values({
        orgId: reporterOrgId,
        ratingId: rating.id,
        body: "A comment that should disappear when reported.",
      })
      .returning({ id: ratingComments.id });
    assert.ok(comment);

    // The reporter follows the author so the following feed is a real public feed path.
    await admin.insert(follows).values({
      followerOrgId: reporterOrgId,
      followeeOrgId: authorOrgId,
    });

    assert.equal((await feedFollowing(reporterOrgId)).length, 1);
    assert.equal((await itemCommunity(item.id)).reviews.length, 1);
    const scoredItem = await getCatalogItem(item.id);
    assert.equal(scoredItem?.totalReviews, 1, "a visible review must count toward the catalog aggregate");
    assert.equal(typeof scoredItem?.bayesianScore, "number", "a visible review must produce a Bayesian score");
    assert.ok(await reviewById(rating.id));
    assert.equal((await commentsFor(rating.id)).comments.length, 1);

    const reviewReport = await reportContent(reporterOrgId, {
      contentType: "review",
      contentId: rating.id,
      reason: "harassment",
      details: "Repeated targeted insults.",
    });
    assert.equal(reviewReport.created, true);

    const duplicateReport = await reportContent(reporterOrgId, {
      contentType: "review",
      contentId: rating.id,
      reason: "spam",
    });
    assert.equal(duplicateReport.id, reviewReport.id, "a repeat report must reuse the open report");
    assert.equal(duplicateReport.created, false);

    await assert.rejects(
      reportContent(authorOrgId, {
        contentType: "review",
        contentId: rating.id,
        reason: "spam",
      }),
      /cannot report your own content/i,
    );

    const profileReport = await reportContent(reporterOrgId, {
      contentType: "profile",
      contentId: authorOrgId,
      reason: "other",
    });
    const profileReportFromOther = await reportContent(otherOrgId, {
      contentType: "profile",
      contentId: authorOrgId,
      reason: "harassment",
    });
    const commentReport = await reportContent(authorOrgId, {
      contentType: "comment",
      contentId: comment.id,
      reason: "hate",
    });

    const queue = await moderationQueue(200);
    const queuedIds = new Set(queue.map((entry) => entry.id));
    assert.ok(queuedIds.has(reviewReport.id));
    assert.ok(queuedIds.has(profileReport.id));
    assert.ok(queuedIds.has(profileReportFromOther.id));
    assert.ok(queuedIds.has(commentReport.id));
    assert.equal(queue.find((entry) => entry.id === profileReport.id)?.openReports, 2);

    const hiddenComment = await moderateReport(moderator.id, commentReport.id, "hide");
    assert.equal(hiddenComment.changed, true);
    assert.equal(hiddenComment.contentStatus, "hidden");
    const hiddenCommentAgain = await moderateReport(moderator.id, commentReport.id, "hide");
    assert.equal(hiddenCommentAgain.changed, false, "replaying hide must not change state again");
    assert.equal(hiddenCommentAgain.contentStatus, "hidden");

    const commentPage = await commentsFor(rating.id);
    assert.equal(commentPage.comments.length, 0, "hidden comments must disappear from public reads");
    assert.equal(commentPage.total, 0);

    const removedComment = await moderateReport(moderator.id, commentReport.id, "remove");
    assert.equal(removedComment.changed, true, "remove may escalate a hidden comment");
    const removedCommentAgain = await moderateReport(moderator.id, commentReport.id, "remove");
    assert.equal(removedCommentAgain.changed, false);

    const hiddenReview = await moderateReport(moderator.id, reviewReport.id, "hide");
    assert.equal(hiddenReview.changed, true);
    assert.equal(hiddenReview.contentStatus, "hidden");
    const hiddenReviewAgain = await moderateReport(moderator.id, reviewReport.id, "hide");
    assert.equal(hiddenReviewAgain.changed, false);
    assert.equal(hiddenReviewAgain.contentStatus, "hidden");

    assert.equal(await reviewById(rating.id), null, "hidden reviews must not resolve publicly");
    assert.equal((await feedFollowing(reporterOrgId)).length, 0, "hidden reviews must leave the following feed");
    assert.equal((await itemCommunity(item.id)).reviews.length, 0, "hidden reviews must leave item feeds");
    assert.equal((await itemCommunity(item.id)).count, 0);
    const hiddenItem = await getCatalogItem(item.id);
    assert.equal(hiddenItem?.totalReviews, 0, "hidden reviews must leave the catalog's total_reviews");
    assert.equal(hiddenItem?.bayesianScore, null, "hidden reviews must leave the catalog's Bayesian score");
    assert.equal(
      (await rankedRatings(authorOrgId, { publicOnly: true })).length,
      0,
      "public profile rankings must exclude hidden reviews",
    );
    assert.equal(
      (await rankedRatings(authorOrgId)).length,
      1,
      "the owner's private library may still include their own hidden review",
    );

    const dismissed = await moderateReport(moderator.id, profileReport.id, "dismiss");
    assert.equal(dismissed.changed, true);
    assert.equal(dismissed.reportStatus, "dismissed");
    assert.ok(await getProfileByUsername(authorUsername), "dismissing a report leaves the profile visible");
    const dismissedAgain = await moderateReport(moderator.id, profileReport.id, "dismiss");
    assert.equal(dismissedAgain.changed, false, "dismissing twice must not change state again");

    const hiddenProfile = await moderateReport(moderator.id, profileReportFromOther.id, "hide");
    assert.equal(hiddenProfile.changed, true);
    assert.equal(hiddenProfile.contentStatus, "hidden");
    const hiddenProfileAgain = await moderateReport(moderator.id, profileReportFromOther.id, "hide");
    assert.equal(hiddenProfileAgain.changed, false);
    assert.equal(await getProfileByUsername(authorUsername), null, "hidden profiles must not resolve publicly");
    assert.equal(
      (await searchProfiles(authorUsername)).some((profile) => profile.orgId === authorOrgId),
      false,
      "hidden profiles must leave public search",
    );

    const [remainingOpen] = await admin
      .select({ id: abuseReports.id })
      .from(abuseReports)
      .where(eq(abuseReports.contentId, rating.id))
      .limit(1);
    assert.ok(remainingOpen);
    const [savedReport] = await admin
      .select({ status: abuseReports.status, action: abuseReports.action, moderatedBy: abuseReports.moderatedBy })
      .from(abuseReports)
      .where(eq(abuseReports.id, reviewReport.id))
      .limit(1);
    assert.equal(savedReport?.status, "actioned");
    assert.equal(savedReport?.action, "hide");
    assert.equal(savedReport?.moderatedBy, moderator.id);
    assert.equal((await moderationQueue(200)).some((entry) => entry.id === reviewReport.id), false);
  } finally {
    await cleanup(fixture);
  }
});

test("hiding a profile removes its ratings from catalog aggregates", async () => {
  const fixture: Fixture = { orgIds: [], userIds: [], itemIds: [] };
  const prefix = `Moderation profile aggregate ${randomUUID().slice(0, 8)}`;

  try {
    const firstOrgId = await createOrg("moderation-aggregate-a");
    const secondOrgId = await createOrg("moderation-aggregate-b");
    fixture.orgIds.push(firstOrgId, secondOrgId);
    await createProfile(firstOrgId, "aggregate-a");
    await createProfile(secondOrgId, "aggregate-b");

    const [moderator] = await admin
      .insert(users)
      .values({
        email: `${prefix.replace(/\s+/g, "-").toLowerCase()}@example.com`,
        name: "Aggregate Moderator",
        passwordHash: "not-used-in-tests",
        isModerator: true,
      })
      .returning({ id: users.id });
    assert.ok(moderator);
    fixture.userIds.push(moderator.id);

    const [item] = await admin
      .insert(catalogItems)
      .values({ kind: "movie", title: `${prefix} Film`, subtitle: "Test" })
      .returning({ id: catalogItems.id });
    assert.ok(item);
    fixture.itemIds.push(item.id);

    await admin.insert(itemRatings).values([
      { orgId: firstOrgId, itemId: item.id, elo: 1500, reviewText: "First visible review." },
      { orgId: secondOrgId, itemId: item.id, elo: 1650, reviewText: "Second visible review." },
    ]);

    const bothVisible = await getCatalogItem(item.id);
    assert.equal(bothVisible?.totalReviews, 2, "ratings from every visible profile must count");
    assert.equal(typeof bothVisible?.bayesianScore, "number");

    const firstReport = await reportContent(secondOrgId, {
      contentType: "profile",
      contentId: firstOrgId,
      reason: "harassment",
    });
    const hiddenFirst = await moderateReport(moderator.id, firstReport.id, "hide");
    assert.equal(hiddenFirst.contentStatus, "hidden");

    const oneVisible = await getCatalogItem(item.id);
    assert.equal(oneVisible?.totalReviews, 1, "a hidden profile's rating must leave total_reviews");
    assert.equal(typeof oneVisible?.bayesianScore, "number", "one visible rating still yields a score");
    assert.equal((await itemCommunity(item.id)).count, 1, "aggregates must match the public item feed");

    const secondReport = await reportContent(firstOrgId, {
      contentType: "profile",
      contentId: secondOrgId,
      reason: "spam",
    });
    const hiddenSecond = await moderateReport(moderator.id, secondReport.id, "hide");
    assert.equal(hiddenSecond.contentStatus, "hidden");

    const noneVisible = await getCatalogItem(item.id);
    assert.equal(noneVisible?.totalReviews, 0, "hiding the last visible profile must clear total_reviews");
    assert.equal(noneVisible?.bayesianScore, null, "hiding the last visible profile must clear the Bayesian score");
    assert.equal((await itemCommunity(item.id)).count, 0);
  } finally {
    await cleanup(fixture);
  }
});

test("reports for unknown or non-uuid content are rejected without creating rows", async () => {
  const reporterOrgId = await createOrg("moderation-unknown");
  try {
    await createProfile(reporterOrgId, "unknown-reporter");
    await assert.rejects(
      reportContent(reporterOrgId, {
        contentType: "review",
        contentId: randomUUID(),
        reason: "spam",
      }),
      /no longer available/i,
    );
    await assert.rejects(
      reportContent(reporterOrgId, {
        contentType: "review",
        contentId: "not-a-uuid",
        reason: "spam",
      }),
      /no longer available/i,
    );
    const [count] = await admin
      .select({ n: abuseReports.id })
      .from(abuseReports)
      .where(eq(abuseReports.reporterOrgId, reporterOrgId))
      .limit(1);
    assert.equal(count, undefined);
  } finally {
    await admin.delete(orgs).where(eq(orgs.id, reporterOrgId));
  }
});
