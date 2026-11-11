import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonError, rateLimited } from "@/lib/api";
import { getSession } from "@/lib/session";
import { consumeAction, COMMENT_WINDOW } from "@/lib/services/action-rate-limit";
import { commentsFor, addComment } from "@/lib/services/social";

const schema = z.object({ body: z.string().trim().min(1).max(1000) });

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ratingId: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { ratingId } = await params;
    const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20));
    const offsetValue = Number(request.nextUrl.searchParams.get("offset") ?? 0);
    const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.floor(offsetValue)) : 0;
    const page = await commentsFor(ratingId, limit, offset);
    return NextResponse.json(page);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const limit = await consumeAction("comment", session.org.id, COMMENT_WINDOW);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const { ratingId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return jsonError("Write a comment.", 400, "INVALID_COMMENT");
    const result = await addComment(session.org.id, ratingId, parsed.data.body);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}