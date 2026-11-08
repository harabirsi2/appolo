import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { pinReview } from "@/lib/services/social";

const schema = z.object({ ratingId: z.string().uuid().nullable() });

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
    if (!parsed.success) return jsonError("Invalid rating.", 400, "INVALID_RATING");
    const profile = await pinReview(session.org.id, parsed.data.ratingId);
    return NextResponse.json({ profile });
  } catch (error) {
    return apiError(error);
  }
}