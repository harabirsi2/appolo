import { revalidateTag } from "next/cache";

/**
 * Tags for the shared community reads. The service layer tags its cache
 * entries with these, so a mutation can invalidate them by name.
 */
export const COMMUNITY_TAGS = {
  popular: "community-popular",
} as const;

/**
 * Drop the cached shared reads after a rating changes, so the home rail does
 * not serve a stale popular list until the TTL expires.
 */
export function invalidateCommunity(): void {
  for (const tag of Object.values(COMMUNITY_TAGS)) revalidateTag(tag);
}
