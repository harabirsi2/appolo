import { NextResponse, type NextRequest } from "next/server";
import { can, bulkReviewRequestSchema, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { sendBulkReviewRequests } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:request")) {
      return jsonError("Your role cannot send review requests.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = bulkReviewRequestSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const result = await sendBulkReviewRequests(session.org.id, parsed.data, { id: session.user.id });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
