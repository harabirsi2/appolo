import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { reviewById } from "@/lib/services/social";
import { ReviewScreen } from "@/components/review-screen";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function AppReviewPage({ params }: Params) {
  const session = await requireSession();
  const { id } = await params;
  const review = await reviewById(id, session.org.id);
  if (!review) notFound();

  return (
    <div>
      <div className="px-5 pt-4">
        <BackButton fallback={`/app/item/${review.itemId}`} />
      </div>
      <ReviewScreen review={review} />
    </div>
  );
}
