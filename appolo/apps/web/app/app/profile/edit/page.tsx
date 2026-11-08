import { requireSession } from "@/lib/session";
import { getProfileByOrgId } from "@/lib/services/social";
import { ProfileSettings } from "@/components/profile-settings";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

export default async function ProfileEditPage() {
  const session = await requireSession();
  const profile = await getProfileByOrgId(session.org.id);
  if (!profile) {
    return null;
  }
  return (
    <div className="px-5 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app/profile" />
        <h1 className="text-[20px] font-bold text-ink">Edit profile</h1>
        <span className="w-8" />
      </div>
      <ProfileSettings profile={profile} />
    </div>
  );
}