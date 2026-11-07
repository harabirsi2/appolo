import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, reviewReplySchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { publishReviewReply, replyToReview } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Save (or replace) a draft reply for a review. */
export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:respond")) {
      return jsonError("Your role cannot reply to reviews.", 403, "FORBIDDEN");
    }

    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = reviewReplySchema.safeParse({ reviewId: id, body: (body as { body?: unknown })?.body });
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const reply = await replyToReview(session.org.id, id, parsed.data.body, session.user.id);
    return NextResponse.json({ reply }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/** Publish the most recent draft reply. */
export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:respond")) {
      return jsonError("Your role cannot publish replies.", 403, "FORBIDDEN");
    }

    const { id } = await params;
    let replyId: string | undefined;
    try {
      const body = (await request.json()) as { replyId?: string };
      replyId = body?.replyId;
    } catch {
      replyId = undefined;
    }

    const result = await publishReviewReply(session.org.id, id, session.user.id, replyId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
