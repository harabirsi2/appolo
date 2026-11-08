import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { commentsFor, addComment } from "@/lib/services/social";

const schema = z.object({ body: z.string().trim().min(1).max(1000) });

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ratingId: string }> };

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { ratingId } = await params;
    const comments = await commentsFor(ratingId);
    return NextResponse.json({ comments });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const { ratingId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return jsonError("Write a comment.", 400, "INVALID_COMMENT");
    const comments = await addComment(session.org.id, ratingId, parsed.data.body);
    return NextResponse.json({ comments });
  } catch (error) {
    return apiError(error);
  }
}