import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, reviewDraftSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { draftReplyForReview } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Draft an AI (or heuristic) reply for a review. Always human-approved. */
export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:respond")) {
      return jsonError("Your role cannot draft replies.", 403, "FORBIDDEN");
    }

    const { id } = await params;
    let tone: string | undefined;
    try {
      const body = (await request.json()) as { tone?: string };
      tone = body?.tone;
    } catch {
      tone = undefined;
    }

    const parsed = reviewDraftSchema.safeParse({ reviewId: id, tone });
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const draft = await draftReplyForReview(session.org.id, id, parsed.data.tone, session.user.id);
    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
