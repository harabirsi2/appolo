import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, EmptyState } from "@appolo/ui";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { getCatalogItem, getRating, nextMatchup } from "@/lib/services/rankings";
import { getProfileByOrgId, podsForProfile } from "@/lib/services/social";
import { isDomainError } from "@/lib/services/errors";
import { FinishRating } from "./finish-rating";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finish rating" };

type Params = { params: Promise<{ itemId: string }> };

export default async function RateItemPage({ params }: Params) {
  const session = await requireSession();
  const { itemId } = await params;

  const item = await getCatalogItem(itemId);
  if (!item) notFound();

  const [matchup, rating, profile] = await Promise.all([
    nextMatchup(session.org.id, itemId).catch((error: unknown) => {
      if (isDomainError(error) && error.code === "NO_OPPONENT") return null;
      throw error;
    }),
    getRating(session.org.id, itemId),
    getProfileByOrgId(session.org.id),
  ]);

  if (!matchup) {
    return (
      <div className="px-5 pt-6">
        <EmptyState
          title="No opponents available"
          body="Add more items to this category before ranking this one."
          action={
            <Link href="/app/search">
              <Button size="sm" variant="secondary">Back to search</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const pods = profile ? await podsForProfile(profile.orgId, profile.username, profile.displayName) : [];
  const generic = ["lit", "all-timer", "rewatch", "underrated", "comfort", "overrated"];
  const suggestedTags = [...new Set([...item.tags, ...generic])].slice(0, 9);

  return (
    <FinishRating
      initialItem={{
        id: item.id,
        kind: item.kind,
        title: item.title,
        subtitle: item.subtitle,
        year: item.year,
        score: rating?.score ?? matchup.item.score,
        reviewText: rating?.reviewText ?? "",
        reviewTags: rating?.reviewTags ?? [],
        spoiler: rating?.spoiler ?? false,
        photoUrl: rating?.photoUrl ?? null,
        favoriteCharacter: rating?.favoriteCharacter ?? null,
        favoriteTracks: rating?.favoriteTracks ?? [],
      }}
      initialOpponent={{
        id: matchup.opponent.id,
        title: matchup.opponent.title,
        year: matchup.opponent.year,
      }}
      kindLabel={MEDIA_KIND_LABELS[item.kind]}
      suggestedTags={suggestedTags}
      pods={pods.map((pod) => ({ id: pod.id, title: pod.title }))}
      manualMode={profile?.manualMode ?? false}
    />
  );
}