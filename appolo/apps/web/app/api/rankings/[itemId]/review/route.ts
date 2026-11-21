import { NextResponse, type NextRequest } from "next/server";
import { invalidateCommunity } from "@/lib/cache";
import { firstIssue } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { reviewInputSchema, saveReview } from "@/lib/services/social";
import { revalidatePublicProfile, revalidatePublicReview, revalidatePublicSitemap } from "@/lib/revalidate-public";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const { itemId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }

    const parsed = reviewInputSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_REVIEW");

    const rating = await saveReview(session.org.id, itemId, parsed.data);
    // A review creates or refreshes the item rating row, which changes the
    // community count, the seven-day popular rail and the review text shown
    // beside the score.
    invalidateCommunity();
    // The review page is public and may be new, so its path and the sitemap
    // need to pick up the change; the author's profile shows it too.
    revalidatePublicReview(rating.ratingId);
    revalidatePublicProfile();
    revalidatePublicSitemap();
    return NextResponse.json({ rating });
  } catch (error) {
    return apiError(error);
  }
}