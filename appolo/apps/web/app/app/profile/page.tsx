import { Button } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { logoutAction } from "@/lib/actions";
import { ensureProfile, getProfileByOrgId, profileBundle } from "@/lib/services/social";
import { ProfileScreen } from "@/components/profile-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile" };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSession();
  const { tab } = await searchParams;
  const profile =
    (await getProfileByOrgId(session.org.id)) ??
    (await ensureProfile(session.org.id, session.org.name, session.org.slug));
  const bundle = await profileBundle(profile);

  return (
    <ProfileScreen
      bundle={bundle}
      viewerOrgId={session.org.id}
      following={false}
      tab={tab}
      footer={
        <form action={logoutAction}>
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      }
    />
  );
}