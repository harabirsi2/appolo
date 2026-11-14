import { revalidateTag } from "next/cache";

/**
 * Tags for the shared community reads. The service layer tags its cache
 * entries with these, so a mutation can invalidate them by name.
 */
export const COMMUNITY_TAGS = {
  popular: "community-popular",
  leaderboard: "community-leaderboard",
} as const;

/**
 * Drop the cached community reads after a rating changes, so Browse and the
 * home rail do not serve a stale leaderboard until the TTL expires.
 */
export function invalidateCommunity(): void {
  for (const tag of Object.values(COMMUNITY_TAGS)) revalidateTag(tag);
}
