import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { mediaKindSchema } from "@appolo/core";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { reorderRankings } from "@/lib/services/rankings";

const schema = z.object({
  kind: mediaKindSchema,
  itemIds: z.array(z.string().uuid()).min(1).max(500),
});

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
    if (!parsed.success) {
      return jsonError("Send a kind and an ordered list of rated titles.", 400, "INVALID_ORDER");
    }

    const result = await reorderRankings(session.org.id, parsed.data.kind, parsed.data.itemIds);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
