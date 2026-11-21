import { NextResponse, type NextRequest } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { moderationActionSchema, moderateReport } from "@/lib/services/moderation";
import {
  revalidatePublicProfile,
  revalidatePublicReview,
  revalidatePublicSitemap,
} from "@/lib/revalidate-public";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!session.user.isModerator) return jsonError("Moderator access required.", 403, "FORBIDDEN");

    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = moderationActionSchema.safeParse(body);
    if (!parsed.success) return jsonError("Pick hide, remove, or dismiss.", 400, "INVALID_ACTION");

    const result = await moderateReport(session.user.id, id, parsed.data.action);
    // Hiding or removing content must drop it from public pages and the sitemap
    // immediately, not on the next revalidation window.
    if (result.changed) {
      revalidatePublicReview();
      revalidatePublicProfile();
      revalidatePublicSitemap();
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
