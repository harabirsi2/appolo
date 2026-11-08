import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { toggleReaction } from "@/lib/services/social";

const schema = z.object({ emoji: z.string().trim().min(1).max(8) });

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ratingId: string }> };

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
    if (!parsed.success) return jsonError("Pick an emoji.", 400, "INVALID_EMOJI");
    const result = await toggleReaction(session.org.id, ratingId, parsed.data.emoji);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}