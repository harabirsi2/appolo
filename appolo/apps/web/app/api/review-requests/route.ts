import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, reviewRequestInputSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { listReviewRequests, sendReviewRequest } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:read")) {
      return jsonError("Your role cannot read review requests.", 403, "FORBIDDEN");
    }
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50") || 50;
    const requests = await listReviewRequests(session.org.id, { limit });
    return NextResponse.json({ requests });
  } catch (error) {
    return apiError(error);
  }
}

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

    const parsed = reviewRequestInputSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const result = await sendReviewRequest(session.org.id, parsed.data, { id: session.user.id });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
