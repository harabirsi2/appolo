import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getProfileByUsername,
  isFollowing,
  matchPercent,
  profileBundle,
} from "@/lib/services/social";
import { ProfileScreen } from "@/components/profile-screen";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params) {
  const { username } = await params;
  const profile = await getProfileByUsername(decodeURIComponent(username));
  return { title: profile ? `${profile.displayName} (@${profile.username})` : "Profile" };
}

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { username } = await params;
  const { tab } = await searchParams;
  const profile = await getProfileByUsername(decodeURIComponent(username));
  if (!profile) notFound();

  const session = await getSession();
  if (session && session.org.id === profile.orgId) redirect("/app/profile");

  const [bundle, following, match] = await Promise.all([
    profileBundle(profile),
    session ? isFollowing(session.org.id, profile.orgId) : Promise.resolve(false),
    session ? matchPercent(session.org.id, profile.orgId) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] border-x border-white/[0.04] bg-black pb-12">
      <div className="flex items-center justify-between px-5 pt-5">
        <Link href="/" className="text-[20px] font-extrabold tracking-tight text-ink">
          appolo
        </Link>
        <Link
          href={session ? "/app" : "/login"}
          className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-white/10"
        >
          {session ? "Open app" : "Sign in"}
        </Link>
      </div>
      <ProfileScreen
        bundle={bundle}
        viewerOrgId={session?.org.id ?? null}
        following={following}
        tab={tab}
        matchPercent={match}
      />
    </div>
  );
}