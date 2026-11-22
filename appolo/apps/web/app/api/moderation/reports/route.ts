import { NextResponse, type NextRequest } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { moderationQueue } from "@/lib/services/moderation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!session.user.isModerator) return jsonError("Moderator access required.", 403, "FORBIDDEN");

    const requested = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    const limit = Number.isFinite(requested) ? requested : 100;
    return NextResponse.json({ reports: await moderationQueue(limit) });
  } catch (error) {
    return apiError(error);
  }
}
