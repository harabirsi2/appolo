import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { scoreForElo, verifyPassword } from "@appolo/core";
import { getDb, withOrg, schema } from "@/lib/db";
import { DomainError } from "./errors";

const { catalogItems, itemRatings, itemMatchups, rankingOrder, profiles, orgs, users } = schema;

export interface MediaExport {
  exportedAt: string;
  profile: {
    username: string;
    displayName: string;
    bio: string | null;
    manualMode: boolean;
    language: string;
    profileLayout: string;
    createdAt: Date;
  } | null;
  ratings: Array<{
    itemId: string;
    title: string;
    kind: string;
    externalRef: string | null;
    year: number | null;
    score: number;
    elo: number;
    matches: number;
    wins: number;
    losses: number;
    ties: number;
    skips: number;
    reviewText: string | null;
    reviewTags: string[];
    spoiler: boolean;
    photoUrl: string | null;
    videoUrl: string | null;
    favoriteCharacter: string | null;
    favoriteTracks: string[];
    createdAt: Date;
    updatedAt: Date;
  }>;
  reviews: Array<{
    itemId: string;
    title: string;
    text: string;
    tags: string[];
    spoiler: boolean;
    photoUrl: string | null;
    videoUrl: string | null;
    favoriteCharacter: string | null;
    favoriteTracks: string[];
    updatedAt: Date;
  }>;
  matchups: Array<{
    itemId: string;
    itemTitle: string;
    opponentId: string;
    opponentTitle: string;
    result: string;
    outcome: string | null;
    itemEloBefore: number;
    itemEloAfter: number;
    opponentEloBefore: number;
    opponentEloAfter: number;
    createdAt: Date;
  }>;
  rankingOrder: Array<{
    kind: string;
    itemId: string;
    title: string;
    position: number;
    updatedAt: Date;
  }>;
}

/** Everything the org's media profile owns: ratings, reviews, matchups, order. */
export async function exportMediaData(orgId: string): Promise<MediaExport> {
  return withOrg(orgId, async (tx) => {
    const opponent = alias(catalogItems, "opponent");

    const [profileRows, ratingRows, matchupRows, orderRows] = await Promise.all([
      tx.select().from(profiles).where(eq(profiles.orgId, orgId)).limit(1),
      tx
        .select({ rating: itemRatings, item: catalogItems })
        .from(itemRatings)
        .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
        .where(eq(itemRatings.orgId, orgId)),
      tx
        .select({ matchup: itemMatchups, itemTitle: catalogItems.title, opponentTitle: opponent.title })
        .from(itemMatchups)
        .innerJoin(catalogItems, eq(catalogItems.id, itemMatchups.itemId))
        .innerJoin(opponent, eq(opponent.id, itemMatchups.opponentId))
        .where(eq(itemMatchups.orgId, orgId)),
      tx
        .select({ order: rankingOrder, title: catalogItems.title })
        .from(rankingOrder)
        .innerJoin(catalogItems, eq(catalogItems.id, rankingOrder.itemId))
        .where(eq(rankingOrder.orgId, orgId)),
    ]);

    const profile = profileRows[0];
    const ratings = ratingRows.map(({ rating, item }) => ({
      itemId: item.id,
      title: item.title,
      kind: item.kind,
      externalRef: item.externalRef ?? null,
      year: item.year ?? null,
      score: scoreForElo(rating.elo),
      elo: rating.elo,
      matches: rating.matches,
      wins: rating.wins,
      losses: rating.losses,
      ties: rating.ties,
      skips: rating.skips,
      reviewText: rating.reviewText ?? null,
      reviewTags: rating.reviewTags ?? [],
      spoiler: rating.spoiler,
      photoUrl: rating.photoUrl ?? null,
      videoUrl: rating.videoUrl ?? null,
      favoriteCharacter: rating.favoriteCharacter ?? null,
      favoriteTracks: rating.favoriteTracks ?? [],
      createdAt: rating.createdAt,
      updatedAt: rating.updatedAt,
    }));

    return {
      exportedAt: new Date().toISOString(),
      profile: profile
        ? {
            username: profile.username,
            displayName: profile.displayName,
            bio: profile.bio ?? null,
            manualMode: profile.manualMode,
            language: profile.language,
            profileLayout: profile.profileLayout,
            createdAt: profile.createdAt,
          }
        : null,
      ratings,
      reviews: ratings
        .filter((rating) => Boolean(rating.reviewText) || rating.reviewTags.length > 0)
        .map((rating) => ({
          itemId: rating.itemId,
          title: rating.title,
          text: rating.reviewText ?? "",
          tags: rating.reviewTags,
          spoiler: rating.spoiler,
          photoUrl: rating.photoUrl,
          videoUrl: rating.videoUrl,
          favoriteCharacter: rating.favoriteCharacter,
          favoriteTracks: rating.favoriteTracks,
          updatedAt: rating.updatedAt,
        })),
      matchups: matchupRows.map(({ matchup, itemTitle, opponentTitle }) => ({
        itemId: matchup.itemId,
        itemTitle,
        opponentId: matchup.opponentId,
        opponentTitle,
        result: matchup.result,
        outcome: matchup.outcome ?? null,
        itemEloBefore: matchup.itemEloBefore,
        itemEloAfter: matchup.itemEloAfter,
        opponentEloBefore: matchup.opponentEloBefore,
        opponentEloAfter: matchup.opponentEloAfter,
        createdAt: matchup.createdAt,
      })),
      rankingOrder: orderRows.map(({ order, title }) => ({
        kind: order.kind,
        itemId: order.itemId,
        title,
        position: order.position,
        updatedAt: order.updatedAt,
      })),
    };
  });
}

/**
 * Deletes the signed-in user's account and their workspace. Every tenant table
 * cascades from `orgs`, so the media layer (ratings, matchups, reviews,
 * ranking order, watchlist, pods, follows) goes with it, and sessions and
 * memberships cascade from `users`.
 *
 * The password is re-checked because a live session cookie alone should not be
 * enough to destroy an account.
 */
export async function deleteAccount(input: {
  userId: string;
  orgId: string;
  password: string;
  confirm: string;
}): Promise<void> {
  if (input.confirm !== "DELETE") {
    throw new DomainError("CONFIRM_REQUIRED", 'Type "DELETE" to confirm account deletion.', 400);
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) throw new DomainError("ACCOUNT_NOT_FOUND", "That account no longer exists.", 404);
  if (!verifyPassword(input.password, user.passwordHash)) {
    throw new DomainError("INVALID_PASSWORD", "That password does not match.", 400);
  }

  const [org] = await withOrg(input.orgId, (tx) =>
    tx.select({ slug: orgs.slug }).from(orgs).where(eq(orgs.id, input.orgId)).limit(1),
  );
  if (!org) throw new DomainError("ACCOUNT_NOT_FOUND", "That workspace no longer exists.", 404);
  if (org.slug === "demo") {
    throw new DomainError("DEMO_ACCOUNT", "The shared demo account cannot be deleted.", 400);
  }

  await withOrg(input.orgId, async (tx) => {
    await tx.delete(orgs).where(eq(orgs.id, input.orgId));
    await tx.delete(users).where(eq(users.id, input.userId));
  });
}
