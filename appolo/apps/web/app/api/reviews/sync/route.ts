import { NextResponse, type NextRequest } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { syncPlatformReviews } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:respond")) {
      return jsonError("Your role cannot sync reviews.", 403, "FORBIDDEN");
    }

    let platformId: string | null = null;
    try {
      const body = (await request.json()) as { platformId?: string | null };
      platformId = body?.platformId ?? null;
    } catch {
      platformId = null;
    }

    const result = await syncPlatformReviews(session.org.id, platformId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
