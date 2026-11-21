import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { reviewById } from "@/lib/services/social";
import { ReviewScreen } from "@/components/review-screen";
import { pageMetadata, truncateText } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const review = await reviewById(id);
  if (!review) {
    return pageMetadata({ title: "Review not found", path: `/review/${id}`, noindex: true });
  }

  const score = review.score.toFixed(1);
  // A spoiler review must not put its text (or the surprise) in a link preview.
  const description = review.spoiler
    ? `${review.displayName} rated ${review.itemTitle} ${score}/10 on Appolo. This review is marked as a spoiler.`
    : truncateText(review.text) ??
      `${review.displayName} rated ${review.itemTitle} ${score}/10 on Appolo.`;

  return pageMetadata({
    title: `${review.displayName} on ${review.itemTitle}`,
    description,
    path: `/review/${id}`,
    image: `/api/og/review/${encodeURIComponent(id)}`,
    imageAlt: `${review.displayName} rated ${review.itemTitle} ${score}/10`,
    type: "article",
  });
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
      <ReviewScreen review={review} viewerOrgId={session?.org.id ?? null} />
    </div>
  );
}
