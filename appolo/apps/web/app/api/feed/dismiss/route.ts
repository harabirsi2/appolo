import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { dismissFeedReview } from "@/lib/services/social";

const schema = z.object({ ratingId: z.string().uuid() });

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return jsonError("Send the review to dismiss.", 400, "INVALID_REVIEW");

    await dismissFeedReview(session.org.id, parsed.data.ratingId);
    return NextResponse.json({ dismissed: true });
  } catch (error) {
    return apiError(error);
  }
}
