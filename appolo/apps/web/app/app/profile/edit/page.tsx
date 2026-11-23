import { requireSession } from "@/lib/session";
import { getProfileByOrgId } from "@/lib/services/social";
import { rankedRatings } from "@/lib/services/rankings";
import { ProfileSettings } from "@/components/profile-settings";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

export default async function ProfileEditPage() {
  const session = await requireSession();
  const profile = await getProfileByOrgId(session.org.id);
  if (!profile) {
    return null;
  }
  const reviews = (await rankedRatings(session.org.id))
    .filter((rating) => Boolean(rating.reviewText?.trim()) || rating.reviewTags.length > 0)
    .slice(0, 50)
    .map((rating) => ({
      ratingId: rating.ratingId,
      title: rating.title,
      text: rating.reviewText?.trim() || null,
      tags: rating.reviewTags,
    }));
  return (
    <div className="px-5 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app/profile" />
        <h1 className="text-[20px] font-bold text-ink">Edit profile</h1>
        <span className="w-8" />
      </div>
      <ProfileSettings profile={profile} reviews={reviews} />
    </div>
  );
}
