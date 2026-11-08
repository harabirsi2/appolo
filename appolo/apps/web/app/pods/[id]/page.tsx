import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { getProfileByUsername, podById } from "@/lib/services/social";
import { PodScreen } from "@/components/pod-screen";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const pod = await podById(id);
  return { title: pod ? `${pod.title} — @${pod.ownerUsername}` : "Pod" };
}

export default async function PodByIdPage({ params }: Params) {
  const { id } = await params;
  const pod = await podById(id);
  if (!pod) notFound();

  const session = await getSession();
  const profile = session ? await getProfileByUsername(session.org.slug) : null;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] border-x border-white/[0.04] bg-black pb-12">
      <div className="flex items-center justify-between px-5 pt-5">
        <Link href={`/${pod.ownerUsername}`} className="text-xs text-muted-2 hover:text-ink">
          ← {`@${pod.ownerUsername}`}
        </Link>
        <Link href={session ? "/app" : "/login"} className="text-xs text-muted-2 hover:text-ink">
          {session ? "Open app" : "Sign in"}
        </Link>
      </div>
      <PodScreen pod={pod} viewerUsername={profile?.username ?? null} />
    </div>
  );
}