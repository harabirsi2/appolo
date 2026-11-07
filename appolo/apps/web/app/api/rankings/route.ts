import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { rankedRatings, tasteStats } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const kind = request.nextUrl.searchParams.get("kind") ?? undefined;
    const [rankings, stats] = await Promise.all([
      rankedRatings(session.org.id, { kind }),
      tasteStats(session.org.id),
    ]);

    return NextResponse.json({ rankings, topFive: rankings.slice(0, 5), stats });
  } catch (error) {
    return apiError(error);
  }
}
