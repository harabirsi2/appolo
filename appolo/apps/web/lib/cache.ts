import { revalidateTag } from "next/cache";

/** Cache tags for the shared, read-heavy community views. */
export const COMMUNITY_TAGS = ["community-popular", "community-leaderboard"] as const;

/**
 * Drop the cached community reads after a rating changes, so Browse and the
 * home rail do not keep serving a stale leaderboard until the TTL expires.
 */
export function invalidateCommunity(): void {
  for (const tag of COMMUNITY_TAGS) revalidateTag(tag);
}
