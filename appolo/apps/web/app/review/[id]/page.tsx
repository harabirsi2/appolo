import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { reviewById } from "@/lib/services/social";
import { ReviewScreen } from "@/components/review-screen";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const review = await reviewById(id);
  return {
    title: review ? `${review.displayName} on ${review.itemTitle}` : "Review",
    description: review?.text?.slice(0, 150) ?? undefined,
  };
}

export default async function PublicReviewPage({ params }: Params) {
  const { id } = await params;
  const session = await getSession();
  const review = await reviewById(id, session?.org.id ?? null);
  if (!review) notFound();

  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] border-x border-white/[0.04] bg-black pb-12">
      <div className="flex items-center justify-between px-5 pt-5">
        <Link href={`/${review.username}`} className="text-xs text-muted-2 hover:text-ink">
          ← {`@${review.username}`}
        </Link>
        <Link href={session ? "/app" : "/login"} className="text-xs text-muted-2 hover:text-ink">
          {session ? "Open app" : "Sign in"}
        </Link>
      </div>
      <ReviewScreen review={review} />
    </div>
  );
}
