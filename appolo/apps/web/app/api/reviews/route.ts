import { NextResponse, type NextRequest } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { listReviews, reviewStats } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:read")) {
      return jsonError("Your role cannot read reviews.", 403, "FORBIDDEN");
    }

    const params = request.nextUrl.searchParams;
    const limit = Number(params.get("limit") ?? "50") || 50;
    const platformKind = params.get("platformKind") ?? undefined;
    const maxRatingRaw = params.get("maxRating");
    const maxRating = maxRatingRaw ? Number(maxRatingRaw) : undefined;

    const [reviews, stats] = await Promise.all([
      listReviews(session.org.id, { limit, platformKind, maxRating }),
      reviewStats(session.org.id),
    ]);

    return NextResponse.json({ reviews, stats });
  } catch (error) {
    return apiError(error);
  }
}
