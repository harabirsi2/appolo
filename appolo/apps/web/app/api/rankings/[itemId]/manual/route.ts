import { NextResponse, type NextRequest } from "next/server";
import { invalidateCommunity } from "@/lib/cache";
import { z } from "zod";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { setManualRating } from "@/lib/services/rankings";

const schema = z.object({ score: z.number().min(0).max(10) });

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const { itemId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return jsonError("Score must be between 0 and 10.", 400, "INVALID_SCORE");
    const rating = await setManualRating(session.org.id, itemId, parsed.data.score);
    invalidateCommunity();
    return NextResponse.json({ rating });
  } catch (error) {
    return apiError(error);
  }
}